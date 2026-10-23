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
    if (m) return Response.json({ month: m[1], entries: Array.from(entries.values()).filter((e) => e.month === m![1]), sheet: [] });
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
  return { cur, prev, boardFor, entries, calls, bodies };
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
    expect((screen.getByLabelText('対象月') as HTMLSelectElement).value).toBe(f.prev);
    expect(document.querySelector('.page-head')?.textContent).toContain(fmtMonthJa(f.prev));
    const board = await f.boardFor(f.prev);
    const expected = board.companies.filter((c) => isScoutUnused(c, board.meta));
    expect(expected.length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBe(expected.length);
    expect(Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual(['企業名', '種別', '営業担当', '枠', '理由', '補足', '保存']);
    // プルダウンは 8 件（8 → 1 の順）
    const first = rows[0];
    const sel = within(first as HTMLElement).getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', ...SCOUT_UNUSED_REASONS]);
    expect(sel.options[1].text).toBe('8. どうしても連絡つかず不明');
    // 保存ボタンは変更するまで無効
    const save = within(first as HTMLElement).getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(sel, { target: { value: SCOUT_UNUSED_REASONS[4] } });
    fireEvent.change(within(first as HTMLElement).getByRole('textbox'), { target: { value: '運用開始直後' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const id = first.getAttribute('data-company')!;
    await waitFor(() => expect(f.calls).toContain(`PUT /api/scout-unused/${id}/${f.prev}`));
    expect(f.bodies[0]).toEqual({ reason: '4. サイトの機能が分かりづらく使い勝手が悪い等、技術的な問題で未利用', remarks: '運用開始直後' });
    await waitFor(() => expect(within(first as HTMLElement).getByText('BQ 反映済み')).toBeTruthy());
    expect(screen.getByText(/登録済み 1 社/)).toBeTruthy();
    // 空にして保存 → DELETE
    fireEvent.change(sel, { target: { value: '' } });
    fireEvent.change(within(first as HTMLElement).getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(within(first as HTMLElement).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(f.calls).toContain(`DELETE /api/scout-unused/${id}/${f.prev}`));
    await waitFor(() => expect(within(first as HTMLElement).getByText('未登録')).toBeTruthy());
  });

  it('担当=自分 で絞り込み、月を切り替えると URL と一覧が変わる', async () => {
    const f = await setup();
    window.history.replaceState(null, '', '/scout-unused');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' })).toBeTruthy(), { timeout: 8000 });
    const board = await f.boardFor(f.prev);
    const mine = board.companies.filter((c) => isScoutUnused(c, board.meta) && c.isMine).length;
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).toContain('mine=1'));
    // 自分が担当の企業が無ければ空状態（表は出ない）
    await waitFor(() => expect(mine === 0 ? screen.queryByText('該当する企業がありません') !== null : screen.getByRole('table', { name: 'スカウト未使用の企業と理由の登録' }).querySelectorAll('tbody tr').length === mine).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    fireEvent.change(screen.getByLabelText('対象月'), { target: { value: f.cur } });
    await waitFor(() => expect(window.location.search).toContain(`month=${f.cur}`));
    await waitFor(() => expect(f.calls).toContain(`GET /api/scout-unused?month=${f.cur}`));
  });
});
