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

/** Worker と同じ組み立てでフィクスチャの応答を作り、fetch を差し替える */
async function fixtures(viewer = 'preview@daijob.com') {
  const today = todayJst();
  const log = mockRefreshLog()[0];
  const refresh = { dataVersion: String(log.run_date), dataDate: addDays(today, -1), refreshedAt: String(log.finished_at), refreshStatus: 'ok' as const, lastError: null };
  const month = monthOf(today);
  const core = await loadBoardCore(new MockBqClient(), month, refresh);
  const board = mergeBoard(core, new Map(), new Map(), viewer, 5);
  const me = { email: viewer, name: 'テスト', verified: false, authMode: 'mock', mock: true, ownerUserId: null, overrideCompanyIds: [], canEdit: false };
  const meta = { dataVersion: refresh.dataVersion, dataDate: refresh.dataDate, refreshedAt: refresh.refreshedAt, refreshStatus: 'ok', asOf: today, month, bizDays: monthProgress(month, refresh.dataDate), ownerSource: 'sf_account_owner', scoutLimitPeriodDefault: 'month', benchMinN: 5, login: { availableFrom: '2026-05-15' }, caveats: CAVEATS, holidaysVersion: '2026-10', dataSchemaVersion: 1, mock: true };
  return { board, me, meta, month };
}

describe('ホーム（ボード）', () => {
  const calls: string[] = [];
  beforeEach(async () => {
    clearResourceCache();
    window.history.replaceState(null, '', '/');
    const f = await fixtures();
    calls.length = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('/api/meta')) return Response.json(f.meta);
      if (url.startsWith('/api/me')) return Response.json(f.me);
      if (url.startsWith('/api/board')) return Response.json(f.board);
      return Response.json({ error: 'nf', code: 'notFound' }, { status: 404 });
    }) as typeof fetch;
  });
  afterEach(() => cleanup());

  it('KPI タイル・実数のボードが描画され、担当=自分 / CS 担当 で絞り込める。モード切替で再取得しない', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業のヒートマップ' })).toBeTruthy());
    const table = screen.getByRole('table', { name: '契約企業のヒートマップ' });
    const rowsBefore = table.querySelectorAll('tbody tr').length;
    expect(rowsBefore).toBeGreaterThan(20);
    expect(screen.getByText('契約企業')).toBeTruthy();
    expect(screen.getByText('スカウト消化率')).toBeTruthy();
    expect(screen.getByText('スカウト利用率')).toBeTruthy();
    expect(screen.queryByText('求人枠消化率（中央値）')).toBeNull();
    expect(screen.queryByText(/注目/)).toBeNull();
    for (const h of ['掲載 / 枠', '閲覧', '応募', '送信 / 枠', '返信（当月）', '選考中', '採用', '最終ログイン', '契約残']) expect(screen.getByRole('columnheader', { name: new RegExp(h) })).toBeTruthy();
    // 実数の分数表記（割合ではない）と、担当の苗字 + 種別
    const first = table.querySelector('tbody tr')!;
    expect(first.querySelector('td[data-col], td.heat')!.textContent).toMatch(/^\d[\d,]* \/ (\d[\d,]*|–)/);
    expect(first.querySelector('.co-strip .own')!.textContent!.trim().split(/\s/).length).toBe(1);
    expect(first.querySelector('.co-strip .badge')).toBeTruthy();
    expect(table.querySelectorAll('td.heat').length).toBeGreaterThan(50);
    expect(table.querySelectorAll('td[data-score="-2"], td[data-score="-1"]').length).toBeGreaterThan(0);
    const boardCalls = () => calls.filter((u) => u.startsWith('/api/board')).length;
    expect(boardCalls()).toBe(1);
    // 担当=自分
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).toContain('mine=1'));
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBeLessThan(rowsBefore));
    for (const ava of table.querySelectorAll('tbody .ava')) expect(ava.className).toContain('mine');
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).not.toContain('mine=1'));
    // CS 担当（苗字）で絞り込み
    const ownerBox = screen.getByRole('group', { name: 'CS 担当' }).querySelector('input[type=checkbox]') as HTMLInputElement;
    fireEvent.click(ownerBox);
    await waitFor(() => expect(window.location.search).toContain('owner='));
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBeLessThan(rowsBefore));
    fireEvent.click(ownerBox);
    await waitFor(() => expect(window.location.search).not.toContain('owner='));
    // 目標比に切替: 再取得なし・セルは「目標なし」
    fireEvent.click(screen.getByRole('button', { name: '目標比' }));
    await waitFor(() => expect(window.location.search).toContain('bench=target'));
    expect(boardCalls()).toBe(1);
    expect(table.querySelectorAll('td[data-score=""]').length).toBeGreaterThan(0);
    expect(screen.getAllByText('目標なし').length).toBeGreaterThan(0);
  });

  it('並べ替え（ペース）と検索、クリア', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業のヒートマップ' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('並べ替え'), { target: { value: 'pace' } });
    await waitFor(() => expect(window.location.search).toContain('sort=pace'));
    fireEvent.change(screen.getByLabelText('企業名で検索'), { target: { value: 'アーク' } });
    await waitFor(() => expect(window.location.search).toContain('q='));
    const table = screen.getByRole('table', { name: '契約企業のヒートマップ' });
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBeLessThan(5));
    fireEvent.click(screen.getByRole('button', { name: /クリア/ }));
    await waitFor(() => expect(window.location.search).not.toContain('q='));
  });

  it('行クリックで企業詳細へ遷移する（URL に月を引き継ぐ）', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業のヒートマップ' })).toBeTruthy());
    const row = screen.getByRole('table', { name: '契約企業のヒートマップ' }).querySelector('tbody tr')!;
    fireEvent.click(row);
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/companies\/\d+/));
    expect(window.location.search).toMatch(/month=\d{4}-\d{2}/);
  });
});
