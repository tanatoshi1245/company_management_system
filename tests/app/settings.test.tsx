import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/app/App';
import { clearResourceCache } from '../../src/app/lib/useResource';
import { MockBqClient } from '../../src/worker/bq/mockClient';
import { loadBoardCore, mergeBoard } from '../../src/worker/services/boardService';
import { mockRefreshLog } from '../../src/worker/bq/fixtures';
import { addDays, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { monthProgress } from '../../src/shared/calendar/businessDays';
import { CAVEATS } from '../../src/shared/caveats';
import { DERIVED_DEFINITIONS, METRICS } from '../../src/shared/metrics/definitions';

async function setup() {
  const today = todayJst();
  const log = mockRefreshLog()[0];
  const refresh = { dataVersion: String(log.run_date), dataDate: addDays(today, -1), refreshedAt: String(log.finished_at), refreshStatus: 'ok' as const, lastError: null };
  const month = monthOf(today);
  const core = await loadBoardCore(new MockBqClient(), month, refresh);
  const board = mergeBoard(core, new Map(), new Map(), 'cs@daijob.com', 5);
  const me = { email: 'cs@daijob.com', name: 'テスト', verified: true, authMode: 'google', mock: true, ownerUserId: null, overrideCompanyIds: [], canEdit: true };
  const meta = { dataVersion: refresh.dataVersion, dataDate: refresh.dataDate, refreshedAt: refresh.refreshedAt, refreshStatus: 'ok', asOf: today, month, bizDays: monthProgress(month, refresh.dataDate), ownerSource: 'sf_account_owner', scoutLimitPeriodDefault: 'month', benchMinN: 5, login: { availableFrom: '2026-05-15' }, caveats: CAVEATS, holidaysVersion: '2026-10', dataSchemaVersion: 1, mock: true };
  const plans: Record<string, Record<string, number>> = { DJ: { scout_sent: 100 } };
  const calls: { method: string; url: string; body?: unknown }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith('/api/meta')) return Response.json(meta);
    if (url.startsWith('/api/me')) return Response.json(me);
    if (url.startsWith('/api/board')) return Response.json(board);
    if (url.startsWith('/api/health')) return Response.json({ ok: true, asOf: today, mock: true, bqKeyConfigured: false, d1Configured: true, authMode: 'google', googleLoginConfigured: true, allowedDomains: ['daijob.com'], allowedEmailsCount: 0, dataVersion: 1 });
    if (url.startsWith('/api/settings/plan-defaults') && method === 'PUT') {
      const b = init?.body ? (JSON.parse(String(init.body)) as { plan: string; values: Record<string, number> }) : { plan: '', values: {} };
      plans[b.plan] = b.values;
      return Response.json({ plans, updatedAt: null });
    }
    if (url.startsWith('/api/settings/plan-defaults')) return Response.json({ plans, updatedAt: null });
    if (url.startsWith('/api/settings/overrides')) return Response.json({ rows: [{ companyId: board.companies[0].id, csOwnerEmail: 'cs@daijob.com', csOwnerName: '佐藤', scoutLimitPeriod: 'contract', scoutLimitOverride: 300, jobLimitOverride: null, memo: '引き継ぎ', updatedBy: 'cs@daijob.com', updatedAt: '2026-10-23T01:00:00.000Z' }] });
    if (url.startsWith('/api/admin/cache/bump')) return Response.json({ cacheEpoch: '2' });
    return Response.json({ error: 'nf', code: 'notFound' }, { status: 404 });
  }) as typeof fetch;
  return { board, calls, plans };
}

describe('設定・ヘルプ', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('ヘルプ: 指標の定義の件数 = レジストリ', async () => {
    await setup();
    window.history.replaceState(null, '', '/help');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '指標の定義' })).toBeTruthy());
    expect(screen.getByRole('table', { name: '指標の定義' }).querySelectorAll('tbody tr').length).toBe(METRICS.length);
    expect(document.querySelectorAll('#derived .def-row').length).toBe(DERIVED_DEFINITIONS.length);
    expect(document.querySelectorAll('.caveat-list li').length).toBe(CAVEATS.length);
  });

  it('設定: プラン既定値の編集（行 = プラン）と保存、担当上書き一覧、キャッシュ破棄', async () => {
    const { board, calls } = await setup();
    window.history.replaceState(null, '', '/settings');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: 'プラン別の既定目標' })).toBeTruthy());
    const plans = new Set(board.companies.map((c) => c.plan).filter(Boolean));
    const table = screen.getByRole('table', { name: 'プラン別の既定目標' });
    expect(table.querySelectorAll('tbody tr').length).toBe(plans.size);
    const input = screen.getByLabelText('DJ スカウト送信') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('100'));
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('DJ 応募'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'DJ を保存' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings/plan-defaults')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ plan: 'DJ', values: { scout_sent: 120, applications: 8 } });
    // 担当上書き一覧
    const ov = screen.getByRole('table', { name: '担当・枠の上書き一覧' });
    expect(ov.textContent).toContain(board.companies[0].name);
    expect(ov.textContent).toContain('佐藤');
    expect(ov.textContent).toContain('契約期間');
    // キャッシュ破棄
    fireEvent.click(screen.getByRole('button', { name: 'Worker のキャッシュを捨てる' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/cache/bump')).toBe(true));
  });
});
