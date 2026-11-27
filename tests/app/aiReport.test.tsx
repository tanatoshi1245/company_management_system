import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReportPage, { REPORT_RUN_LABEL } from '../../src/app/features/ai/report/ReportPage';
import { SessionProvider } from '../../src/app/lib/session';
import { clearResourceCache } from '../../src/app/lib/useResource';
import { ReportSlideView } from '../../src/app/features/ai/report/slides/ReportSlideView';
import { niceTicks } from '../../src/app/features/ai/report/slides/charts';
import {
  canRemoveSlide,
  moveSlide,
  pdfFilename,
  readInput,
  readReport,
  removeSlide,
  resolveReportPeriod,
  sameReport,
  setSlideText,
  slideContext,
  slideFields,
  validateReport,
} from '../../src/app/features/ai/report/reportModel';
import { REPORT_SLIDES_MIN, ReportResultSchema, type ReportResult } from '../../src/shared/ai/report';
import type { AiJobDetail } from '../../src/shared/ai/common';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { CAVEATS } from '../../src/shared/caveats';

const CUR = monthOf(todayJst());
const FROM = addMonths(CUR, -2);
const JOB_ID = 'abcdefghij0123456789';
const COMPANY = { id: '101', name: 'テスト商事', industry: 'IT・通信', companyType: '直接' };

/** 見本の結果（全 layout を 1 枚ずつ） */
function sampleResult(): ReportResult {
  return ReportResultSchema.parse({
    ok: true,
    summary: 'スカウトの送信は増えていますが、返信率は伸びていません。文面の見直しをご提案します。',
    slides: [
      { layout: 'cover', title: 'ご利用状況のご報告とご提案', subtitle: '直近 3 か月のまとめ' },
      { layout: 'summary', kicker: 'このレポートの要約', lead: '量は伸びており、次は返信率の改善です。', points: [{ label: '良い点', text: '送信数が増えています。' }, { label: '課題', text: '返信率が伸びていません。' }] },
      {
        layout: 'kpi',
        kicker: '主要な数値',
        lead: '送信と応募は増えています。',
        cards: [
          { label: 'スカウト送信', value: '1,510', unit: '通', note: '前の期間より増加', tone: 'good' },
          { label: '興味あり返信率', value: '4.2', unit: '%', note: '', tone: 'warn' },
          { label: '応募', value: '110', unit: '件', note: '', tone: 'neutral' },
        ],
        comment: '期間の合計です。',
      },
      {
        layout: 'trend',
        kicker: '送信と応募の推移',
        lead: '送信数は月を追って増えています。',
        unit: '件',
        series: [
          { name: 'スカウト送信', points: [{ x: FROM, y: 180 }, { x: addMonths(FROM, 1), y: 240 }, { x: CUR, y: 320 }] },
          { name: '応募', points: [{ x: FROM, y: 14 }, { x: addMonths(FROM, 1), y: 19 }, { x: CUR, y: 24 }] },
        ],
        comment: '',
      },
      { layout: 'bars', kicker: '業界との比較', lead: '返信率は業界の中央値を下回っています。', unit: '%', valueLabel: '貴社', compareLabel: '業界の中央値', items: [{ label: '興味あり返信率', value: 4.2, compare: 5.1 }, { label: '応募の率', value: 3.6, compare: null }], comment: '' },
      { layout: 'table', kicker: '求人ごとの実績', lead: '求人ごとに応募の率が違います。', columns: ['求人', '閲覧', '応募'], rows: [['求人 A', '1,240', '52'], ['求人 B', '980', '21']], comment: '' },
      { layout: 'findings', kicker: '分かったこと', lead: '量は足りています。', items: [{ title: '送信は十分です', body: '送信数は増えています。', tone: 'good' }, { title: '返信率が課題です', body: '返信率は横ばいです。', tone: 'bad' }] },
      { layout: 'proposal', kicker: 'ご提案', lead: '文面を見直します。', actions: [{ title: '件名を見直します', body: '件名に職種を入れます。', effect: '返信の増加' }, { title: '条件を整理します', body: '必須を 3 点にします。', effect: '' }] },
      { layout: 'next', kicker: '次の一歩', lead: '今月中に文面を直します。', steps: [{ when: '今週', what: '文面の案をお送りします。' }, { when: '来月', what: '数値をご報告します。' }] },
    ],
  });
}

function jobOf(over: Partial<AiJobDetail> = {}): AiJobDetail {
  return {
    id: JOB_ID,
    kind: 'report',
    companyId: COMPANY.id,
    status: 'done',
    title: `${FROM}〜${CUR} の利用状況`,
    summary: sampleResult().summary,
    error: null,
    createdBy: 'cs@daijob.com',
    createdAt: '2026-11-25T03:00:00.000Z',
    completedAt: '2026-11-25T03:05:00.000Z',
    edited: false,
    sample: false,
    input: { from: FROM, to: CUR, account: '直接', note: '' },
    result: sampleResult(),
    editedResult: null,
    sessionUrl: null,
    companyName: COMPANY.name,
    ...over,
  };
}

function setupFetch(opts: { job?: AiJobDetail | null } = {}) {
  let job = opts.job === undefined ? jobOf() : opts.job;
  const calls: { method: string; url: string; body: unknown }[] = [];
  const me = { email: 'cs@daijob.com', name: 'テスト', verified: true, authMode: 'google', mock: true, ownerUserId: null, overrideCompanyIds: [], canEdit: true };
  const meta = { dataVersion: '1', dataDate: todayJst(), refreshedAt: '2026-11-25T00:00:00Z', refreshStatus: 'ok', asOf: todayJst(), month: CUR, bizDays: { elapsed: 1, total: 20 }, ownerSource: 'sales_staff', scoutLimitPeriodDefault: 'month', benchMinN: 5, login: { availableFrom: '2026-05-15' }, caveats: CAVEATS, holidaysVersion: '2026-10', dataSchemaVersion: 1, mock: true };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURI(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    calls.push({ method, url, body });
    if (url.startsWith('/api/meta')) return Response.json(meta);
    if (url.startsWith('/api/me')) return Response.json(me);
    if (url === '/api/ai/config') return Response.json({ fireConfigured: true, storeConfigured: true, sampleMode: false, canWrite: true, admin: false });
    if (url === '/api/ai/companies') return Response.json({ companies: [COMPANY, { id: '202', name: 'サンプル工業', industry: 'メーカー', companyType: '紹介' }] });
    if (url.startsWith('/api/ai/jobs?')) return Response.json({ jobs: job ? [{ id: job.id, kind: job.kind, companyId: job.companyId, status: job.status, title: job.title, summary: job.summary, error: null, createdBy: job.createdBy, createdAt: job.createdAt, completedAt: job.completedAt, edited: job.edited, sample: job.sample }] : [] });
    if (url === `/api/ai/jobs/${JOB_ID}` && method === 'GET') return job ? Response.json(job) : Response.json({ error: 'nf', code: 'notFound' }, { status: 404 });
    if (url === `/api/ai/jobs/${JOB_ID}/edited` && method === 'PUT') {
      job = { ...jobOf(), editedResult: (body as { result: unknown }).result, edited: true };
      return Response.json(job);
    }
    if (url === `/api/ai/jobs/${JOB_ID}/edited` && method === 'DELETE') {
      job = jobOf();
      return Response.json(job);
    }
    if (url === `/api/companies/${COMPANY.id}/ai/jobs` && method === 'POST') {
      job = jobOf({ status: 'running', result: null, summary: null, completedAt: null, input: (body as { input: unknown }).input });
      return Response.json({ job, fire: 'sent', fireMessage: null }, { status: 201 });
    }
    return Response.json({ error: 'nf', code: 'notFound' }, { status: 404 });
  }) as typeof fetch;
  return { calls };
}

const renderPage = () =>
  render(
    <SessionProvider>
      <ReportPage params={{}} />
    </SessionProvider>,
  );

describe('AI 分析とレポート生成: reportModel', () => {
  it('結果を読む（直した版があればそれ。形が違えば null）', () => {
    const base = sampleResult();
    expect(readReport(null)).toBeNull();
    expect(readReport({ result: { slides: [] }, editedResult: null })).toBeNull();
    expect(readReport({ result: base, editedResult: null })).toEqual({ result: base, edited: false });
    const edited = setSlideText(base, 0, ['title'], '直したタイトル');
    const r = readReport({ result: base, editedResult: edited });
    expect(r?.edited).toBe(true);
    expect(r?.result.slides[0]).toMatchObject({ title: '直したタイトル' });
    // 直した版の形が違うときは、元の結果を使う
    expect(readReport({ result: base, editedResult: { bad: true } })).toEqual({ result: base, edited: false });
    expect(readInput({ input: { from: FROM, to: CUR } })).toEqual({ from: FROM, to: CUR, account: null, note: '' });
  });

  it('文字の差し替え・削除・並べ替えは、元の結果を変えない', () => {
    const base = sampleResult();
    const snapshot = JSON.stringify(base);
    const a = setSlideText(base, 1, ['points', 1, 'text'], '直した本文');
    expect(a.slides[1]).toMatchObject({ points: [{ label: '良い点' }, { text: '直した本文' }] });
    const b = setSlideText(base, 5, ['rows', 1, 2], '99');
    expect(b.slides[5]).toMatchObject({ rows: [['求人 A', '1,240', '52'], ['求人 B', '980', '99']] });
    const moved = moveSlide(base, 1, 1);
    expect(moved.slides.map((s) => s.layout).slice(0, 3)).toEqual(['cover', 'kpi', 'summary']);
    expect(moveSlide(base, 0, -1)).toBe(base);
    expect(moveSlide(base, base.slides.length - 1, 1)).toBe(base);
    const removed = removeSlide(base, 2);
    expect(removed.slides).toHaveLength(base.slides.length - 1);
    expect(removed.slides.some((s) => s.layout === 'kpi')).toBe(false);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(sameReport(base, sampleResult())).toBe(true);
    expect(sameReport(base, a)).toBe(false);
    // 下限の枚数では外せない
    const min: ReportResult = { ...base, slides: base.slides.slice(0, REPORT_SLIDES_MIN) };
    expect(canRemoveSlide(min)).toBe(false);
    expect(removeSlide(min, 0)).toBe(min);
  });

  it('入力欄の上限は zod の上限と同じ（上限ちょうどは保存でき、1 文字超えると保存できない）', () => {
    const base = sampleResult();
    let count = 0;
    base.slides.forEach((s, i) => {
      for (const fd of slideFields(s)) {
        count += 1;
        const ok = validateReport(setSlideText(base, i, fd.path, 'あ'.repeat(fd.max)));
        expect(ok.ok, `${s.layout}.${fd.key} は ${fd.max} 文字まで入る`).toBe(true);
        const ng = validateReport(setSlideText(base, i, fd.path, 'あ'.repeat(fd.max + 1)));
        expect(ng.ok, `${s.layout}.${fd.key} は ${fd.max + 1} 文字で保存できない`).toBe(false);
        if (!ng.ok) expect(ng.issues).toContainEqual({ slide: i, key: fd.key, message: `${fd.max} 文字までです` });
        const empty = validateReport(setSlideText(base, i, fd.path, '  '));
        expect(empty.ok, `${s.layout}.${fd.key} の必須`).toBe(!fd.required);
      }
    });
    expect(count).toBeGreaterThan(40);
  });

  it('期間・ファイル名・表紙の内容', () => {
    expect(resolveReportPeriod(CUR, { from: '', to: '' })).toEqual({ from: FROM, to: CUR });
    expect(resolveReportPeriod(CUR, { from: addMonths(CUR, -13), to: addMonths(CUR, -5) })).toEqual({ from: addMonths(CUR, -13), to: addMonths(CUR, -5) });
    // 窓（直近 13 か月 + 当月）の外・逆順は直す
    expect(resolveReportPeriod(CUR, { from: addMonths(CUR, -14), to: addMonths(CUR, 1) })).toEqual({ from: FROM, to: CUR });
    expect(resolveReportPeriod(CUR, { from: CUR, to: addMonths(CUR, -3) })).toEqual({ from: addMonths(CUR, -3), to: addMonths(CUR, -3) });
    expect(pdfFilename('テスト商事 株式会社', '2026-08', '2026-10')).toBe('利用実績レポート_テスト商事_株式会社_2026-08-2026-10.pdf');
    expect(pdfFilename('a/b:c', '2026-08', '2026-10')).toBe('利用実績レポート_a_b_c_2026-08-2026-10.pdf');
    // 作成日は日本時間（UTC 18:00 = 翌日 03:00）
    expect(slideContext(jobOf({ createdAt: '2026-11-24T18:00:00.000Z' }))).toEqual({ companyName: COMPANY.name, from: FROM, to: CUR, account: '直接', createdOn: '2026-11-25', sample: false });
    expect(niceTicks(0, 320)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(0, 5.1)).toEqual([0, 2, 4, 6]);
  });
});

describe('AI 分析とレポート生成: スライド', () => {
  afterEach(() => cleanup());

  it('全 layout が描ける。表紙に企業名・期間・作成日が入り、タイトルとリード文・ページ番号が出る', () => {
    const result = sampleResult();
    const ctx = slideContext(jobOf({ sample: true }));
    const { container } = render(
      <div>
        {result.slides.map((s, i) => (
          <ReportSlideView key={i} slide={s} page={i + 1} total={result.slides.length} ctx={ctx} />
        ))}
      </div>,
    );
    const slides = Array.from(container.querySelectorAll<HTMLElement>('.dj-slide'));
    expect(slides.map((s) => s.dataset.layout)).toEqual(['cover', 'summary', 'kpi', 'trend', 'bars', 'table', 'findings', 'proposal', 'next']);
    const by = (layout: string) => within(slides.find((s) => s.dataset.layout === layout) as HTMLElement);
    // 表紙
    expect(slides[0].classList.contains('slide--cover')).toBe(true);
    expect(by('cover').getByTestId('cover-company').textContent).toBe(`${COMPANY.name}御中`);
    expect(by('cover').getByText('ご利用状況のご報告とご提案')).toBeTruthy();
    expect(slides[0].textContent).toContain(`対象期間：${FROM.slice(0, 4)}年${Number(FROM.slice(5))}月〜${CUR.slice(0, 4)}年${Number(CUR.slice(5))}月`);
    expect(slides[0].textContent).toContain('アカウント種別：直接');
    expect(slides[0].textContent).toContain('2026年11月25日');
    // 枠: スライドタイトル・リード文・ページ番号・サンプルの印
    for (const s of slides.slice(1)) {
      expect(s.querySelector('.slide-title')?.textContent).toBeTruthy();
      expect(s.querySelector('.slide-lead')?.textContent).toBeTruthy();
      expect(s.querySelector('.chrome-footer .page')?.textContent).toBe(String(slides.indexOf(s) + 1));
      expect(within(s).getByTestId('sample-mark')).toBeTruthy();
    }
    expect(by('summary').getByText('返信率が伸びていません。')).toBeTruthy();
    // KPI: 良し悪しは言葉でも出す
    expect(by('kpi').getAllByTestId('tone-tag').map((e) => e.textContent)).toEqual(['良好', '注意']);
    expect(by('kpi').getByText('1,510')).toBeTruthy();
    // 推移: 系列ごとに線 1 本・凡例・最後の点の値
    const trend = by('trend').getByTestId('trend-chart');
    expect(trend.querySelectorAll('polyline')).toHaveLength(2);
    expect(trend.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toContain('スカウト送信・応募');
    expect(Array.from(trend.querySelectorAll('.rs-end')).map((e) => e.textContent).sort()).toEqual(['24件', '320件']);
    expect(within(trend).getByText('スカウト送信')).toBeTruthy();
    // 比較: 項目ごとに 1 行。比べる相手があるときだけ 2 本目の棒
    const bars = by('bars').getByTestId('bars-chart');
    expect(bars.querySelectorAll('.rs-bar-row')).toHaveLength(2);
    expect(bars.querySelectorAll(`rect[fill="#c9cedf"]`).length).toBe(2);
    expect(bars.textContent).toContain('業界の中央値 5.1%');
    // 表
    expect(by('table').getAllByRole('columnheader').map((e) => e.textContent)).toEqual(['求人', '閲覧', '応募']);
    expect(by('table').getAllByRole('row')).toHaveLength(3);
    expect(by('findings').getAllByTestId('tone-tag').map((e) => e.textContent)).toEqual(['良好', '課題']);
    expect(by('proposal').getByText('返信の増加')).toBeTruthy();
    expect(by('proposal').getAllByText('期待できる変化')).toHaveLength(1);
    expect(by('next').getByText('来月')).toBeTruthy();
  });
});

describe('AI 分析とレポート生成: 画面', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('URL の企業・期間・アカウント種別を引き継ぎ、ボタンで実行すると、期間・アカウント種別・補足だけを送る', async () => {
    const f = setupFetch({ job: null });
    window.history.replaceState(null, '', `/ai/report?company=${COMPANY.id}&from=${FROM}&to=${addMonths(CUR, -1)}&account=${encodeURIComponent('紹介')}`);
    renderPage();
    await waitFor(() => expect((screen.getByLabelText('開始月') as HTMLSelectElement).value).toBe(FROM));
    expect((screen.getByLabelText('終了月') as HTMLSelectElement).value).toBe(addMonths(CUR, -1));
    // 選べるのは直近 13 か月 + 当月
    expect((screen.getByLabelText('開始月') as HTMLSelectElement).options).toHaveLength(14);
    expect(screen.getByRole('button', { name: '紹介' }).getAttribute('aria-pressed')).toBe('true');
    const run = screen.getByRole('button', { name: REPORT_RUN_LABEL }) as HTMLButtonElement;
    await waitFor(() => expect(run.disabled).toBe(false));
    // 補足にメールアドレスがあると実行できない
    const note = screen.getByLabelText(/重点的に見てほしいこと/);
    fireEvent.change(note, { target: { value: 'tanaka@example.com に送った分' } });
    await waitFor(() => expect(run.disabled).toBe(true));
    fireEvent.change(note, { target: { value: '返信率を中心に' } });
    await waitFor(() => expect(run.disabled).toBe(false));
    fireEvent.click(run);
    await waitFor(() => expect(f.calls.some((c) => c.method === 'POST')).toBe(true));
    const post = f.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe(`/api/companies/${COMPANY.id}/ai/jobs`);
    expect(post?.body).toEqual({ kind: 'report', input: { from: FROM, to: addMonths(CUR, -1), account: '紹介', note: '返信率を中心に' } });
    // 作成中の表示になり、URL にジョブが入る（履歴・再読み込みで開ける）
    await waitFor(() => expect(document.querySelector('[data-status="running"]')).toBeTruthy());
    expect(new URLSearchParams(window.location.search).get('job')).toBe(JOB_ID);
    expect(screen.queryByTestId('main-slide')).toBeNull();
  });

  it('URL のジョブを開くとスライドが出る。文字を直して保存すると、結果と同じ形で PUT される。元に戻すと DELETE', async () => {
    const f = setupFetch();
    window.history.replaceState(null, '', `/ai/report?company=${COMPANY.id}&job=${JOB_ID}`);
    renderPage();
    const main = await screen.findByTestId('main-slide');
    expect(within(main).getByText('ご利用状況のご報告とご提案')).toBeTruthy();
    expect(within(main).getByTestId('cover-company').textContent).toContain(COMPANY.name);
    // ジョブの入力（期間・アカウント種別）が URL と欄に入る
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('account')).toBe('直接'));
    expect(new URLSearchParams(window.location.search).get('from')).toBe(FROM);
    // サムネイルは全スライド
    const thumbs = within(screen.getByRole('list', { name: 'スライドの一覧' })).getAllByRole('button');
    expect(thumbs).toHaveLength(9);
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // 前後の移動
    fireEvent.click(screen.getByRole('button', { name: '次のスライド' }));
    expect(within(main).getByText('このレポートの要約')).toBeTruthy();
    // 文字を直すと、スライドに反映される
    const lead = screen.getByLabelText(/^リード文/) as HTMLTextAreaElement;
    expect(lead.value).toBe('量は伸びており、次は返信率の改善です。');
    fireEvent.change(lead, { target: { value: '返信率の改善が、次の成果につながります。' } });
    expect(within(main).getByText('返信率の改善が、次の成果につながります。')).toBeTruthy();
    expect(screen.getByText('未保存の変更あり')).toBeTruthy();
    // 上限を超えると保存できない
    fireEvent.change(lead, { target: { value: 'あ'.repeat(81) } });
    expect(save.disabled).toBe(true);
    expect(screen.getByText('80 文字までです')).toBeTruthy();
    fireEvent.change(lead, { target: { value: '返信率の改善が、次の成果につながります。' } });
    expect(save.disabled).toBe(false);
    // 並べ替え: 要約を下へ → 3 枚目になる
    fireEvent.click(screen.getByRole('button', { name: '下へ' }));
    expect(screen.getByText(/^3 \/ 9/)).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(f.calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = f.calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe(`/api/ai/jobs/${JOB_ID}/edited`);
    const sent = ReportResultSchema.parse((put?.body as { result: unknown }).result);
    expect(sent.slides.map((s) => s.layout).slice(0, 3)).toEqual(['cover', 'kpi', 'summary']);
    expect(sent.slides[2]).toMatchObject({ lead: '返信率の改善が、次の成果につながります。' });
    await waitFor(() => expect(screen.getByText('直した版')).toBeTruthy());
    expect(screen.queryByText('未保存の変更あり')).toBeNull();
    // 元に戻す = 直した版を捨てる
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    await waitFor(() => expect(f.calls.some((c) => c.method === 'DELETE' && c.url === `/api/ai/jobs/${JOB_ID}/edited`)).toBe(true));
    await waitFor(() => expect(screen.queryByText('直した版')).toBeNull());
    fireEvent.click(thumbs[1]);
    expect((screen.getByLabelText(/^リード文/) as HTMLTextAreaElement).value).toBe('量は伸びており、次は返信率の改善です。');
  });

  it('スライドを外せる（保存の前なら「元に戻す」で戻る）', async () => {
    setupFetch();
    window.history.replaceState(null, '', `/ai/report?company=${COMPANY.id}&job=${JOB_ID}`);
    renderPage();
    await screen.findByTestId('main-slide');
    fireEvent.click(screen.getByRole('button', { name: 'このスライドを外す' }));
    expect(within(screen.getByRole('list', { name: 'スライドの一覧' })).getAllByRole('button')).toHaveLength(8);
    expect(within(screen.getByTestId('main-slide')).getByText('このレポートの要約')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(within(screen.getByRole('list', { name: 'スライドの一覧' })).getAllByRole('button')).toHaveLength(9);
  });
});
