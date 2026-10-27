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

  it('ヘッダのカード・実績（求人 / スカウト。13 か月累積）・2 軸の推移 2 枚・属性の円グラフ 2 枚・未利用状況。担当・SF・目標比較は無い', async () => {
    installFetch(f, calls);
    const c = f.behind;
    window.history.replaceState(null, '', `/companies/${c.id}?month=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    await waitFor(() => expect(document.title).toContain(c.name));
    const detail = (await f.detail(c.id))!;
    // ヘッダ: 契約期間 / 契約終了まで / 最終ログイン のカード 3 枚。担当 CS・SF・契約中の根拠・マート更新・タイムラインの棒は無い
    const head = document.querySelector('.co-head')!;
    expect(Array.from(head.querySelectorAll('.co-cards .stat .t')).map((e) => e.textContent)).toEqual(['契約期間', '契約終了まで', '最終ログイン（CT）']);
    expect(head.querySelector('[data-stat=contractPeriod]')?.textContent).toContain('〜');
    expect(head.textContent).not.toMatch(/担当 CS|SF 取引先|Salesforce|契約中の根拠|マート更新|未紐付け/);
    expect(head.querySelector('.timeline')).toBeNull();
    expect(head.querySelector('[data-stat=lastLogin]')?.textContent).toMatch(/記録なし|\d{4}\/\d{2}\/\d{2}/);
    // 実績: 左 = 求人、右 = スカウト（直近 13 か月の累積）。当月の 8 タイル・ゲージ・目標比較は無い
    const lower = document.querySelector('.co-lower')!;
    const cols = lower.querySelectorAll(':scope > .stack');
    expect(cols.length).toBe(2);
    const jobs = within(cols[0] as HTMLElement).getByTestId('summary-jobs');
    const scout = within(cols[1] as HTMLElement).getByTestId('summary-scout');
    expect(Array.from(jobs.querySelectorAll('.stat .t')).map((e) => e.textContent)).toEqual(['掲載求人数（重複排除）', '閲覧人数', '応募人数', '採用（応募経由）']);
    expect(Array.from(scout.querySelectorAll('.stat .t')).map((e) => e.textContent)).toEqual(['スカウト送信件数', '返信件数', '選考中（現在）', '採用（スカウト経由）']);
    const num = (el: Element, key: string) => Number(el.querySelector(`[data-stat=${key}] .v`)?.textContent?.replace(/[^\d]/g, ''));
    const startMonth = detail.company.contract.from.slice(0, 7);
    const inWindow = detail.monthly.filter((m) => m.month >= startMonth && (!detail.company.contract.to || m.month <= detail.company.contract.to.slice(0, 7)));
    expect(num(jobs, 'views')).toBe(inWindow.reduce((a, m) => a + m.views, 0));
    expect(num(jobs, 'apps')).toBe(inWindow.reduce((a, m) => a + m.apps, 0));
    expect(num(jobs, 'jobs')).toBe(detail.extra.jobsWindowDistinct);
    expect(num(scout, 'sent')).toBe(inWindow.reduce((a, m) => a + m.sent, 0));
    expect(num(scout, 'intReply')).toBe(inWindow.reduce((a, m) => a + m.intReply, 0));
    expect(num(scout, 'inSel')).toBe(detail.company.m.inSel);
    expect(document.querySelectorAll('.bullet').length).toBe(0);
    expect(screen.queryByRole('table', { name: '目標と実績' })).toBeNull();
    expect(screen.queryByText('この月の目標は未登録です')).toBeNull();
    expect(screen.queryByText('13 か月の推移')).toBeNull();
    expect(screen.queryByText('この画面の注意点')).toBeNull();
    // 推移: 左 = 閲覧・応募、右 = 送信・返信。どちらも左右 2 軸（目盛の文字は系列の色）
    expect(cols[0].querySelector('section[aria-label="閲覧と応募の推移"]')).toBeTruthy();
    expect(cols[1].querySelector('section[aria-label="スカウト送信と返信の推移"]')).toBeTruthy();
    const dual = document.querySelectorAll('.chart.dual');
    expect(dual.length).toBe(2);
    for (const ch of dual) {
      expect(ch.querySelectorAll('.legend > span').length).toBe(2);
      expect(ch.querySelectorAll('svg g[data-series] > path').length).toBe(2);
      expect(ch.querySelectorAll('svg text.tick.left').length).toBe(5);
      expect(ch.querySelectorAll('svg text.tick.right').length).toBe(5);
      expect(ch.querySelector('svg text.tick.right')?.getAttribute('fill')).toBe('var(--cat-2)');
      expect(ch.textContent).toContain('左軸');
    }
    fireEvent.click(screen.getAllByRole('button', { name: '表で見る' })[0]);
    const va = screen.getByRole('table', { name: '閲覧と応募の推移の表' });
    const lastRow = va.querySelector('tbody tr:last-child')!;
    const cells = Array.from(lastRow.querySelectorAll('td')).map((td) => td.textContent?.replace(/,/g, ''));
    expect(Number(cells[1])).toBe(c.m.views);
    expect(Number(cells[2])).toBe(c.m.apps);
    // 属性の円グラフ: 左 = 誰が求人を見ているか（閲覧のみ）、右 = 誰にスカウトを送っているか（送信 / 返信）。同じ大きさ、タブ 8 種
    const pieViews = within(cols[0] as HTMLElement).getByTestId('pie-views');
    const pieScout = within(cols[1] as HTMLElement).getByTestId('pie-scout');
    for (const pnl of [pieViews, pieScout]) {
      const tabs = Array.from(pnl.querySelectorAll('[role=tab]')).map((t) => t.textContent);
      expect(tabs).toEqual(['日本語レベル', '英語レベル', '現住所', '経験職種', '希望職種', '現年収', '希望年収', '年代']);
      const svg = pnl.querySelector('.pie svg')!;
      expect(svg.getAttribute('width')).toBe('200');
      expect(pnl.querySelectorAll('.pie svg path').length).toBeGreaterThan(1);
      expect(pnl.querySelectorAll('.pie-legend li').length).toBeLessThanOrEqual(9);
    }
    expect(pieViews.querySelector('.segmented')).toBeNull();
    const seg = pieScout.querySelector('.segmented')!;
    expect(Array.from(seg.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['送信', '返信']);
    // 日本語レベルは番号の降順（凡例の 1 行目が 6.）。返信に切り替えると件数が減る
    const firstLegend = () => pieScout.querySelector('.pie-legend li .lbl')?.textContent ?? '';
    expect(firstLegend().startsWith('6.')).toBe(true);
    const total = () => Number(pieScout.querySelector('.pie svg text.num')?.textContent?.replace(/,/g, ''));
    const sentTotal = total();
    fireEvent.click(within(seg as HTMLElement).getByRole('button', { name: '返信' }));
    expect(total()).toBeLessThan(sentTotal);
    expect(total()).toBeGreaterThan(0);
    // 閲覧の円はスカウトより大きい合計（モック）
    expect(Number(pieViews.querySelector('.pie svg text.num')?.textContent?.replace(/,/g, ''))).toBeGreaterThan(sentTotal);
    // タブ切替で URL に attr=（スカウト側）
    const second = pieScout.querySelectorAll('[role=tab]')[1] as HTMLElement;
    fireEvent.click(second);
    await waitFor(() => expect(window.location.search).toContain('attr='));
    expect(second.getAttribute('aria-selected')).toBe('true');
    // スカウト未利用状況の表（モックは 3 社に 1 社に記録がある）
    const unused = screen.getByRole('region', { name: 'スカウト未利用状況' });
    expect(within(unused).getByRole('link', { name: '理由を登録する' }).getAttribute('href')).toBe(`/scout-unused?month=${f.month}`);
    if (f.unused.length) {
      const table = screen.getByRole('table', { name: 'スカウト未利用の記録' });
      expect(table.querySelectorAll('tbody tr').length).toBe(f.unused.length);
      expect(Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['対象月', '理由', '補足', '出所']);
      expect(table.querySelector('tbody tr td')?.textContent).toMatch(/^\d{4}年\d{1,2}月$/);
    } else {
      expect(unused.textContent).toContain('未利用の記録はありません');
    }
    // 詳細の取得は 1 回
    expect(calls.filter((u) => u.startsWith(`/api/companies/${c.id}`)).length).toBe(1);
  });

  it('目標があっても目標比較の表は出さない（2026-10-27 から非表示。データは /targets で扱う）', async () => {
    const c = f.behind;
    const row: TargetRow = { company_id: Number(c.id), target_month: f.month, scout_sent_target: 100, application_target: 10, interested_target: 20, view_target: null, hire_target: 1, stage_targets_json: '{}', note: null, created_by: VIEWER, created_at: 'x', updated_by: VIEWER, updated_at: 'x' };
    installFetch(f, calls, () => [row]);
    window.history.replaceState(null, '', `/companies/${c.id}?month=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    expect(screen.queryByRole('table', { name: '目標と実績' })).toBeNull();
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
