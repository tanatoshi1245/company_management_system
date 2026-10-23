import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/app/App';
import { clearResourceCache } from '../../src/app/lib/useResource';
import { MockBqClient } from '../../src/worker/bq/mockClient';
import { loadBoardCore, mergeBoard } from '../../src/worker/services/boardService';
import { loadCompanyCore, mergeCompanyDetail } from '../../src/worker/services/companyService';
import { mockRefreshLog } from '../../src/worker/bq/fixtures';
import { addDays, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { monthProgress } from '../../src/shared/calendar/businessDays';
import { scoutPace } from '../../src/shared/metrics/pace';
import { CAVEATS } from '../../src/shared/caveats';
import type { TargetRow } from '../../src/worker/d1/targetsRepo';

const VIEWER = 'preview@daijob.com';

/** Worker と同じ組み立てでボードと企業詳細の応答を作る */
async function fixtures() {
  const today = todayJst();
  const log = mockRefreshLog()[0];
  const refresh = { dataVersion: String(log.run_date), dataDate: addDays(today, -1), refreshedAt: String(log.finished_at), refreshStatus: 'ok' as const, lastError: null };
  const month = monthOf(today);
  const client = new MockBqClient();
  const core = await loadBoardCore(client, month, refresh);
  const board = mergeBoard(core, new Map(), new Map(), VIEWER, 5);
  const biz = monthProgress(month, refresh.dataDate);
  // ペースが「遅れ」の企業（枠あり・送信あり）。月初 3 営業日未満なら判定前なので最も消化率が低い企業で代用
  const behind =
    board.companies.find((c) => c.limits.scout && c.m.sent > 0 && scoutPace({ sent: c.m.sent, limit: c.limits.scout, progressRate: biz.rate, elapsedDays: biz.elapsed }).status === 'behind') ??
    [...board.companies].filter((c) => c.limits.scout).sort((a, b) => a.m.sent / a.limits.scout! - b.m.sent / b.limits.scout!)[0];
  const detail = async (id: string, targets: TargetRow[] = []) => {
    const c = await loadCompanyCore(client, id, month, refresh);
    if (!c) return null;
    return mergeCompanyDetail(c, targets, null, VIEWER, 5);
  };
  const me = { email: VIEWER, name: 'テスト', verified: false, authMode: 'mock', mock: true, ownerUserId: null, overrideCompanyIds: [], canEdit: false };
  const meta = { dataVersion: refresh.dataVersion, dataDate: refresh.dataDate, refreshedAt: refresh.refreshedAt, refreshStatus: 'ok', asOf: today, month, bizDays: biz, ownerSource: 'sales_staff', scoutLimitPeriodDefault: 'month', benchMinN: 5, login: { availableFrom: '2026-05-15' }, caveats: CAVEATS, holidaysVersion: '2026-10', dataSchemaVersion: 1, mock: true };
  return { board, me, meta, month, behind, detail, biz };
}

type F = Awaited<ReturnType<typeof fixtures>>;

function installFetch(f: F, calls: string[], targetsFor: (id: string) => TargetRow[] = () => []) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('/api/meta')) return Response.json(f.meta);
    if (url.startsWith('/api/me')) return Response.json(f.me);
    if (url.startsWith('/api/board')) return Response.json(f.board);
    const m = url.match(/^\/api\/companies\/(\d+)\?month=(\d{4}-\d{2})/);
    if (m) {
      const d = await f.detail(m[1], targetsFor(m[1]));
      if (d) return Response.json(d);
    }
    return Response.json({ error: 'nf', code: 'notFound' }, { status: 404 });
  }) as typeof fetch;
}

describe('企業詳細', () => {
  const calls: string[] = [];
  let f: F;
  beforeEach(async () => {
    clearResourceCache();
    f = await fixtures();
    calls.length = 0;
  });
  afterEach(() => cleanup());

  it('ヘッダ・ゲージ（ペース遅れなら期待値の印が塗りより右）・推移・タブ・コホート・未登録 CTA・注意点', async () => {
    installFetch(f, calls);
    const c = f.behind;
    window.history.replaceState(null, '', `/companies/${c.id}?month=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    await waitFor(() => expect(document.title).toContain(c.name));
    // 利用状況: 求人枠とスカウト枠の 2 本のゲージ
    const bullets = document.querySelectorAll('.bullet');
    expect(bullets.length).toBe(2);
    const scout = bullets[1];
    const fill = scout.querySelector('rect[fill="var(--seq-4)"]') as SVGRectElement;
    const expectedLine = scout.querySelector('line') as SVGLineElement;
    expect(fill).toBeTruthy();
    if (f.biz.elapsed >= 3) {
      expect(expectedLine).toBeTruthy();
      expect(scout.textContent).toContain('ペース: 遅れ');
      // 期待値の印は実績の塗りの右端より右
      expect(Number(expectedLine.getAttribute('x1'))).toBeGreaterThan(Number(fill.getAttribute('width')));
    }
    // 推移: 8 パネル + 業界 p25–p75 の帯
    expect(screen.getByText('13 か月の推移')).toBeTruthy();
    expect(document.querySelectorAll('.multiples .panel.chart').length).toBe(8);
    expect(document.querySelectorAll('.multiples path[fill="var(--band)"]').length).toBeGreaterThan(0);
    // 属性タブ: 切替で URL と見出しが変わる
    const attrTabs = screen.getByRole('tablist', { name: '属性' });
    const second = attrTabs.querySelectorAll('[role=tab]')[1] as HTMLElement;
    fireEvent.click(second);
    await waitFor(() => expect(window.location.search).toContain('attr='));
    expect(second.getAttribute('aria-selected')).toBe('true');
    // コホート: スカウト → 応募
    expect(screen.getByRole('table', { name: /興味あり返信月 × 現在の選考ステータス/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /応募/ }));
    await waitFor(() => expect(window.location.search).toContain('tab=application'));
    expect(screen.getByRole('table', { name: /応募月 × 現在の選考ステータス/ })).toBeTruthy();
    // 目標未登録の CTA
    expect(screen.getByText('この月の目標は未登録です')).toBeTruthy();
    expect(screen.getByRole('link', { name: '目標を編集' }).getAttribute('href')).toBe(`/targets/${c.id}?from=${f.month}`);
    // 注意点
    expect(screen.getByText('この画面の注意点')).toBeTruthy();
    expect(document.querySelectorAll('.caveat-list li').length).toBeGreaterThan(0);
    // 詳細の取得は 1 回
    expect(calls.filter((u) => u.startsWith(`/api/companies/${c.id}`)).length).toBe(1);
  });

  it('目標があれば目標と実績の表と達成率が出る。推移に目標の破線', async () => {
    const c = f.behind;
    const row: TargetRow = { company_id: Number(c.id), target_month: f.month, scout_sent_target: 100, application_target: 10, interested_target: 20, view_target: null, hire_target: 1, stage_targets_json: '{}', note: null, created_by: VIEWER, created_at: 'x', updated_by: VIEWER, updated_at: 'x' };
    installFetch(f, calls, () => [row]);
    window.history.replaceState(null, '', `/companies/${c.id}?month=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '目標と実績' })).toBeTruthy());
    const table = screen.getByRole('table', { name: '目標と実績' });
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(4);
    expect(table.textContent).toContain('スカウト送信');
    expect(document.querySelectorAll('.multiples path[stroke="var(--target-line)"]').length).toBeGreaterThan(0);
  });

  it('存在しない企業は 404 → 空状態、ボードへ戻るで一覧に戻る。ボードの行ホバーで詳細を先読みする', async () => {
    installFetch(f, calls);
    window.history.replaceState(null, '', `/companies/999999999?month=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByText('企業が見つかりません')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'ボードへ戻る' }));
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業の実績一覧' })).toBeTruthy());
    const row = screen.getByRole('table', { name: '契約企業の実績一覧' }).querySelector('tbody tr')!;
    const before = calls.filter((u) => u.startsWith('/api/companies/')).length;
    fireEvent.mouseEnter(row);
    await waitFor(() => expect(calls.filter((u) => u.startsWith('/api/companies/')).length).toBe(before + 1));
  });
});
