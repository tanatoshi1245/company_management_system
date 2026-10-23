import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/app/App';
import { clearResourceCache } from '../../src/app/lib/useResource';
import { MockBqClient } from '../../src/worker/bq/mockClient';
import { loadBoardCore, mergeBoard } from '../../src/worker/services/boardService';
import { loadCompanyCore, mergeCompanyDetail } from '../../src/worker/services/companyService';
import { mockRefreshLog } from '../../src/worker/bq/fixtures';
import { addDays, addMonths, fmtMonthShort, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { monthProgress } from '../../src/shared/calendar/businessDays';
import { CAVEATS } from '../../src/shared/caveats';
import { hasAnyTarget, type TargetRecord } from '../../src/shared/schema/targets';
import { CURRENT_STATES } from '../../src/shared/metrics/board';
import type { TargetRow } from '../../src/worker/d1/targetsRepo';

const VIEWER = 'cs@daijob.com';

interface Store {
  targets: Map<string, TargetRecord>;
  history: { id: number; at: string; actor: string; action: string; entity: string; entityId: string; companyId: string; before: unknown; after: unknown }[];
  calls: string[];
}

async function setup(plans: Record<string, Record<string, number>> = {}) {
  const today = todayJst();
  const log = mockRefreshLog()[0];
  const refresh = { dataVersion: String(log.run_date), dataDate: addDays(today, -1), refreshedAt: String(log.finished_at), refreshStatus: 'ok' as const, lastError: null };
  const month = monthOf(today);
  const client = new MockBqClient();
  const core = await loadBoardCore(client, month, refresh);
  const store: Store = { targets: new Map(), history: [], calls: [] };
  const toRow = (r: TargetRecord): TargetRow => ({ company_id: Number(r.companyId), target_month: r.month, scout_sent_target: r.values.scout_sent, application_target: r.values.applications, interested_target: r.values.interested, view_target: r.values.views, hire_target: r.values.hires, stage_targets_json: JSON.stringify(r.values.stages ?? {}), note: r.note, created_by: r.createdBy, created_at: r.createdAt, updated_by: r.updatedBy, updated_at: r.updatedAt });
  const boardFor = () => {
    const byMonth = new Map<string, TargetRow>();
    for (const r of store.targets.values()) if (r.month === month) byMonth.set(r.companyId, toRow(r));
    return mergeBoard(core, byMonth, new Map(), VIEWER, 5);
  };
  const me = { email: VIEWER, name: 'テスト', verified: true, authMode: 'google', mock: true, ownerUserId: null, overrideCompanyIds: [], canEdit: true };
  const biz = monthProgress(month, refresh.dataDate);
  const meta = { dataVersion: refresh.dataVersion, dataDate: refresh.dataDate, refreshedAt: refresh.refreshedAt, refreshStatus: 'ok', asOf: today, month, bizDays: biz, ownerSource: 'sf_account_owner', scoutLimitPeriodDefault: 'month', benchMinN: 5, login: { availableFrom: '2026-05-15' }, caveats: CAVEATS, holidaysVersion: '2026-10', dataSchemaVersion: 1, mock: true };
  let seq = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    store.calls.push(`${method} ${url}`);
    if (url.startsWith('/api/meta')) return Response.json(meta);
    if (url.startsWith('/api/me')) return Response.json(me);
    if (url.startsWith('/api/board')) return Response.json(boardFor());
    if (url.startsWith('/api/health')) return Response.json({ ok: true, asOf: today, mock: true, bqKeyConfigured: false, d1Configured: true, authMode: 'google', googleLoginConfigured: true, allowedDomains: ['daijob.com'], allowedEmailsCount: 0, dataVersion: 1 });
    if (url.startsWith('/api/settings/plan-defaults')) return Response.json({ plans, updatedAt: null });
    if (url.startsWith('/api/settings/overrides')) return Response.json({ rows: [] });
    let m = url.match(/^\/api\/targets\?month=(\d{4}-\d{2})$/);
    if (m) return Response.json({ month: m[1], rows: Array.from(store.targets.values()).filter((r) => r.month === m![1]) });
    m = url.match(/^\/api\/companies\/(\d+)\/targets\/history/);
    if (m) return Response.json({ rows: store.history.filter((h) => h.companyId === m![1]).reverse() });
    m = url.match(/^\/api\/companies\/(\d+)\/targets\?from=(\d{4}-\d{2})&to=(\d{4}-\d{2})$/);
    if (m) return Response.json({ companyId: m[1], from: m[2], to: m[3], rows: Array.from(store.targets.values()).filter((r) => r.companyId === m![1] && r.month >= m![2] && r.month <= m![3]) });
    m = url.match(/^\/api\/companies\/(\d+)\/targets\/(\d{4}-\d{2})$/);
    if (m && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const { note, ...values } = body;
      const key = `${m[1]}|${m[2]}`;
      const before = store.targets.get(key) ?? null;
      const at = new Date(Date.UTC(2026, 9, 23, 1, 0, ++seq)).toISOString();
      const rec: TargetRecord = { companyId: m[1], month: m[2], values: values as TargetRecord['values'], note: (note as string | null) ?? null, createdBy: before?.createdBy ?? VIEWER, createdAt: before?.createdAt ?? at, updatedBy: VIEWER, updatedAt: at };
      store.targets.set(key, rec);
      store.history.push({ id: seq, at, actor: VIEWER, action: before ? 'update' : 'create', entity: 'company_targets', entityId: `${m[1]}/${m[2]}`, companyId: m[1], before: before ? { values: before.values, note: before.note } : null, after: { values, note } });
      return Response.json(rec, { status: before ? 200 : 201 });
    }
    if (m && method === 'DELETE') {
      store.targets.delete(`${m[1]}|${m[2]}`);
      return new Response(null, { status: 204 });
    }
    m = url.match(/^\/api\/companies\/(\d+)\?month=(\d{4}-\d{2})/);
    if (m) {
      const c = await loadCompanyCore(client, m[1], m[2], refresh);
      if (c) {
        const rows = Array.from(store.targets.values()).filter((r) => r.companyId === m![1]).map(toRow);
        return Response.json(mergeCompanyDetail(c, rows, null, VIEWER, 5));
      }
    }
    return Response.json({ error: 'nf', code: 'notFound' }, { status: 404 });
  }) as typeof fetch;
  const first = core.companies.find((c) => c.plan === 'DJ' && c.limits.scout)!;
  return { store, month, board: boardFor(), company: first };
}

describe('目標フォーム', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('差分のある月だけ PUT、未保存バッジ、前月からコピー、プラン既定値の適用、履歴に自分のメール', async () => {
    const { store, month, company } = await setup({ DJ: { scout_sent: 50, hires: 1 } });
    window.history.replaceState(null, '', `/targets/${company.id}?from=${month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '月別の目標' })).toBeTruthy());
    expect(screen.getByText('変更なし')).toBeTruthy();
    const m1 = fmtMonthShort(month);
    const m2 = fmtMonthShort(addMonths(month, 1));
    const m3 = fmtMonthShort(addMonths(month, 2));
    const cell = (m: string, row: string) => screen.getByLabelText(`${m} ${row}`) as HTMLInputElement;
    fireEvent.change(cell(m1, 'スカウト送信'), { target: { value: '100' } });
    fireEvent.blur(cell(m1, 'スカウト送信'), { target: { value: '100' } });
    fireEvent.change(cell(m2, '応募'), { target: { value: '10' } });
    fireEvent.blur(cell(m2, '応募'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByText(/未保存の変更 2 か月/)).toBeTruthy());
    // 不正値は赤枠で、保存を止める
    fireEvent.change(cell(m2, '採用'), { target: { value: 'abc' } });
    fireEvent.blur(cell(m2, '採用'), { target: { value: 'abc' } });
    await waitFor(() => expect(cell(m2, '採用').getAttribute('aria-invalid')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: '差分を保存' }));
    await waitFor(() => expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('赤枠'))).toBe(true));
    expect(store.calls.filter((c) => c.startsWith('PUT')).length).toBe(0);
    fireEvent.change(cell(m2, '採用'), { target: { value: '' } });
    fireEvent.blur(cell(m2, '採用'), { target: { value: '' } });
    await waitFor(() => expect(cell(m2, '採用').getAttribute('aria-invalid')).toBeNull());
    // 前月からコピー: m3 の空セルに m2 の値（応募 10）
    fireEvent.click(screen.getByRole('button', { name: `${m3} に前月からコピー` }));
    await waitFor(() => expect(cell(m3, '応募').value).toBe('10'));
    expect(cell(m3, 'スカウト送信').value).toBe('');
    // プラン既定値: 空セルにだけ（m1 のスカウト 100 はそのまま、m2 は 50）
    fireEvent.click(screen.getByRole('button', { name: 'プラン既定値を適用' }));
    await waitFor(() => expect(cell(m2, 'スカウト送信').value).toBe('50'));
    expect(cell(m1, 'スカウト送信').value).toBe('100');
    expect(cell(m1, '採用').value).toBe('1');
    // 保存: 12 か月すべてが dirty（既定値を全列に入れたため）
    fireEvent.click(screen.getByRole('button', { name: '差分を保存' }));
    await waitFor(() => expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('か月分を保存しました'))).toBe(true));
    const puts = store.calls.filter((c) => c.startsWith('PUT'));
    expect(puts.length).toBe(12);
    expect(store.targets.get(`${company.id}|${month}`)?.values.scout_sent).toBe(100);
    expect(store.targets.get(`${company.id}|${addMonths(month, 1)}`)?.values).toMatchObject({ scout_sent: 50, applications: 10, hires: 1 });
    // 履歴
    await waitFor(() => expect(within(screen.getByRole('table', { name: '変更履歴' })).getAllByText(VIEWER).length).toBeGreaterThan(0));
    // 2 回目: 1 セルだけ変えると PUT は 1 回
    const before = store.calls.filter((c) => c.startsWith('PUT')).length;
    await waitFor(() => expect(screen.getByText('変更なし')).toBeTruthy());
    fireEvent.change(cell(m1, '応募'), { target: { value: '7' } });
    fireEvent.blur(cell(m1, '応募'), { target: { value: '7' } });
    await waitFor(() => expect(screen.getByText(/未保存の変更 1 か月/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '差分を保存' }));
    await waitFor(() => expect(store.calls.filter((c) => c.startsWith('PUT')).length).toBe(before + 1));
    expect(store.calls[store.calls.length - 1]).toBe(`PUT /api/companies/${company.id}/targets/${month}`);
  });

  it('目標一覧: 目標あり件数・未設定のみ・担当=自分、企業詳細の目標比較表に反映', async () => {
    const { store, month, board, company } = await setup();
    const key = `${company.id}|${month}`;
    store.targets.set(key, { companyId: company.id, month, values: { scout_sent: 100, interested: null, applications: 10, views: null, hires: null, stages: {} }, note: null, createdBy: VIEWER, createdAt: 'x', updatedBy: VIEWER, updatedAt: '2026-10-23T01:00:00.000Z' });
    window.history.replaceState(null, '', `/targets?month=${month}`);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '企業別の目標' })).toBeTruthy());
    const table = screen.getByRole('table', { name: '企業別の目標' });
    const current = board.companies.filter((c) => CURRENT_STATES.has(c.state) || c.m.contracted).length;
    expect(table.querySelectorAll('tbody tr').length).toBe(current);
    const row = within(table).getByText(company.name).closest('tr')!;
    expect(row.textContent).toContain('100');
    expect(row.querySelectorAll('.tpb').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /未設定のみ/ }));
    await waitFor(() => expect(window.location.search).toContain('missing=1'));
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBe(current - 1));
    expect(within(table).queryByText(company.name)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).toContain('mine=1'));
    // 企業詳細の目標比較
    window.history.pushState(null, '', `/companies/${company.id}?month=${month}`);
    window.dispatchEvent(new Event('popstate'));
    await waitFor(() => expect(screen.getByRole('table', { name: '目標と実績' })).toBeTruthy());
    expect(within(screen.getByRole('table', { name: '目標と実績' })).getByText('スカウト送信').closest('tr')!.textContent).toContain('100');
    expect(hasAnyTarget(store.targets.get(key)!.values)).toBe(true);
  });
});
