import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/app/App';
import { clearResourceCache } from '../../src/app/lib/useResource';
import { MockBqClient } from '../../src/worker/bq/mockClient';
import { loadBoardCore, mergeBoard } from '../../src/worker/services/boardService';
import { loadAttributes, loadCompanyCore, loadJobs, mergeCompanyDetail } from '../../src/worker/services/companyService';
import { countJobs } from '../../src/app/features/company/companyModel';
import { SELECTION_CARD_KEYS } from '../../src/shared/labels';
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
  const multi = board.companies.find((c) => c.accountTypes.length > 1 && (c.state === 'active' || c.state === 'ending_30d'))!;
  const single = board.companies.find((c) => c.accountTypes.length === 1 && (c.state === 'active' || c.state === 'ending_30d'))!;
  return { board, me, meta, month, behind, detail, biz, unused, client, multi, single };
}

type F = Awaited<ReturnType<typeof fixtures>>;

function installFetch(f: F, calls: string[], targetsFor: (id: string) => TargetRow[] = () => []) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('/api/meta')) return Response.json(f.meta);
    if (url.startsWith('/api/me')) return Response.json(f.me);
    if (url.startsWith('/api/board')) return Response.json(f.board);
    const sub = url.match(/^\/api\/companies\/(\d+)\/(attributes|jobs)\?(.*)$/);
    if (sub) {
      const q = new URLSearchParams(sub[3]);
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      const account = q.get('account');
      const job = q.get('job');
      if (sub[2] === 'attributes') return Response.json(await loadAttributes(f.client, sub[1], from, to, account, job));
      return Response.json(await loadJobs(f.client, sub[1], from, to, account, job));
    }
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

  it('求人の実績タブ（既定）: ヘッダのカード・期間の選択・タブ 3 つ・実績カード（掲載求人数 / 閲覧件数 / 応募件数）・2 軸の推移・閲覧 / 応募の円グラフ・求人ごとの表。担当・SF・目標比較は無い', async () => {
    installFetch(f, calls);
    const c = f.behind;
    window.history.replaceState(null, '', `/companies/${c.id}`);
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
    // 期間: 開始月〜終了月の 2 つのセレクタ（既定 = 契約開始月（窓より前なら窓の先頭）〜当月）。月の単独セレクタは無い
    const fromSel = screen.getByLabelText('開始月') as HTMLSelectElement;
    const toSel = screen.getByLabelText('終了月') as HTMLSelectElement;
    expect(screen.queryByLabelText('表示する月')).toBeNull();
    expect(toSel.value).toBe(f.month);
    const startMonth = c.contract.from.slice(0, 7);
    expect(fromSel.value).toBe(startMonth > f.board.meta.months[0] ? startMonth : f.board.meta.months[0]);
    // 単一アカウントの企業にはアカウント切替が無い
    expect(c.accountTypes.length).toBe(1);
    expect(screen.queryByRole('group', { name: 'アカウント種別の切替' })).toBeNull();
    // タブ 3 つ（カードの下、同じ幅）。既定は求人の実績
    const tablist = screen.getByRole('tablist', { name: '企業詳細のタブ' });
    const tabs = Array.from(tablist.querySelectorAll('[role=tab]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['求人の実績', 'スカウトの実績', '選考状況']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(head.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 求人の実績カード（掲載求人数 / 閲覧件数 / 応募件数 / 採用（応募経由））。スカウトのカードは別タブ
    const jobs = screen.getByTestId('summary-jobs');
    expect(screen.queryByTestId('summary-scout')).toBeNull();
    expect(Array.from(jobs.querySelectorAll('.stat .t')).map((e) => e.textContent)).toEqual(['掲載求人数', '閲覧件数', '応募件数', '採用（応募経由）']);
    expect(jobs.textContent).not.toMatch(/閲覧人数|応募人数|重複排除/);
    const num = (el: Element, key: string) => Number(el.querySelector(`[data-stat=${key}] .v`)?.textContent?.replace(/[^\d]/g, ''));
    const inWindow = detail.monthly.filter((m) => m.month >= fromSel.value && (!detail.company.contract.to || m.month <= detail.company.contract.to.slice(0, 7)));
    expect(num(jobs, 'views')).toBe(inWindow.reduce((a, m) => a + m.views, 0));
    expect(num(jobs, 'apps')).toBe(inWindow.reduce((a, m) => a + m.apps, 0));
    expect(num(jobs, 'jobs')).toBe(countJobs(detail.jobs, fromSel.value, f.month, '', detail.meta.asOf));
    expect(document.querySelectorAll('.bullet').length).toBe(0);
    expect(screen.queryByRole('table', { name: '目標と実績' })).toBeNull();
    expect(screen.queryByText('この画面の注意点')).toBeNull();
    // 推移: 閲覧・応募（左右 2 軸、目盛の文字は系列の色）。系列名は 閲覧件数 / 応募件数
    expect(screen.getByRole('region', { name: '閲覧と応募の推移' })).toBeTruthy();
    const dual = document.querySelectorAll('.chart.dual');
    expect(dual.length).toBe(1);
    const ch = dual[0];
    expect(ch.querySelectorAll('.legend > span').length).toBe(2);
    expect(ch.querySelectorAll('svg g[data-series] > path').length).toBe(2);
    expect(ch.querySelectorAll('svg text.tick.left').length).toBe(5);
    expect(ch.querySelectorAll('svg text.tick.right').length).toBe(5);
    expect(ch.querySelector('svg text.tick.right')?.getAttribute('fill')).toBe('var(--cat-2)');
    expect(ch.textContent).toContain('閲覧件数');
    expect(ch.textContent).toContain('応募件数');
    fireEvent.click(screen.getByRole('button', { name: '表で見る' }));
    const va = screen.getByRole('table', { name: '閲覧と応募の推移の表' });
    const lastRow = va.querySelector('tbody tr:last-child')!;
    const cells = Array.from(lastRow.querySelectorAll('td')).map((td) => td.textContent?.replace(/,/g, ''));
    expect(Number(cells[1])).toBe(c.m.views);
    expect(Number(cells[2])).toBe(c.m.apps);
    fireEvent.click(screen.getByRole('button', { name: 'グラフで見る' }));
    // 属性の円グラフ: 誰が求人を見ているか（閲覧 / 応募）。内訳は期間付きの属性 API から
    await waitFor(() => expect(calls.some((u) => u.startsWith(`/api/companies/${c.id}/attributes?from=${fromSel.value}&to=${f.month}`) && !u.includes('job='))).toBe(true));
    const pieViews = screen.getByTestId('pie-views');
    expect(screen.queryByTestId('pie-scout')).toBeNull();
    await waitFor(() => expect(pieViews.querySelector('.pie svg')).toBeTruthy());
    expect(Array.from(pieViews.querySelectorAll('[role=tab]')).map((t) => t.textContent)).toEqual(['日本語レベル', '英語レベル', '現住所', '経験職種', '希望職種', '現年収', '希望年収', '年代']);
    expect(pieViews.querySelector('.pie svg')?.getAttribute('width')).toBe('200');
    const segV = pieViews.querySelector('.segmented')!;
    expect(Array.from(segV.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['閲覧', '応募']);
    const viewsTotal = () => Number(pieViews.querySelector('.pie svg text.num')?.textContent?.replace(/,/g, ''));
    const viewed = viewsTotal();
    expect(viewed).toBeGreaterThan(0);
    fireEvent.click(within(segV as HTMLElement).getByRole('button', { name: '応募' }));
    expect(viewsTotal()).toBeLessThan(viewed);
    expect(viewsTotal()).toBeGreaterThan(0);
    fireEvent.click(within(segV as HTMLElement).getByRole('button', { name: '閲覧' }));
    // 求人ごとの表（期間中。閲覧件数の降順）と求人フィルタ
    const jobsApi = await loadJobs(f.client, c.id, fromSel.value, f.month, null, null);
    expect(jobsApi.rows.length).toBeGreaterThan(1);
    const table = await screen.findByRole('table', { name: '求人ごとの実績の表' });
    expect(Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['求人タイトル', 'アカウント', '掲載期間', '閲覧件数', '応募件数', '採用']);
    const trs = Array.from(table.querySelectorAll('tbody tr'));
    expect(trs.length).toBe(jobsApi.rows.length);
    const shownViews = trs.map((tr) => Number(tr.querySelectorAll('td')[3].textContent?.replace(/[^\d]/g, '') || 0));
    for (let k = 1; k < shownViews.length; k++) expect(shownViews[k - 1]).toBeGreaterThanOrEqual(shownViews[k]);
    expect(jobsApi.rows.reduce((a, r) => a + r.views, 0)).toBe(num(jobs, 'views'));
    expect(jobsApi.rows.reduce((a, r) => a + r.apps, 0)).toBe(num(jobs, 'apps'));
    expect(trs.some((tr) => tr.textContent?.includes('企業への直接応募'))).toBe(jobsApi.rows.some((r) => r.direct));
    const filter = screen.getByLabelText('求人フィルタ') as HTMLSelectElement;
    expect(filter.options.length).toBe(jobsApi.rows.length + 1);
    // 行を選ぶ → URL に job=、掲載求人数 1、閲覧件数 = その求人、推移はその求人の月次、属性 API に job=
    const pick = jobsApi.rows.find((r) => !r.direct && r.views > 0)!;
    const pickTr = trs[jobsApi.rows.indexOf(pick)] as HTMLElement;
    fireEvent.click(pickTr);
    await waitFor(() => expect(window.location.search).toContain(`job=${pick.key}`));
    await waitFor(() => expect(num(jobs, 'views')).toBe(pick.views));
    expect(num(jobs, 'jobs')).toBe(1);
    expect(num(jobs, 'apps')).toBe(pick.apps);
    expect(filter.value).toBe(pick.key);
    expect(screen.getByRole('table', { name: '求人ごとの実績の表' }).querySelector('tbody tr[aria-selected=true]')?.textContent).toContain(pick.title);
    expect(jobs.querySelector('.lead')?.textContent).toContain(pick.title);
    await waitFor(() => expect(calls.some((u) => u.startsWith(`/api/companies/${c.id}/attributes?`) && u.endsWith(`&job=${pick.key}`))).toBe(true));
    const jobMonthly = await loadJobs(f.client, c.id, fromSel.value, f.month, null, pick.key);
    fireEvent.click(screen.getByRole('button', { name: '表で見る' }));
    const va2 = screen.getByRole('table', { name: '閲覧と応募の推移の表' });
    const last2 = Array.from(va2.querySelector('tbody tr:last-child')!.querySelectorAll('td')).map((td) => td.textContent?.replace(/,/g, ''));
    expect(Number(last2[1])).toBe(jobMonthly.monthly.find((m) => m.month === f.month)?.views ?? 0);
    // 解除で戻る
    fireEvent.click(screen.getByRole('button', { name: '解除' }));
    await waitFor(() => expect(window.location.search).not.toContain('job='));
    await waitFor(() => expect(num(jobs, 'views')).toBe(inWindow.reduce((a, m) => a + m.views, 0)));
    // 詳細の取得は 1 回（属性・求人 API は別）
    expect(calls.filter((u) => u.startsWith(`/api/companies/${c.id}?`)).length).toBe(1);
    // 期間を当月だけに絞ると実績が当月の値になり、URL に from= が入る。詳細本体は再取得しない
    fireEvent.change(fromSel, { target: { value: f.month } });
    await waitFor(() => expect(window.location.search).toContain(`from=${f.month}`));
    await waitFor(() => expect(num(jobs, 'views')).toBe(detail.monthly[13].views));
    expect(num(jobs, 'jobs')).toBe(countJobs(detail.jobs, f.month, f.month, '', detail.meta.asOf));
    expect(calls.filter((u) => u.startsWith(`/api/companies/${c.id}?`)).length).toBe(1);
  });

  it('スカウトの実績タブ: 実績カード（興味あり返信）・2 軸の推移・送信 / 興味あり の円グラフ・スカウト未利用状況。求人フィルタは効かない', async () => {
    installFetch(f, calls);
    const c = f.behind;
    window.history.replaceState(null, '', `/companies/${c.id}?tab=scout`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    const detail = (await f.detail(c.id))!;
    expect(screen.getByRole('tab', { name: 'スカウトの実績' }).getAttribute('aria-selected')).toBe('true');
    const scout = screen.getByTestId('summary-scout');
    expect(screen.queryByTestId('summary-jobs')).toBeNull();
    expect(Array.from(scout.querySelectorAll('.stat .t')).map((e) => e.textContent)).toEqual(['スカウト送信件数', '興味あり返信', '選考中（現在）', '採用（スカウト経由）']);
    const num = (el: Element, key: string) => Number(el.querySelector(`[data-stat=${key}] .v`)?.textContent?.replace(/[^\d]/g, ''));
    const fromSel = screen.getByLabelText('開始月') as HTMLSelectElement;
    const inWindow = detail.monthly.filter((m) => m.month >= fromSel.value && (!detail.company.contract.to || m.month <= detail.company.contract.to.slice(0, 7)));
    expect(num(scout, 'sent')).toBe(inWindow.reduce((a, m) => a + m.sent, 0));
    expect(num(scout, 'intReply')).toBe(inWindow.reduce((a, m) => a + m.intReply, 0));
    expect(num(scout, 'inSel')).toBe(detail.company.m.inSel);
    expect(screen.getByRole('region', { name: 'スカウト送信と興味あり返信の推移' })).toBeTruthy();
    expect(document.querySelectorAll('.chart.dual').length).toBe(1);
    const pieScout = screen.getByTestId('pie-scout');
    await waitFor(() => expect(pieScout.querySelector('.pie svg')).toBeTruthy());
    const seg = pieScout.querySelector('.segmented')!;
    expect(Array.from(seg.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['送信', '興味あり']);
    // 日本語レベルは番号の降順（凡例の 1 行目が 6.）。興味あり に切り替えると件数が減る
    expect(pieScout.querySelector('.pie-legend li .lbl')?.textContent?.startsWith('6.')).toBe(true);
    const total = () => Number(pieScout.querySelector('.pie svg text.num')?.textContent?.replace(/,/g, ''));
    const sentTotal = total();
    fireEvent.click(within(seg as HTMLElement).getByRole('button', { name: '興味あり' }));
    expect(total()).toBeLessThan(sentTotal);
    expect(total()).toBeGreaterThan(0);
    // タブ切替で URL に attr=
    const second = pieScout.querySelectorAll('[role=tab]')[1] as HTMLElement;
    fireEvent.click(second);
    await waitFor(() => expect(window.location.search).toContain('attr='));
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
    // 求人フィルタが URL にあってもスカウトの値は変わらず、注記が出る
    const jobsApi = await loadJobs(f.client, c.id, fromSel.value, f.month, null, null);
    const pick = jobsApi.rows.find((r) => !r.direct)!;
    window.history.replaceState(null, '', `/companies/${c.id}?tab=scout&job=${pick.key}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.getByTestId('summary-scout').querySelector('.lead')?.textContent).toContain('求人フィルタはスカウトには効きません'));
    expect(num(screen.getByTestId('summary-scout'), 'sent')).toBe(inWindow.reduce((a, m) => a + m.sent, 0));
    // タブをクリックすると URL に tab= が入る（求人の実績は既定なので消える）
    fireEvent.click(screen.getByRole('tab', { name: '選考状況' }));
    await waitFor(() => expect(window.location.search).toContain('tab=selection'));
    fireEvent.click(screen.getByRole('tab', { name: '求人の実績' }));
    await waitFor(() => expect(window.location.search).not.toContain('tab='));
  });

  it('求人タブで 応募 に切り替えてからスカウトタブへ移ると、属性の円は 送信 が選ばれてスカウトの内訳になる（求人タブの選択が残らない）', async () => {
    installFetch(f, calls);
    const c = f.behind;
    window.history.replaceState(null, '', `/companies/${c.id}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    const pieViews = screen.getByTestId('pie-views');
    await waitFor(() => expect(pieViews.querySelector('.pie svg')).toBeTruthy());
    fireEvent.click(within(pieViews.querySelector('.segmented') as HTMLElement).getByRole('button', { name: '応募' }));
    expect(within(pieViews.querySelector('.segmented') as HTMLElement).getByRole('button', { name: '応募' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'スカウトの実績' }));
    await waitFor(() => expect(screen.getByTestId('pie-scout')).toBeTruthy());
    const pieScout = screen.getByTestId('pie-scout');
    await waitFor(() => expect(pieScout.querySelector('.pie svg')).toBeTruthy());
    const seg = pieScout.querySelector('.segmented') as HTMLElement;
    expect(within(seg).getByRole('button', { name: '送信' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(seg).getByRole('button', { name: '興味あり' }).getAttribute('aria-pressed')).toBe('false');
    const total = () => Number(pieScout.querySelector('.pie svg text.num')?.textContent?.replace(/,/g, ''));
    const shown = total();
    // 表示されている合計は 送信 の分（興味あり → 送信 と明示的に選び直しても同じ値）
    fireEvent.click(within(seg).getByRole('button', { name: '興味あり' }));
    fireEvent.click(within(seg).getByRole('button', { name: '送信' }));
    expect(total()).toBe(shown);
    expect(shown).toBeGreaterThan(0);
  });

  it('選考状況タブ: 面接調整中 → 採用 の 6 枚（期間の st06〜st11 の合計）。求人を選ぶとその求人の応募側だけ', async () => {
    installFetch(f, calls);
    const c = f.behind;
    window.history.replaceState(null, '', `/companies/${c.id}?tab=selection`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    const detail = (await f.detail(c.id))!;
    const panel = screen.getByTestId('summary-selection');
    expect(Array.from(panel.querySelectorAll('.stat .t')).map((e) => e.textContent)).toEqual(['面接調整中', '1st インタビュー', '2nd インタビュー', '3rd インタビュー', 'Final インタビュー', '採用']);
    expect(panel.querySelector('.stat-grid')?.classList.contains('six')).toBe(true);
    expect(Array.from(panel.querySelectorAll('.stat .t')).join('')).not.toMatch(/辞退|見送り|不採用|未対応|連絡/);
    const num = (key: string) => Number(panel.querySelector(`[data-stat=${key}] .v`)?.textContent?.replace(/[^\d]/g, ''));
    const fromSel = screen.getByLabelText('開始月') as HTMLSelectElement;
    const period = detail.monthly.filter((m) => m.month >= fromSel.value && (!detail.company.contract.to || m.month <= detail.company.contract.to.slice(0, 7)));
    for (const k of SELECTION_CARD_KEYS) expect(num(k)).toBe(period.reduce((a, m) => a + (m.st[k] ?? 0), 0));
    expect(screen.queryByTestId('summary-jobs')).toBeNull();
    // 求人を選ぶ（URL）→ その求人の応募側の件数
    const jobsApi = await loadJobs(f.client, c.id, fromSel.value, f.month, null, null);
    const pick = jobsApi.rows.find((r) => !r.direct && r.apps > 0)!;
    window.history.replaceState(null, '', `/companies/${c.id}?tab=selection&job=${pick.key}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.getByTestId('summary-selection').querySelector('.lead')?.textContent).toContain('応募経由のみ'));
    const jobMonthly = await loadJobs(f.client, c.id, fromSel.value, f.month, null, pick.key);
    await waitFor(() => expect(Number(screen.getByTestId('summary-selection').querySelector('[data-stat=st06_interview_adjusting] .v')?.textContent?.replace(/[^\d]/g, ''))).toBe(jobMonthly.monthly.reduce((a, m) => a + (m.st.st06_interview_adjusting ?? 0), 0)));
  });

  it('複数アカウント（直接 + 紹介）の企業: ヘッダに切替が出て、種別を選ぶと実績・推移・属性がその種別の分になり、URL に account= が入る', async () => {
    installFetch(f, calls);
    const c = f.multi;
    expect(c).toBeTruthy();
    window.history.replaceState(null, '', `/companies/${c.id}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    const detail = (await f.detail(c.id))!;
    expect(screen.getByTestId('accounts-chip').textContent).toContain(`アカウント ${detail.accounts.length}`);
    const group = screen.getByRole('group', { name: 'アカウント種別の切替' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['全体', ...detail.accounts.map((a) => a.type)]);
    const jobs = screen.getByTestId('summary-jobs');
    const num = (el: Element, key: string) => Number(el.querySelector(`[data-stat=${key}] .v`)?.textContent?.replace(/[^\d]/g, ''));
    const fromSel = screen.getByLabelText('開始月') as HTMLSelectElement;
    const period = detail.monthly.map((m) => m.month).filter((m) => m >= fromSel.value && m <= f.month && (!detail.company.contract.to || m <= detail.company.contract.to.slice(0, 7)));
    const allViews = num(jobs, 'views');
    const second = detail.accounts[1].type;
    fireEvent.click(within(group).getByRole('button', { name: second }));
    await waitFor(() => expect(window.location.search).toContain(`account=${encodeURIComponent(second)}`));
    const rows = detail.accountMonthly.filter((r) => r.account === second && period.includes(r.month));
    await waitFor(() => expect(num(jobs, 'views')).toBe(rows.reduce((s, r) => s + r.views, 0)));
    expect(num(jobs, 'views')).toBeLessThan(allViews);
    expect(num(jobs, 'jobs')).toBe(countJobs(detail.jobs, fromSel.value, f.month, second, detail.meta.asOf));
    expect(jobs.querySelector('.lead')?.textContent).toContain(`（${second}）`);
    await waitFor(() => expect(calls.some((u) => u.startsWith(`/api/companies/${c.id}/attributes?`) && u.includes(`&account=${encodeURIComponent(second)}`))).toBe(true));
    await waitFor(() => expect(calls.some((u) => u.startsWith(`/api/companies/${c.id}/jobs?`) && u.includes(`&account=${encodeURIComponent(second)}`))).toBe(true));
    // 求人の表もその種別の求人だけ
    const jobsApi = await loadJobs(f.client, c.id, fromSel.value, f.month, second, null);
    await waitFor(() => expect(screen.getByRole('table', { name: '求人ごとの実績の表' }).querySelectorAll('tbody tr').length).toBe(jobsApi.rows.length));
    // スカウトタブでも種別の値
    fireEvent.click(screen.getByRole('tab', { name: 'スカウトの実績' }));
    const scout = await screen.findByTestId('summary-scout');
    expect(num(scout, 'sent')).toBe(rows.reduce((s, r) => s + r.sent, 0));
    expect(num(scout, 'inSel')).toBe(detail.accountMonthly.find((r) => r.account === second && r.month === f.month)?.inSel ?? 0);
    // 全体に戻すと URL から account= が消える
    fireEvent.click(within(group).getByRole('button', { name: '全体' }));
    await waitFor(() => expect(window.location.search).not.toContain('account='));
    await waitFor(() => expect(num(screen.getByTestId('summary-scout'), 'sent')).toBe(detail.monthly.filter((m) => period.includes(m.month)).reduce((s, m) => s + m.sent, 0)));
  });

  it('目標があっても目標比較の表は出さない（2026-10-27 から非表示。データは /targets で扱う）', async () => {
    const c = f.behind;
    const row: TargetRow = { company_id: Number(c.id), target_month: f.month, scout_sent_target: 100, application_target: 10, interested_target: 20, view_target: null, hire_target: 1, stage_targets_json: '{}', note: null, created_by: VIEWER, created_at: 'x', updated_by: VIEWER, updated_at: 'x' };
    installFetch(f, calls, () => [row]);
    window.history.replaceState(null, '', `/companies/${c.id}?to=${f.month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: c.name })).toBeTruthy());
    expect(screen.queryByRole('table', { name: '目標と実績' })).toBeNull();
  });

  it('存在しない企業は 404 → 空状態、ボードへ戻るで一覧に戻る。ボードの行ホバーで詳細を先読みする', async () => {
    installFetch(f, calls);
    window.history.replaceState(null, '', `/companies/999999999`);
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
