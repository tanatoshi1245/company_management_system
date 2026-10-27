import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  const unused = (await detail(behind.id))?.scoutUnused ?? [];
  return { board, me, meta, month, behind, detail, biz, unused };
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

  it('ヘッダ・当月の実績（8 タイル + ゲージ）・累積と推移の 2 グラフ・属性タブ・未利用状況・未登録 CTA・注意点', async () => {
    installFetch(f, calls);
    const c = f.behind;
    window.history.replaceState(null, '', `/companies/${c.id}?month=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    await waitFor(() => expect(document.title).toContain(c.name));
    // 当月の実績: ボードと同じ 8 項目
    const stats = Array.from(document.querySelectorAll('.stat-grid .stat .t')).map((e) => e.textContent);
    expect(stats).toEqual(['掲載 / 枠', '閲覧', '応募', '送信 / 枠', '返信', '選考中', '採用', '最終ログイン']);
    // ゲージ: 求人枠とスカウト枠の 2 本
    const bullets = document.querySelectorAll('.bullet');
    expect(bullets.length).toBe(2);
    const scout = bullets[1];
    const fill = scout.querySelector('rect[fill="var(--seq-4)"]') as SVGRectElement;
    const expectedLine = scout.querySelector('line') as SVGLineElement;
    expect(fill).toBeTruthy();
    if (f.biz.elapsed >= 3) {
      expect(expectedLine).toBeTruthy();
      expect(scout.textContent).toContain('ペース: 遅れ');
      expect(Number(expectedLine.getAttribute('x1'))).toBeGreaterThan(Number(fill.getAttribute('width')));
    }
    // 下半分: 左 = 累積（閲覧・応募）、右 = 送信・返信の推移 + 属性。13 か月の推移の小グラフ群とコホート表は無い
    const lower = document.querySelector('.co-lower')!;
    const cols = lower.querySelectorAll(':scope > .stack');
    expect(cols.length).toBe(2);
    expect(cols[0].querySelector('section[aria-label="閲覧と応募の推移"]')).toBeTruthy();
    expect(cols[1].querySelector('section[aria-label="スカウト送信と返信の推移"]')).toBeTruthy();
    expect(cols[1].querySelector('[role=tablist][aria-label="属性"]')).toBeTruthy();
    expect(screen.queryByText('13 か月の推移')).toBeNull();
    expect(document.querySelectorAll('.multiples').length).toBe(0);
    expect(screen.queryByRole('table', { name: /現在の選考ステータス/ })).toBeNull();
    // 2 系列の折れ線（凡例 2 つ・2 本の path）。表で見るに切り替えられる
    const dual = document.querySelectorAll('.chart.dual');
    expect(dual.length).toBe(2);
    for (const ch of dual) {
      expect(ch.querySelectorAll('.legend > span').length).toBe(2);
      expect(ch.querySelectorAll('svg g[data-series] > path').length).toBe(2);
    }
    // 閲覧・応募は左右 2 軸（左 = 閲覧、右 = 応募。目盛の文字は系列の色）、送信・返信は 1 軸
    const vaChart = cols[0].querySelector('.chart.dual')!;
    expect(vaChart.querySelectorAll('svg text.tick.left').length).toBe(5);
    expect(vaChart.querySelectorAll('svg text.tick.right').length).toBe(5);
    expect(vaChart.querySelector('svg text.tick.right')?.getAttribute('fill')).toBe('var(--cat-2)');
    expect(vaChart.textContent).toContain('左軸');
    const st = cols[1].querySelector('.chart.dual')!;
    expect(st.querySelectorAll('svg text.tick.right').length).toBe(0);
    fireEvent.click(screen.getAllByRole('button', { name: '表で見る' })[0]);
    const va = screen.getByRole('table', { name: '閲覧と応募の推移の表' });
    // 単月の値（累積ではない）: 最後の行 = 当月の閲覧・応募がボードの値と一致
    const lastRow = va.querySelector('tbody tr:last-child')!;
    const cells = Array.from(lastRow.querySelectorAll('td')).map((td) => td.textContent?.replace(/,/g, ''));
    expect(Number(cells[1])).toBe(c.m.views);
    expect(Number(cells[2])).toBe(c.m.apps);
    // 属性タブ: 最終経験職種・ターゲット区分・会員分類は無い。日本語レベルは番号の降順
    const attrTabs = screen.getByRole('tablist', { name: '属性' });
    const tabNames = Array.from(attrTabs.querySelectorAll('[role=tab]')).map((t) => t.textContent);
    expect(tabNames).toEqual(['日本語レベル', '英語レベル', '現住所', '経験職種', '希望職種', '現年収', '希望年収', '年代']);
    const firstLabel = document.querySelector('.attr-bars .attr-row .attr-label')?.textContent ?? '';
    expect(firstLabel.startsWith('6.')).toBe(true);
    const second = attrTabs.querySelectorAll('[role=tab]')[1] as HTMLElement;
    fireEvent.click(second);
    await waitFor(() => expect(window.location.search).toContain('attr='));
    expect(second.getAttribute('aria-selected')).toBe('true');
    // スカウト未利用状況の表（モックは 3 社に 1 社に記録がある）
    const unused = screen.getByRole('region', { name: 'スカウト未利用状況' });
    expect(unused).toBeTruthy();
    expect(within(unused).getByRole('link', { name: '理由を登録する' }).getAttribute('href')).toBe(`/scout-unused?month=${f.month}`);
    if (f.unused.length) {
      const table = screen.getByRole('table', { name: 'スカウト未利用の記録' });
      expect(table.querySelectorAll('tbody tr').length).toBe(f.unused.length);
      expect(Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['対象月', '理由', '補足', '出所']);
      expect(table.textContent).toContain(f.unused[0].reason ?? '–');
      // 対象月は年月（例: 2026年9月）
      expect(table.querySelector('tbody tr td')?.textContent).toMatch(/^\d{4}年\d{1,2}月$/);
    } else {
      expect(unused.textContent).toContain('未利用の記録はありません');
    }
    // 目標未登録の CTA
    expect(screen.getByText('この月の目標は未登録です')).toBeTruthy();
    expect(screen.getByRole('link', { name: '目標を編集' }).getAttribute('href')).toBe(`/targets/${c.id}?from=${f.month}`);
    // 注意点のブロックは無い（2026-10-27 に廃止）
    expect(screen.queryByText('この画面の注意点')).toBeNull();
    // 詳細の取得は 1 回
    expect(calls.filter((u) => u.startsWith(`/api/companies/${c.id}`)).length).toBe(1);
  });

  it('目標があれば目標と実績の表と達成率が出る', async () => {
    const c = f.behind;
    const row: TargetRow = { company_id: Number(c.id), target_month: f.month, scout_sent_target: 100, application_target: 10, interested_target: 20, view_target: null, hire_target: 1, stage_targets_json: '{}', note: null, created_by: VIEWER, created_at: 'x', updated_by: VIEWER, updated_at: 'x' };
    installFetch(f, calls, () => [row]);
    window.history.replaceState(null, '', `/companies/${c.id}?month=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '目標と実績' })).toBeTruthy());
    const table = screen.getByRole('table', { name: '目標と実績' });
    expect(table.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(4);
    expect(table.textContent).toContain('スカウト送信');
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
