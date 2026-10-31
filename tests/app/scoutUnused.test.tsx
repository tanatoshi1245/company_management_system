import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/app/App';
import { clearResourceCache } from '../../src/app/lib/useResource';
import { MockBqClient } from '../../src/worker/bq/mockClient';
import { loadBoardCore, mergeBoard } from '../../src/worker/services/boardService';
import { mockRefreshLog } from '../../src/worker/bq/fixtures';
import { addDays, addMonths, fmtMonthJa, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { monthProgress } from '../../src/shared/calendar/businessDays';
import { CAVEATS } from '../../src/shared/caveats';
import { SCOUT_UNUSED_REASONS } from '../../src/shared/labels';
import { isScoutUnused } from '../../src/app/features/scoutUnused/ScoutUnusedPage';
import { boardAccountTypes, ownerKey } from '../../src/shared/metrics/board';
import type { ScoutUnusedEntry } from '../../src/shared/schema/scoutUnused';
import type { BoardResponse } from '../../src/shared/schema/board';

const VIEWER = 'cs@daijob.com';

async function setup() {
  const today = todayJst();
  const log = mockRefreshLog()[0];
  const refresh = { dataVersion: String(log.run_date), dataDate: addDays(today, -1), refreshedAt: String(log.finished_at), refreshStatus: 'ok' as const, lastError: null };
  const cur = monthOf(today);
  const prev = addMonths(cur, -1);
  const client = new MockBqClient();
  const boards = new Map<string, BoardResponse>();
  const boardFor = async (m: string) => {
    if (!boards.has(m)) boards.set(m, mergeBoard(await loadBoardCore(client, m, refresh), new Map(), new Map(), VIEWER, 5));
    return boards.get(m)!;
  };
  const entries = new Map<string, ScoutUnusedEntry>();
  /** BQ に既にある記録（シート取込）: 前月の未使用企業のうち先頭 2 社 */
  const sheet = new Map<string, { companyId: string; reason: string | null; remarks: string | null }>();
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const me = { email: VIEWER, name: 'テスト', verified: true, authMode: 'google', mock: true, ownerUserId: null, overrideCompanyIds: [], canEdit: true };
  const meta = { dataVersion: refresh.dataVersion, dataDate: refresh.dataDate, refreshedAt: refresh.refreshedAt, refreshStatus: 'ok', asOf: today, month: cur, bizDays: monthProgress(cur, refresh.dataDate), ownerSource: 'sales_staff', scoutLimitPeriodDefault: 'month', benchMinN: 5, login: { availableFrom: '2026-05-15' }, caveats: CAVEATS, holidaysVersion: '2026-10', dataSchemaVersion: 1, mock: true };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url.startsWith('/api/meta')) return Response.json(meta);
    if (url.startsWith('/api/me')) return Response.json(me);
    let m = url.match(/^\/api\/board\?month=(\d{4}-\d{2})/);
    if (m) return Response.json(await boardFor(m[1]));
    m = url.match(/^\/api\/scout-unused\?month=(\d{4}-\d{2})$/);
    if (m) return Response.json({ month: m[1], entries: Array.from(entries.values()).filter((e) => e.month === m![1]), sheet: m[1] === prev ? Array.from(sheet.values()) : [] });
    m = url.match(/^\/api\/scout-unused\/(\d+)\/(\d{4}-\d{2})$/);
    if (m && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { reason: string | null; remarks: string | null };
      bodies.push(body);
      const e: ScoutUnusedEntry = { companyId: m[1], month: m[2], reason: body.reason, remarks: body.remarks, updatedBy: VIEWER, updatedAt: '2026-10-23T10:00:00.000Z', bqSyncedAt: '2026-10-23T10:00:01.000Z', bqError: null };
      entries.set(`${m[1]}|${m[2]}`, e);
      return Response.json({ entry: e, bq: { synced: true, error: null } }, { status: 201 });
    }
    if (m && method === 'DELETE') {
      entries.delete(`${m[1]}|${m[2]}`);
      return Response.json({ entry: null, bq: { synced: true, error: null } });
    }
    if (url === '/api/scout-unused/sync') return Response.json({ synced: 0, failed: 0, pending: 0 });
    return Response.json({ error: 'nf', code: 'notFound' }, { status: 404 });
  }) as typeof fetch;
  const b = await boardFor(prev);
  const unused = b.companies.filter((c) => isScoutUnused(c)).sort((a, x) => (a.owner.name ?? '～').localeCompare(x.owner.name ?? '～', 'ja') || a.name.localeCompare(x.name, 'ja'));
  sheet.set(unused[0].id, { companyId: unused[0].id, reason: SCOUT_UNUSED_REASONS[3], remarks: '先方事情' });
  sheet.set(unused[1].id, { companyId: unused[1].id, reason: null, remarks: null });
  return { cur, prev, boardFor, entries, sheet, calls, bodies, unused };
}

describe('スカウト未利用の登録ページ', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('左レールのリンクから開ける。既定は前月。契約中・送信 0・枠ありの企業だけが担当付きで並び、理由を選んで保存すると PUT される', async () => {
    const f = await setup();
    window.history.replaceState(null, '', '/');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('link', { name: /スカウト未利用/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('link', { name: /スカウト未利用/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/scout-unused'));
    await waitFor(() => expect(screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' })).toBeTruthy(), { timeout: 8000 });
    // 対象は前月に固定（月の切替は無い）。見出しに前月と対象の説明
    expect(screen.queryByLabelText('対象月')).toBeNull();
    expect(document.querySelector('.page-head')?.textContent).toContain(fmtMonthJa(f.prev));
    expect(document.querySelector('.page-head')?.textContent).toContain('求人を掲載しながらスカウトを 1 件も送らなかった、現在契約中の企業');
    expect(f.calls).toContain(`GET /api/board?month=${f.prev}`);
    const board = await f.boardFor(f.prev);
    const expected = board.companies.filter((c) => isScoutUnused(c));
    expect(expected.length).toBeGreaterThan(0);
    // 対象 = 前月に 1 日でも掲載（jobsInMonth > 0）・前月の送信 0・今日時点で契約中。枠数では絞らない（枠 0 / 未設定の企業も出る）
    for (const c of expected) {
      expect(c.m.jobsInMonth).toBeGreaterThan(0);
      expect(c.m.sent).toBe(0);
      expect(['active', 'ending_30d']).toContain(c.state);
    }
    const sent0Contracted = board.companies.filter((c) => (c.state === 'active' || c.state === 'ending_30d') && c.m.sent === 0 && !['DA', 'RPO', 'NW'].includes(c.type));
    expect(sent0Contracted.some((c) => c.m.jobsInMonth === 0)).toBe(true);
    expect(expected.length).toBeLessThan(sent0Contracted.length);
    expect(expected.some((c) => !c.limits.scout)).toBe(true);
    const table = screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBe(expected.length);
    // 列順は 種別 / CS 担当 / 企業名 / 理由 / 補足 / 登録（枠の列は無い。列幅は固定）
    expect(Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['種別', 'CS 担当', '企業名', '理由', '補足', '登録']);
    expect(table.querySelectorAll('colgroup col').length).toBe(6);
    // 広告掲載の企業は企業名セルに ad クラス（黄色）、それ以外には無い
    for (const tr of rows) {
      const c = expected.find((x) => x.id === tr.getAttribute('data-company'))!;
      expect(tr.querySelector('td.company')!.classList.contains('ad')).toBe(c.contractKind === 'ad');
      expect(tr.querySelector('td.company')!.getAttribute('title')).toContain(c.name);
    }
    // プルダウンは 8 件（8 → 1 の順）
    const first = rows[0];
    const sel = within(first as HTMLElement).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', ...SCOUT_UNUSED_REASONS]);
    expect(sel.options[1].text).toBe('8. どうしても連絡つかず不明');
    // BQ に既にある記録（シート取込）は入力欄にそのまま出る。「取り込む」ボタンは無い。保存ボタンは変更するまで無効
    expect(sel.value).toBe(SCOUT_UNUSED_REASONS[3]);
    expect((within(first as HTMLElement).getByRole('textbox') as HTMLInputElement).value).toBe('先方事情');
    expect(within(first as HTMLElement).getByText('登録済み')).toBeTruthy();
    expect(screen.queryByText('BQ 登録済み（シート）')).toBeNull();
    expect(screen.queryByRole('button', { name: '取り込む' })).toBeNull();
    expect(screen.getByText(/登録済み 2 社/)).toBeTruthy();
    // DA / RPO は対象外
    for (const tr of rows) expect(['DA', 'RPO', 'NW']).not.toContain(within(tr as HTMLElement).getAllByRole('cell')[0].textContent);
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    const save = within(first as HTMLElement).getByRole('button', { name: '登録' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(sel, { target: { value: SCOUT_UNUSED_REASONS[4] } });
    fireEvent.change(within(first as HTMLElement).getByRole('textbox'), { target: { value: '運用開始直後' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const id = first.getAttribute('data-company')!;
    await waitFor(() => expect(f.calls).toContain(`PUT /api/scout-unused/${id}/${f.prev}`));
    expect(f.bodies[0]).toEqual({ reason: '4. サイトの機能が分かりづらく使い勝手が悪い等、技術的な問題で未利用', remarks: '運用開始直後' });
    await waitFor(() => expect(within(first as HTMLElement).getByText('BQ 反映済み')).toBeTruthy());
    expect(screen.getByText(/登録済み 2 社/)).toBeTruthy();
    // 空にして保存 → DELETE（アプリの登録は消え、シートの記録が再び入力欄に出る）
    fireEvent.change(sel, { target: { value: '' } });
    fireEvent.change(within(first as HTMLElement).getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(within(first as HTMLElement).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(f.calls).toContain(`DELETE /api/scout-unused/${id}/${f.prev}`));
    await waitFor(() => expect(within(first as HTMLElement).getByText('登録済み')).toBeTruthy());
    expect(sel.value).toBe(SCOUT_UNUSED_REASONS[3]);
  });

  it('登録済みの行をもう一度編集して保存すると更新（PUT）される', async () => {
    const f = await setup();
    window.history.replaceState(null, '', '/scout-unused');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' })).toBeTruthy(), { timeout: 8000 });
    const first = screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' }).querySelector('tbody tr')!;
    const id = first.getAttribute('data-company')!;
    const sel = within(first as HTMLElement).getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: SCOUT_UNUSED_REASONS[0] } });
    fireEvent.click(within(first as HTMLElement).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(within(first as HTMLElement).getByText('BQ 反映済み')).toBeTruthy());
    // 登録後も入力欄は有効で、値を変えると登録ボタンが再び有効になる
    expect(sel.disabled).toBe(false);
    expect((within(first as HTMLElement).getByRole('button', { name: '登録' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(sel, { target: { value: SCOUT_UNUSED_REASONS[2] } });
    fireEvent.change(within(first as HTMLElement).getByRole('textbox'), { target: { value: '更新後の補足' } });
    fireEvent.click(within(first as HTMLElement).getByRole('button', { name: '登録' }));
    await waitFor(() => expect(f.calls.filter((c) => c === `PUT /api/scout-unused/${id}/${f.prev}`).length).toBe(2));
    expect(f.bodies[1]).toEqual({ reason: '6. 既に採用でき、案件クローズ', remarks: '更新後の補足' });
    expect(f.entries.get(`${id}|${f.prev}`)?.reason).toBe('6. 既に採用でき、案件クローズ');
  });

  it('CS 担当のプルダウンで絞り込める（URL に owner=）', async () => {
    const f = await setup();
    window.history.replaceState(null, '', '/scout-unused');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' })).toBeTruthy(), { timeout: 8000 });
    const group = screen.getByRole('group', { name: 'CS 担当' });
    const boxes = group.querySelectorAll('input[type=checkbox]');
    expect(boxes.length).toBeGreaterThan(1);
    const details = group.closest('details') ?? group.querySelector('details') ?? (group as HTMLElement);
    if (details instanceof HTMLDetailsElement) details.open = true;
    fireEvent.click(boxes[0]);
    await waitFor(() => expect(window.location.search).toContain('owner='));
    const key = decodeURIComponent(window.location.search.match(/owner=([^&]+)/)![1]);
    const board = await f.boardFor(f.prev);
    const expected = board.companies.filter((c) => isScoutUnused(c) && ownerKey(c) === key).length;
    await waitFor(() => expect(screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' }).querySelectorAll('tbody tr').length).toBe(expected));
    fireEvent.click(screen.getByRole('button', { name: /クリア/ }));
    await waitFor(() => expect(window.location.search).not.toContain('owner='));
  });

  it('担当=自分 で絞り込める。URL に month は無い（前月固定）', async () => {
    const f = await setup();
    window.history.replaceState(null, '', '/scout-unused');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' })).toBeTruthy(), { timeout: 8000 });
    const board = await f.boardFor(f.prev);
    const mine = board.companies.filter((c) => isScoutUnused(c) && c.isMine).length;
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).toContain('mine=1'));
    // 自分が担当の企業が無ければ空状態（表は出ない）
    await waitFor(() => expect(mine === 0 ? screen.queryByText('該当する企業がありません') !== null : screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' }).querySelectorAll('tbody tr').length === mine).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).not.toContain('mine=1'));
    expect(window.location.search).not.toContain('month=');
    expect(f.calls.some((c) => c.includes(`month=${f.cur}`))).toBe(false);
    expect(f.calls).toContain(`GET /api/scout-unused?month=${f.prev}`);
  });

  it('登録状況 / 企業種別 / 契約種別 のフィルタで行数と URL が変わり、CS 担当の選択肢は他のフィルタに連動する。クリアで全部消える', async () => {
    const f = await setup();
    window.history.replaceState(null, '', '/scout-unused');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' })).toBeTruthy(), { timeout: 8000 });
    const tableRows = () => screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' }).querySelectorAll('tbody tr').length;
    const all = f.unused;
    // 登録状況: 登録済み = シートの 2 社、未登録 = 残り
    fireEvent.change(screen.getByLabelText('登録状況'), { target: { value: 'done' } });
    await waitFor(() => expect(window.location.search).toContain('status=done'));
    await waitFor(() => expect(tableRows()).toBe(2));
    expect(screen.getByText(/登録済み 2 社/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('登録状況'), { target: { value: 'none' } });
    await waitFor(() => expect(tableRows()).toBe(all.length - 2));
    expect(screen.getByText(/登録済み 0 社/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('登録状況'), { target: { value: '' } });
    await waitFor(() => expect(window.location.search).not.toContain('status='));
    // 契約種別: 広告掲載 だけ
    const kindGroup = screen.getByRole('group', { name: '契約種別' });
    const kindBox = (name: string) => Array.from(kindGroup.querySelectorAll('label')).find((l) => l.textContent?.startsWith(name))!.querySelector('input[type=checkbox]') as HTMLInputElement;
    const adCount = all.filter((c) => c.contractKind === 'ad').length;
    expect(kindGroup.textContent).toContain(String(adCount));
    fireEvent.click(kindBox('広告掲載'));
    await waitFor(() => expect(window.location.search).toContain('kind=ad'));
    await waitFor(() => expect(tableRows()).toBe(adCount));
    for (const td of screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' }).querySelectorAll('td.company')) expect(td.classList.contains('ad')).toBe(true);
    fireEvent.click(kindBox('広告掲載'));
    await waitFor(() => expect(window.location.search).not.toContain('kind='));
    // 企業種別: 直接 だけ → CS 担当の選択肢が 直接 のアカウントを持つ企業の担当だけになる（件数も合う）
    const typeGroup = screen.getByRole('group', { name: '企業種別' });
    expect(Array.from(typeGroup.querySelectorAll('label')).map((l) => l.textContent?.replace(/\d+$/, ''))).toEqual(expect.arrayContaining(['直接', '紹介', '派遣']));
    expect(Array.from(typeGroup.querySelectorAll('label')).some((l) => /^(DA|RPO|NW)/.test(l.textContent ?? ''))).toBe(false);
    const typeBox = (name: string) => Array.from(typeGroup.querySelectorAll('label')).find((l) => l.textContent?.startsWith(name))!.querySelector('input[type=checkbox]') as HTMLInputElement;
    fireEvent.click(typeBox('直接'));
    await waitFor(() => expect(window.location.search).toContain('type='));
    const direct = all.filter((c) => boardAccountTypes(c).includes('直接'));
    expect(direct.length).toBeGreaterThan(0);
    await waitFor(() => expect(tableRows()).toBe(direct.length));
    const ownerGroup = screen.getByRole('group', { name: 'CS 担当' });
    const expectedOwners = new Map<string, number>();
    for (const c of direct) expectedOwners.set(ownerKey(c), (expectedOwners.get(ownerKey(c)) ?? 0) + 1);
    const labels = Array.from(ownerGroup.querySelectorAll('label'));
    expect(labels.length).toBe(expectedOwners.size);
    expect(labels.map((l) => Number(l.querySelector('.cnt')?.textContent)).reduce((a, b) => a + b, 0)).toBe(direct.length);
    // 直接 の企業を担当していない担当は選択肢から消えている
    const allOwners = new Set(all.map((c) => ownerKey(c)));
    expect(allOwners.size).toBeGreaterThanOrEqual(expectedOwners.size);
    // 逆に、CS 担当を選ぶと企業種別の件数がその担当の企業だけになる
    fireEvent.click(ownerGroup.querySelector('input[type=checkbox]')!);
    await waitFor(() => expect(window.location.search).toContain('owner='));
    const key = decodeURIComponent(window.location.search.match(/owner=([^&]+)/)![1]);
    const ofOwner = all.filter((c) => ownerKey(c) === key);
    const typeCounts = new Map(Array.from(typeGroup.querySelectorAll('label')).map((l) => [l.textContent?.replace(/\d+$/, ''), Number(l.querySelector('.cnt')?.textContent)]));
    expect(typeCounts.get('直接')).toBe(ofOwner.filter((c) => boardAccountTypes(c).includes('直接')).length);
    expect(typeCounts.get('紹介')).toBe(ofOwner.filter((c) => boardAccountTypes(c).includes('紹介')).length);
    // クリアで全部消える
    fireEvent.click(screen.getByRole('button', { name: /クリア/ }));
    await waitFor(() => expect(window.location.search).toBe(''));
    await waitFor(() => expect(tableRows()).toBe(all.length));
  });
});
