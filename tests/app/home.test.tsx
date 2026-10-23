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
  const meta = { dataVersion: refresh.dataVersion, dataDate: refresh.dataDate, refreshedAt: refresh.refreshedAt, refreshStatus: 'ok', asOf: today, month, bizDays: monthProgress(month, refresh.dataDate), ownerSource: 'sales_staff', scoutLimitPeriodDefault: 'month', benchMinN: 5, login: { availableFrom: '2026-05-15' }, caveats: CAVEATS, holidaysVersion: '2026-10', dataSchemaVersion: 1, mock: true };
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

  it('KPI タイル・実数のボード（契約中のみ、0 件と 30 日以上ログインなしだけ赤）が描画され、担当=自分 / CS 担当 で絞り込める', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業の実績一覧' })).toBeTruthy());
    const table = screen.getByRole('table', { name: '契約企業の実績一覧' });
    const rowsBefore = table.querySelectorAll('tbody tr').length;
    expect(rowsBefore).toBeGreaterThan(20);
    expect(screen.getByText('契約企業')).toBeTruthy();
    expect(screen.getByText('スカウト消化率')).toBeTruthy();
    expect(screen.getByText('スカウト利用率')).toBeTruthy();
    expect(screen.queryByText('求人枠消化率（中央値）')).toBeNull();
    expect(screen.queryByText(/注目/)).toBeNull();
    expect(screen.queryByRole('button', { name: '目標比' })).toBeNull();
    expect(screen.queryByText('契約終了まで 60 日以内')).toBeNull();
    expect(screen.getByText('スカウトの消化率_進捗遅れ')).toBeTruthy();
    expect(screen.queryByLabelText('並べ替え')).toBeNull();
    expect(screen.queryByLabelText('期間')).toBeNull();
    expect(screen.queryByText(/^業種/)).toBeNull();
    // 列の順: 種別 → CS 担当 → 企業名 → 実績
    const headers = Array.from(table.querySelectorAll('thead tr.metrics th')).map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(headers.slice(0, 3)).toEqual(['種別', 'CS 担当', '企業名']);
    for (const h of ['掲載 / 枠', '閲覧', '応募', '送信 / 枠', '返信（当月）', '選考中', '採用', '最終ログイン', '契約残']) expect(headers).toContain(h);
    // 契約中の企業だけ（終了済み・開始前・直近終了は出ない）。メーター・アイコンは無い
    const f = await fixtures();
    const contractedIds = new Set(f.board.companies.filter((c) => c.state === 'active' || c.state === 'ending_30d').map((c) => c.id));
    expect(rowsBefore).toBe(contractedIds.size);
    expect(table.querySelector('.ava, .co-strip .meta, svg.timeline')).toBeNull();
    // 実数の分数表記と、担当の苗字・種別の別セル
    const first = table.querySelector('tbody tr')!;
    expect(first.querySelector('td.col-type .badge')).toBeTruthy();
    expect(first.querySelector('td.col-owner')!.textContent!.trim().split(/[\s\u3000]/).length).toBe(1);
    expect(first.querySelector('td[data-col="jobs"]')!.textContent).toMatch(/^\d[\d,]* \/ (\d[\d,]*|–)/);
    // 送信 / 閲覧 / 応募 には副情報（消化率・期待・/求人）を出さない
    for (const col of ['sent', 'views', 'apps']) expect(table.querySelectorAll(`td[data-col="${col}"] .heat-s`).length).toBe(0);
    // ヒートマップの色は無く、0 件 / 30 日以上ログインなし だけが赤
    expect(table.querySelectorAll('td.heat, td[data-score]').length).toBe(0);
    const reds = Array.from(table.querySelectorAll('td.zero'));
    expect(reds.length).toBeGreaterThan(0);
    for (const td of reds) {
      const col = td.getAttribute('data-col');
      if (col === 'login') expect(td.textContent).toMatch(/記録なし|^\d{1,2}\/\d{1,2}$/);
      else expect(['jobs', 'views', 'apps', 'sent']).toContain(col);
      if (col !== 'login') expect(td.querySelector('.heat-v')!.textContent).toMatch(/^0( \/|$)/);
    }
    for (const td of table.querySelectorAll('td[data-col="login"]:not(.zero)')) expect(td.textContent).toMatch(/^\d{1,2}\/\d{1,2}$/);
    const boardCalls = () => calls.filter((u) => u.startsWith('/api/board')).length;
    expect(boardCalls()).toBe(1);
    // 担当=自分
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).toContain('mine=1'));
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBeLessThan(rowsBefore));
    for (const own of table.querySelectorAll('tbody td.col-owner')) expect(own.className).toContain('mine');
    fireEvent.click(screen.getByRole('button', { name: /担当 = 自分/ }));
    await waitFor(() => expect(window.location.search).not.toContain('mine=1'));
    // CS 担当（苗字）で絞り込み
    const ownerBox = screen.getByRole('group', { name: 'CS 担当' }).querySelector('input[type=checkbox]') as HTMLInputElement;
    fireEvent.click(ownerBox);
    await waitFor(() => expect(window.location.search).toContain('owner='));
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBeLessThan(rowsBefore));
    fireEvent.click(ownerBox);
    await waitFor(() => expect(window.location.search).not.toContain('owner='));
    expect(boardCalls()).toBe(1);
  });

  it('「接点」グループと最終ログイン列の見出しに、ログイン計測開始日の注釈がマウスオーバーで出る', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業の実績一覧' })).toBeTruthy());
    const table = screen.getByRole('table', { name: '契約企業の実績一覧' });
    const group = screen.getByRole('columnheader', { name: '接点' });
    expect(group.getAttribute('title')).toContain('2026-05-15');
    expect(group.classList.contains('note')).toBe(true);
    expect(screen.getByRole('columnheader', { name: /最終ログイン/ }).getAttribute('title')).toContain('2026-05-15');
    expect(screen.getByRole('columnheader', { name: 'スカウト' }).getAttribute('title')).toBeNull();
    // 求人・反応は「応募」の 1 グループ（掲載 / 枠・閲覧・応募）
    expect(screen.queryByRole('columnheader', { name: '反応' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '求人' })).toBeNull();
    expect(table.querySelector('thead tr.groups th[colspan="3"]:not(.first)')?.textContent).toBe('応募');
    // 列グループの先頭列に区切り線用の gs クラス（応募 / スカウト / 選考 / 接点 / 契約 = 5 列）
    expect(table.querySelectorAll('thead tr.metrics th.num.gs').length).toBe(5);
    expect(table.querySelector('tbody tr td[data-col=jobs]')?.classList.contains('gs')).toBe(true);
    expect(table.querySelector('tbody tr td[data-col=views]')?.classList.contains('gs')).toBe(false);
    // 返信・最終ログイン・契約残にも副情報（送信月基準・n 日前・終了日）は出さない
    expect(table.querySelectorAll('td[data-col=intReply] .heat-s, td[data-col=login] .heat-s, td[data-col=daysToEnd] .heat-s').length).toBe(0);
  });

  it('列見出しの並べ替え、企業種別（複数選択）・契約終了（単数）のプルダウン、検索、クリア', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業の実績一覧' })).toBeTruthy());
    fireEvent.click(screen.getAllByRole('columnheader', { name: '応募' }).find((th) => th.closest('tr')?.classList.contains('metrics'))!);
    await waitFor(() => expect(window.location.search).toContain('sort=-apps'));
    const table0 = screen.getByRole('table', { name: '契約企業の実績一覧' });
    const total = table0.querySelectorAll('tbody tr').length;
    // 企業種別のプルダウンは外側のクリック・Esc で閉じ、中のクリックでは閉じない
    const typeGroup = screen.getByRole('group', { name: '企業種別' });
    const details = typeGroup.closest('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle', { bubbles: false }));
    fireEvent.pointerDown(typeGroup.querySelector('label')!);
    expect(details.open).toBe(true);
    fireEvent.pointerDown(table0.querySelector('tbody')!);
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event('toggle', { bubbles: false }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(details.open).toBe(false);
    // 企業種別: 2 つ選ぶ
    const typeBoxes = typeGroup.querySelectorAll('input[type=checkbox]');
    fireEvent.click(typeBoxes[0]);
    fireEvent.click(typeBoxes[1]);
    await waitFor(() => expect(window.location.search).toMatch(/type=[^&]+%2C|type=[^&]+,/));
    await waitFor(() => expect(table0.querySelectorAll('tbody tr').length).toBeLessThan(total));
    fireEvent.click(typeBoxes[0]);
    fireEvent.click(typeBoxes[1]);
    // 契約終了: 90 日以上先
    fireEvent.change(screen.getByLabelText('契約終了'), { target: { value: 'over90' } });
    await waitFor(() => expect(window.location.search).toContain('ending=over90'));
    for (const td of table0.querySelectorAll('td[data-col="daysToEnd"]')) expect(td.textContent).toMatch(/無期限|^(9[1-9]|[1-9]\d{2,})/);
    fireEvent.change(screen.getByLabelText('契約終了'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('企業名で検索'), { target: { value: 'アーク' } });
    await waitFor(() => expect(window.location.search).toContain('q='));
    const table = screen.getByRole('table', { name: '契約企業の実績一覧' });
    await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBeLessThan(5));
    fireEvent.click(screen.getByRole('button', { name: /クリア/ }));
    await waitFor(() => expect(window.location.search).not.toContain('q='));
  });

  it('行クリックで企業詳細へ遷移する（URL に月を引き継ぐ）', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('table', { name: '契約企業の実績一覧' })).toBeTruthy());
    const row = screen.getByRole('table', { name: '契約企業の実績一覧' }).querySelector('tbody tr')!;
    fireEvent.click(row);
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/companies\/\d+/));
    expect(window.location.search).toMatch(/month=\d{4}-\d{2}/);
  });
});
