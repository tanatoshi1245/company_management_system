import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { clearResourceCache } from '../../src/app/lib/useResource';
import ScoutPage from '../../src/app/features/ai/scout/ScoutPage';
import { chosenDraft, CONDITIONS_SOURCE, emptyScoutForm, filterChips, parseScoutId, readScoutResult, scoutFormFromInput, scoutPii, scoutThresholdText, toggleFilter, toScoutInput, validateScout, withLocalChoice, withLocalUsage, withScoutDraft } from '../../src/app/features/ai/scout/scoutModel';
import { AI_KIND_LABEL, type AiJobDetail } from '../../src/shared/ai/common';
import { AI_TEXT, SCOUT_TEXT } from '../../src/shared/ai/options';
import { EMPTY_SCOUT_FILTERS, SCOUT_BASES, SCOUT_BASIS_DESCRIPTION, SCOUT_BASIS_LABEL, SCOUT_FILTER_MAX, ScoutChoiceInputSchema, ScoutInputSchema, ScoutJobSummarySchema, ScoutMemberSummarySchema, ScoutModelsResponseSchema, ScoutOptionsResponseSchema, ScoutResultSchema, ScoutTuneResponseSchema, ScoutUsageInputSchema, type ScoutBasisKind, type ScoutResult } from '../../src/shared/ai/scout';
import { makeJob, mockAiApi, SCOUT_INPUT, SCOUT_JOB_ENDED, SCOUT_JOB_INPUT, SCOUT_JOB_MEMBER_INPUT, SCOUT_JOB_MEMBER_RESULT, SCOUT_JOB_RESULT, SCOUT_JOB_SUMMARY, SCOUT_MEMBER_SUMMARY, SCOUT_MODELS, SCOUT_MODELS_VIEWER, SCOUT_OPTIONS, SCOUT_RESULT, SCOUT_REVIEW_RESULT, SCOUT_TUNE, type AiMock } from './aiFixtures';

const ID1 = 'scout00000000001';
const ID2 = 'scout00000000002';
const [DA, DB] = SCOUT_RESULT.drafts;

const open = (search = '') => {
  window.history.replaceState(null, '', `/ai/scout${search}`);
  return render(<ScoutPage params={{}} />);
};
const pickCompany = async (name: string, index = 0) => {
  const el = await screen.findByRole('combobox', { name: '既存企業を選択' });
  await waitFor(() => {
    fireEvent.change(el, { target: { value: name } });
    expect(screen.getAllByRole('option').length).toBeGreaterThan(index);
  });
  fireEvent.click(screen.getAllByRole('option')[index]);
};
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement | HTMLTextAreaElement;
const combo = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement;
const type = (el: Element, value: string) => fireEvent.change(el, { target: { value } });
const runButton = (name = 'この内容で文面を作る') => screen.getByRole('button', { name }) as HTMLButtonElement;
const posts = (m: AiMock) => m.bodies.filter((b) => b.method === 'POST' && /\/ai\/jobs$/.test(b.url));
const puts = (m: AiMock, tail: string) => m.bodies.filter((b) => b.method === 'PUT' && b.url.endsWith(tail));
const ready = () => waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
const card = (label: string) => screen.getByRole('article', { name: label });
const basisRadio = (b: ScoutBasisKind) => screen.getByRole('radio', { name: new RegExp(`^${SCOUT_BASIS_LABEL[b].replace(/[+]/g, '\\+')}`) }) as HTMLInputElement;
/** 何をもとに作るかを選ぶ */
const pickBasis = (b: ScoutBasisKind) => fireEvent.click(basisRadio(b));
const gets = (m: AiMock, re: RegExp) => m.calls.filter((c) => c.startsWith('GET ') && re.test(c));
const jobCard = () => screen.queryByRole('region', { name: '求人の内容' });
const memberCard = () => screen.queryByRole('region', { name: '候補者の情報' });
/** 作成の応答（作成できた）: 入力をそのまま持つジョブを保存して返す */
const doneCreate =
  (result: ScoutResult = SCOUT_RESULT) =>
  (companyId: string, body: { kind: string; input: unknown }, m: AiMock) => {
    const job = makeJob({ id: ID1, kind: 'scout', companyId, input: body.input, result, title: '作成: 法人営業マネージャー' });
    m.jobs.set(job.id, job);
    return { json: { job, fire: 'done', fireMessage: null } };
  };
const savedJob = (over: Partial<AiJobDetail> = {}) => makeJob({ id: ID1, kind: 'scout', companyId: '101', title: '作成: 法人営業マネージャー', input: SCOUT_INPUT, result: SCOUT_RESULT, ...over });

describe('見本（tests/app/aiScoutFixtures.ts）は契約の形どおり', () => {
  it('結果・入力・選択肢・モデルの成績・チューニングの応答', () => {
    expect(ScoutResultSchema.safeParse(SCOUT_RESULT).success).toBe(true);
    expect(ScoutResultSchema.safeParse(SCOUT_REVIEW_RESULT).success).toBe(true);
    expect(ScoutInputSchema.safeParse(SCOUT_INPUT).success).toBe(true);
    for (const r of [SCOUT_JOB_RESULT, SCOUT_JOB_MEMBER_RESULT]) expect(ScoutResultSchema.safeParse(r).success).toBe(true);
    for (const i of [SCOUT_JOB_INPUT, SCOUT_JOB_MEMBER_INPUT]) expect(ScoutInputSchema.safeParse(i).success).toBe(true);
    for (const j of [SCOUT_JOB_SUMMARY, SCOUT_JOB_ENDED]) expect(ScoutJobSummarySchema.safeParse(j).success).toBe(true);
    expect(ScoutMemberSummarySchema.safeParse(SCOUT_MEMBER_SUMMARY).success).toBe(true);
    expect(ScoutOptionsResponseSchema.safeParse(SCOUT_OPTIONS).success).toBe(true);
    expect(ScoutModelsResponseSchema.safeParse(SCOUT_MODELS).success).toBe(true);
    expect(ScoutModelsResponseSchema.safeParse(SCOUT_MODELS_VIEWER).success).toBe(true);
    expect(ScoutTuneResponseSchema.safeParse(SCOUT_TUNE).success).toBe(true);
  });
});

describe('② スカウト文面の AI 作成（/ai/scout）: 入力', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('何をもとに作るかを選ぶまで、その先の入力欄と実行ボタンを出さない（既定で選んだ状態にしない）。選ぶと URL に basis が入る', async () => {
    const m = mockAiApi({ config: { sampleMode: true } });
    open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AI_KIND_LABEL.scout);
    expect(AI_KIND_LABEL.scout).toBe('スカウト文面の AI 作成');
    expect(await screen.findByText(AI_TEXT.sampleMode)).toBeTruthy();
    expect(screen.getByText(AI_TEXT.historyNoCompany)).toBeTruthy();
    expect(screen.getByText('結果はここに出ます')).toBeTruthy();
    await waitFor(() => expect(m.calls).toContain('GET /api/ai/config'));
    // 4 つの作り方（ラベルと説明）。どれも選ばれていない
    const group = screen.getByRole('radiogroup', { name: SCOUT_TEXT.basisLegend });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(SCOUT_BASES.length);
    expect(radios.every((r) => !r.checked)).toBe(true);
    for (const b of SCOUT_BASES) expect(group.textContent).toContain(SCOUT_BASIS_LABEL[b] + SCOUT_BASIS_DESCRIPTION[b]);
    expect(screen.getByText(SCOUT_TEXT.basisHint)).toBeTruthy();
    // 選ぶまでは、目的・入力欄・条件・実行ボタンが無い
    const hidden = () => {
      expect(screen.queryByRole('button', { name: 'この内容で文面を作る' })).toBeNull();
      expect(screen.queryByRole('button', { name: '文面の添削' })).toBeNull();
      expect(screen.queryByRole('combobox', { name: '業界' })).toBeNull();
      expect(screen.queryByRole('textbox', { name: 'ポジション名' })).toBeNull();
      expect(screen.queryByText(SCOUT_TEXT.filtersLegend)).toBeNull();
      expect(screen.queryByText(SCOUT_TEXT.runHint)).toBeNull();
    };
    hidden();
    await pickCompany('アクメ');
    expect(window.location.search).toBe('?company=101');
    hidden();
    pickBasis('conditions');
    expect(window.location.search).toBe('?company=101&basis=conditions');
    expect(screen.queryByText(SCOUT_TEXT.basisHint)).toBeNull();
    expect(screen.getByText(SCOUT_TEXT.filtersLegend)).toBeTruthy();
    expect(screen.getByText(SCOUT_TEXT.runHint)).toBeTruthy();
    expect(runButton()).toBeTruthy();
    // 選ぶだけでは、AI（POST）も、確かめる API も呼ばれない
    expect(posts(m)).toHaveLength(0);
    expect(m.calls.some((c) => /scout\/(jobs|members)\//.test(c))).toBe(false);
  });

  it('条件を指定して作る: 企業を選ぶと業界と掲載職種が入る。目的を変えると件名・本文の欄が出る', async () => {
    mockAiApi({ config: { sampleMode: true } });
    open('?basis=conditions');
    // 企業を選ぶまでは実行できない
    expect(runButton().disabled).toBe(true);
    await pickCompany('アクメ');
    expect(window.location.search).toBe('?company=101&basis=conditions');
    await ready();
    const tags = () => Array.from(document.querySelectorAll('.ai-tag > span')).map((x) => x.textContent);
    expect(tags()).toEqual(['ITエンジニア', '営業', 'マーケティング']);
    expect(runButton().disabled).toBe(false);
    // 作成では件名・本文の欄は無い。添削にすると出る
    expect(screen.queryByRole('textbox', { name: '件名' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '文面の添削' }));
    expect(window.location.search).toBe('?company=101&purpose=review&basis=conditions');
    expect(field('件名')).toBeTruthy();
    expect(screen.getByText(AI_TEXT.piiRule)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'この内容で添削する' })).toBeTruthy();
    // 直した値は、企業の値で上書きされない
    type(combo('業界'), '金融');
    fireEvent.click(screen.getByRole('option', { name: '金融・保険' }));
    fireEvent.click(screen.getByRole('button', { name: 'ITエンジニア を外す' }));
    fireEvent.click(screen.getByRole('button', { name: '文面の作成' }));
    expect(combo('業界').value).toBe('金融・保険');
    expect(tags()).toEqual(['営業', 'マーケティング']);
  });

  it('条件の選択肢（GET /api/ai/scout/options）が出る。選ぶと input.filters に入り、POST の本文は ScoutInputSchema を通る。応答の 3 案が描ける', async () => {
    const m = mockAiApi({ create: doneCreate() });
    open('?company=101&basis=conditions');
    await ready();
    expect(m.calls).toContain('GET /api/ai/scout/options');
    // 年齢層・国籍は、押して選ぶチップ
    const ages = await screen.findByRole('group', { name: '年齢層' });
    expect(within(ages).getAllByRole('button').map((b) => b.textContent)).toEqual(SCOUT_OPTIONS.ageGroups);
    fireEvent.click(within(ages).getByRole('button', { name: '30代' }));
    fireEvent.click(within(ages).getByRole('button', { name: '40代' }));
    fireEvent.click(within(ages).getByRole('button', { name: '40代' }));
    expect(within(ages).getByRole('button', { name: '30代' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(ages).getByRole('button', { name: '40代' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(screen.getByRole('group', { name: '国籍' })).getByRole('button', { name: '日本以外' }));
    // そのほかは、一覧から選ぶ（一覧に無い文字は足せない）
    type(combo('英語力を足す'), 'ビジネス');
    fireEvent.click(screen.getByRole('option', { name: 'ビジネス会話' }));
    type(combo('経験職種を足す'), '一覧に無い職種');
    fireEvent.keyDown(combo('経験職種を足す'), { key: 'Enter' });
    fireEvent.blur(combo('経験職種を足す'));
    type(combo('現住所を足す'), '東京');
    fireEvent.click(screen.getByRole('option', { name: '東京都' }));
    expect(screen.getByText('4 個の条件を指定中')).toBeTruthy();
    // ポジション名が無いと送らない
    fireEvent.click(runButton());
    expect(await screen.findByText('ポジション名を入れてください')).toBeTruthy();
    expect(posts(m)).toHaveLength(0);
    type(field('ポジション名'), ' 法人営業マネージャー ');
    type(combo('勤務地'), '東京都');
    fireEvent.click(screen.getByRole('button', { name: '英語' }));
    type(field('補足'), '年収を先に伝えたい');
    fireEvent.click(runButton());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const sent = posts(m)[0];
    expect(sent.url).toBe('/api/companies/101/ai/jobs');
    expect(sent.body).toEqual({
      kind: 'scout',
      input: {
        purpose: 'template',
        basis: 'conditions',
        jobId: null,
        memberId: null,
        subject: '',
        body: '',
        industry: 'IT・通信',
        positionName: '法人営業マネージャー',
        jobOccupations: ['ITエンジニア', '営業', 'マーケティング'],
        jobLocation: '東京都',
        filters: { ageGroups: ['30代'], nationalities: ['日本以外'], japaneseLevels: [], englishLevels: ['ビジネス会話'], residences: ['東京都'], occupations: [] },
        lang: 'en',
        note: '年収を先に伝えたい',
      },
    });
    // 企業は URL のパスだけ（本文に企業名を入れない）
    expect(JSON.stringify(sent.body)).not.toContain('アクメ');
    expect(ScoutInputSchema.safeParse((sent.body as { input: unknown }).input).success).toBe(true);

    // 応答の結果をそのまま描く（読み直さない・立ち上げ直しの API は呼ばない）
    const result = await screen.findByRole('region', { name: '結果' });
    await within(result).findByText(SCOUT_RESULT.summary);
    expect(window.location.search).toBe(`?company=101&job=${ID1}&basis=conditions`);
    expect(m.calls).not.toContain(`GET /api/ai/jobs/${ID1}`);
    expect(m.calls.some((c) => c.endsWith('/fire'))).toBe(false);
    // 3 つの案は、下の段（全幅）に出る
    const cards = screen.getAllByRole('article');
    expect(cards[0].closest('.ai-col-wide')).not.toBeNull();
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['モデル A', 'モデル B', 'モデル C']);
    expect(cards[0].querySelector('[data-part="subject"]')?.textContent).toBe(DA.subject);
    expect(cards[0].querySelector('[data-part="body"]')?.textContent).toBe(DA.body);
    expect(cards[0].textContent).toContain('第 3 版');
    expect(cards[0].textContent).toContain(DA.rationale);
    expect(cards[0].textContent).toContain(`本文 ${DA.body.length} 字`);
    for (const name of ['件名をコピー', '本文をコピー', 'すべてコピー', '手直し', SCOUT_TEXT.choose]) expect(within(cards[0]).getByRole('button', { name })).toBeTruthy();
    // 履歴に出る
    await waitFor(() => expect(screen.getByRole('list', { name: 'これまでの結果' }).textContent).toContain('作成: 法人営業マネージャー'));
  });

  it('分析結果: 分析対象・数値・要点が出て、畳める', async () => {
    mockAiApi({ jobs: [savedJob()] });
    open(`?company=101&job=${ID1}`);
    const a = await screen.findByRole('region', { name: '分析結果' });
    const basis = within(a).getByRole('region', { name: '分析対象' });
    for (const t of ['類似業界', 'IT・通信（類似業界 6 業種）', '返信率 10% 超の文面 412 件', '86 社', '18,240 通', '返信 2,643 件', '14.5%', '5.1%', '2025-11-27〜2026-11-26', '保存済みの分析を使用', '所要時間 14.2 秒', '次の条件を外して分析しました: 現住所', '送る相手の条件で数え直しています']) expect(basis.textContent).toContain(t);
    const stats = within(a).getByRole('region', { name: '数値' });
    for (const t of ['件名の文字数（中央値）36 字', '28〜44 字', '680 字', '24 行']) expect(stats.textContent).toContain(t);
    // 特徴は割合の高い順に上位 8 個（9 個目は出さない）。値は数字でも出す
    const bars = within(stats).getByRole('list', { name: '特徴ごとの割合' });
    const rows = within(bars).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    expect(rows[0].textContent).toBe('年収の記載あり78.2%');
    expect((rows[0].querySelector('.fill') as HTMLElement).style.width).toBe('78.2%');
    expect(bars.textContent).not.toContain('返信の期限あり');
    expect(within(stats).getByLabelText('言語の割合').textContent).toContain('日本語 82.5%');
    const insight = within(a).getByRole('region', { name: '要点' });
    expect(within(within(insight).getByRole('list', { name: '本文の構成' })).getAllByRole('listitem')).toHaveLength(5);
    expect(within(within(insight).getByRole('list', { name: '特徴' })).getAllByRole('listitem')).toHaveLength(3);
    expect(insight.textContent).toContain(SCOUT_RESULT.insight.volume);
    expect(insight.textContent).toContain(SCOUT_RESULT.insight.subjectPatterns[0]);
    expect(within(insight).getByRole('list', { name: '避けたいこと' }).textContent).toContain('会社の説明から始める');
    fireEvent.click(within(a).getByRole('button', { name: '畳む' }));
    expect(within(a).queryByRole('region', { name: '分析対象' })).toBeNull();
    expect(within(a).getByText(SCOUT_RESULT.summary)).toBeTruthy();
    fireEvent.click(within(a).getByRole('button', { name: '開く' }));
    expect(within(a).getByRole('region', { name: '分析対象' })).toBeTruthy();
  });

  it('添削は件名と本文が必須。結果には変更点と注意（warnings）が出る。10% 超が無いときの選び方の文', async () => {
    const m = mockAiApi({ create: doneCreate(SCOUT_REVIEW_RESULT) });
    open('?company=101&purpose=review&basis=conditions');
    await ready();
    type(field('ポジション名'), '法人営業');
    fireEvent.click(runButton('この内容で添削する'));
    expect(await screen.findByText('添削する件名を入れてください')).toBeTruthy();
    expect(screen.getByText('添削する本文を入れてください')).toBeTruthy();
    expect(posts(m)).toHaveLength(0);
    type(field('件名'), '  【ご案内】新しいポジション ');
    type(field('本文'), 'はじめまして。{{企業名}} の採用担当です。');
    fireEvent.click(runButton('この内容で添削する'));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const input = (posts(m)[0].body as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ purpose: 'review', subject: '【ご案内】新しいポジション', body: 'はじめまして。{{企業名}} の採用担当です。', filters: EMPTY_SCOUT_FILTERS });
    expect(ScoutInputSchema.safeParse(input).success).toBe(true);
    const result = await screen.findByRole('region', { name: '結果' });
    expect((await screen.findAllByRole('article')).length).toBe(2);
    expect(within(card('モデル A')).getByRole('list', { name: '主な変更点' }).textContent).toContain('件名の先頭に年収と職種を入れました');
    expect(result.textContent).toContain('モデル C は案を作れませんでした');
    expect(result.textContent).toContain('返信率 10% 超の文面が無いため、返信率の高い順に 37 件');
    expect(result.textContent).toContain('全業界');
    expect(result.textContent).toContain('送る相手の条件は指定なし');
  });

  it('メールアドレス・企業名が入っていると実行できない（block）。「〇〇様」は注意だけ（warn）で実行できる', async () => {
    const m = mockAiApi({ create: doneCreate() });
    open('?company=101&purpose=review&basis=conditions');
    await ready();
    await waitFor(() => expect(runButton('この内容で添削する').disabled).toBe(false));
    type(field('件名'), 'ポジションのご案内');
    type(field('ポジション名'), '法人営業');
    type(field('本文'), 'ご連絡は saiyo@example.com までお願いします');
    expect(screen.getByRole('alert').textContent).toContain('本文: メールアドレスが入っています（saiyo@example.com）');
    expect(runButton('この内容で添削する').disabled).toBe(true);
    expect(screen.getByText('企業名・個人情報を消すと実行できます')).toBeTruthy();
    type(field('本文'), 'アクメ商事で一緒に働きませんか');
    expect(screen.getByRole('alert').textContent).toContain('本文: 企業名が入っています（アクメ商事）');
    type(field('本文'), 'はじめまして');
    type(field('補足'), '03-1234-5678 に電話');
    expect(screen.getByRole('alert').textContent).toContain('補足: 電話番号が入っています');
    expect(runButton('この内容で添削する').disabled).toBe(true);
    type(field('補足'), '');
    type(field('本文'), '山田様、はじめまして');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.ai-pii .notice.warn')?.textContent).toContain('本文: 個人名らしい書き方があります（「〇〇様」）');
    expect(runButton('この内容で添削する').disabled).toBe(false);
    fireEvent.click(runButton('この内容で添削する'));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
  });

  it('閲覧のみの人は実行できない。分析用のデータが無いときは、その知らせを出す', async () => {
    mockAiApi({ config: { canWrite: false }, scoutOptions: { ageGroups: [], nationalities: [], japaneseLevels: [], englishLevels: [], residences: [], occupations: [], dataDate: null } });
    open('?company=101&basis=conditions');
    expect(await screen.findByText(AI_TEXT.readOnly)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText('実行には Google ログインが必要です')).toBeTruthy();
    expect(await screen.findByText(SCOUT_TEXT.noMart)).toBeTruthy();
    expect(screen.queryByRole('group', { name: '年齢層' })).toBeNull();
  });

  it('実行中は押せなくし、「分析して 3 つの案を作っています」と経過を出す。作れなかったら理由と「もう一度作る」（= 同じ入力で新しく POST）', async () => {
    let release: (() => void) | null = null;
    let n = 0;
    const m = mockAiApi({
      create: (companyId, body, mock) => {
        n += 1;
        if (n === 1) {
          const job = makeJob({ id: ID2, kind: 'scout', companyId, input: body.input, status: 'failed', error: 'Vertex AI の応答が時間内に返りませんでした', completedAt: null, title: '作成: 失敗' });
          mock.jobs.set(job.id, job);
          return { json: { job, fire: 'failed', fireMessage: 'Vertex AI の応答が時間内に返りませんでした' } };
        }
        return doneCreate()(companyId, body, mock);
      },
    });
    // 1 回目の POST だけ、応答を待たせる
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && /\/ai\/jobs$/.test(String(input)) && n === 0) await new Promise<void>((r) => (release = r));
      return inner(input, init);
    }) as typeof fetch;
    open('?company=101&basis=conditions');
    await ready();
    type(field('ポジション名'), '法人営業マネージャー');
    fireEvent.click(runButton());
    expect(await screen.findByText(SCOUT_TEXT.generating)).toBeTruthy();
    expect(screen.getByText(/^経過 \d+ 秒$/)).toBeTruthy();
    const busy = screen.getByRole('button', { name: '作っています…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((field('ポジション名') as HTMLInputElement).disabled).toBe(true);
    await waitFor(() => expect(release).not.toBeNull());
    release!();
    expect(await screen.findByText(AI_TEXT.failed)).toBeTruthy();
    expect(screen.getByText('Vertex AI の応答が時間内に返りませんでした')).toBeTruthy();
    expect(screen.queryByText(SCOUT_TEXT.generating)).toBeNull();
    expect(window.location.search).toBe(`?company=101&job=${ID2}&basis=conditions`);
    fireEvent.click(screen.getByRole('button', { name: AI_TEXT.retry }));
    await screen.findByText(SCOUT_RESULT.summary);
    expect(posts(m)).toHaveLength(2);
    expect(posts(m)[1].url).toBe('/api/companies/101/ai/jobs');
    expect(posts(m)[1].body).toEqual(posts(m)[0].body);
    expect(m.calls.some((c) => c.endsWith('/fire'))).toBe(false);
    expect(window.location.search).toBe(`?company=101&job=${ID1}&basis=conditions`);
  });
});

describe('② スカウト文面の AI 作成: 求人 ID・会員 ID から作る（最初に選び、確かめてから実行）', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  /** 作成の応答: 入力をそのまま持つジョブ（target つきの結果） */
  const create = (result: ScoutResult, title: string) => (companyId: string, body: { kind: string; input: unknown }, m: AiMock) => {
    const job = makeJob({ id: ID1, kind: 'scout', companyId, input: body.input, result, title });
    m.jobs.set(job.id, job);
    return { json: { job, fire: 'done', fireMessage: null } };
  };

  it('求人 ID から作る: 確かめる（GET。AI は動かない）→ 求人のカード → 実行で input.basis = job・jobId が入る（ポジション名は空）。結果に、何をもとに作ったかが出る', async () => {
    const m = mockAiApi({ create: create(SCOUT_JOB_RESULT, '作成: バイリンガル法人営業マネージャー（求人 5001）') });
    open('?company=101');
    pickBasis('job');
    expect(window.location.search).toBe('?company=101&basis=job');
    await ready();
    // ポジション名・掲載職種・勤務地の欄は出さない（求人から取る）。送る相手の条件は指定できる
    expect(screen.queryByRole('textbox', { name: 'ポジション名' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '勤務地' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '掲載職種を足す' })).toBeNull();
    expect(screen.getByText(SCOUT_TEXT.jobFields)).toBeTruthy();
    expect(screen.getByText(SCOUT_TEXT.filtersLegend)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '会員 ID' })).toBeNull();
    // 確かめるまでは実行できない（理由が出る）
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText(SCOUT_TEXT.needJob)).toBeTruthy();
    expect(screen.getByText(SCOUT_TEXT.runHint)).toBeTruthy();
    const check = screen.getByRole('button', { name: SCOUT_TEXT.checkJob }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    // 数字でない ID は、読みに行かない
    type(field('求人 ID'), 'J-5001');
    fireEvent.click(check);
    expect(await screen.findByText('求人 ID は数字で入れてください')).toBeTruthy();
    expect(gets(m, /scout\/jobs\//)).toHaveLength(0);
    type(field('求人 ID'), ' 5001 ');
    expect(screen.queryByText('求人 ID は数字で入れてください')).toBeNull();
    fireEvent.click(check);
    const cardEl = await screen.findByRole('region', { name: '求人の内容' });
    expect(gets(m, /scout\/jobs\//)).toEqual(['GET /api/companies/101/ai/scout/jobs/5001']);
    for (const t of [SCOUT_JOB_SUMMARY.title, '求人 ID 5001', '掲載中', '職種営業', '勤務地東京都', '年収800〜1,000 万円', '日本語ネイティヴ', '英語ビジネス会話', SCOUT_JOB_SUMMARY.descriptionHead, SCOUT_JOB_SUMMARY.requirementsHead]) expect(cardEl.textContent).toContain(t);
    expect(cardEl.textContent).not.toContain(SCOUT_TEXT.jobUnpublished);
    expect(window.location.search).toBe('?company=101&basis=job&jobId=5001');
    // 確かめる操作では、AI（POST）は呼ばれない
    expect(posts(m)).toHaveLength(0);
    expect(m.bodies).toHaveLength(0);
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(screen.queryByText(SCOUT_TEXT.needJob)).toBeNull();
    fireEvent.click(within(await screen.findByRole('group', { name: '年齢層' })).getByRole('button', { name: '30代' }));
    type(field('補足'), '英語を使う場面を伝えたい');
    fireEvent.click(runButton());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const input = (posts(m)[0].body as { input: Record<string, unknown> }).input;
    expect(posts(m)[0].url).toBe('/api/companies/101/ai/jobs');
    expect(input).toMatchObject({ purpose: 'template', basis: 'job', jobId: '5001', memberId: null, industry: 'IT・通信', positionName: '', jobOccupations: [], jobLocation: '', note: '英語を使う場面を伝えたい', filters: { ...EMPTY_SCOUT_FILTERS, ageGroups: ['30代'] } });
    expect(ScoutInputSchema.safeParse(input).success).toBe(true);
    // 結果の見出しの下に、作り方と求人の要約
    const target = await screen.findByRole('group', { name: SCOUT_TEXT.targetLabel });
    expect(target.textContent).toContain(SCOUT_BASIS_LABEL.job);
    expect(target.textContent).toContain(`求人: ${SCOUT_JOB_SUMMARY.title}（ID 5001）`);
    expect(target.textContent).not.toContain('候補者');
    expect(screen.getByRole('heading', { name: '作成: バイリンガル法人営業マネージャー（求人 5001）' })).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('求人が見つからない（404）ときは、欄の下に理由。ID を変えると確認が消える。Enter は「確かめる」（実行しない）。掲載が終わった求人は注意', async () => {
    const m = mockAiApi({ create: create(SCOUT_JOB_RESULT, '作成') });
    open('?company=101&basis=job');
    await ready();
    type(field('求人 ID'), '9999');
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.checkJob }));
    expect(await screen.findByText(SCOUT_TEXT.jobNotFound)).toBeTruthy();
    expect(jobCard()).toBeNull();
    expect(runButton().disabled).toBe(true);
    // 別の企業の求人も、この企業の求人としては見つからない
    type(field('求人 ID'), '6001');
    expect(screen.queryByText(SCOUT_TEXT.jobNotFound)).toBeNull();
    fireEvent.keyDown(field('求人 ID'), { key: 'Enter' });
    expect(await screen.findByText(SCOUT_TEXT.jobNotFound)).toBeTruthy();
    expect(gets(m, /scout\/jobs\//)).toEqual(['GET /api/companies/101/ai/scout/jobs/9999', 'GET /api/companies/101/ai/scout/jobs/6001']);
    // 掲載が終わった求人
    type(field('求人 ID'), '5002');
    fireEvent.keyDown(field('求人 ID'), { key: 'Enter' });
    const ended = await screen.findByRole('region', { name: '求人の内容' });
    expect(ended.textContent).toContain('掲載終了');
    expect(ended.textContent).toContain(SCOUT_TEXT.jobUnpublished);
    expect(ended.textContent).toContain('年収—');
    await waitFor(() => expect(runButton().disabled).toBe(false));
    // ID を変えると、確かめた内容が消えて、実行できなくなる
    type(field('求人 ID'), '50021');
    expect(jobCard()).toBeNull();
    expect(runButton().disabled).toBe(true);
    expect(window.location.search).toBe('?company=101&basis=job');
    fireEvent.submit(screen.getByRole('form', { name: 'スカウト文面の AI 作成の入力' }));
    expect(posts(m)).toHaveLength(0);
    expect(m.bodies).toHaveLength(0);
  });

  it('企業を変えると、求人の確認が消える（求人は企業に属する）。企業が無いと確かめられない', async () => {
    const m = mockAiApi();
    open('?company=101&basis=job&jobId=5001');
    // URL に ID があれば、自動で確かめる（AI は動かない）
    expect(await screen.findByRole('region', { name: '求人の内容' })).toBeTruthy();
    expect((field('求人 ID') as HTMLInputElement).value).toBe('5001');
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '企業の選択を外す' }));
    expect(jobCard()).toBeNull();
    expect(window.location.search).toBe('?basis=job');
    expect(screen.getByText(SCOUT_TEXT.jobNeedsCompany)).toBeTruthy();
    expect((screen.getByRole('button', { name: SCOUT_TEXT.checkJob }) as HTMLButtonElement).disabled).toBe(true);
    await pickCompany('グローバル物流');
    expect(window.location.search).toBe('?company=102&basis=job');
    expect(jobCard()).toBeNull();
    expect(runButton().disabled).toBe(true);
    // もう一度確かめると、新しい企業の求人として読む
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.checkJob }));
    expect(await screen.findByText(SCOUT_TEXT.jobNotFound)).toBeTruthy();
    expect(gets(m, /scout\/jobs\//)).toEqual(['GET /api/companies/101/ai/scout/jobs/5001', 'GET /api/companies/102/ai/scout/jobs/5001']);
    expect(m.bodies).toHaveLength(0);
  });

  it('会員 ID から作る: 確かめる → 候補者のカードと、絞り込みに使う条件のチップ → 実行。送る相手の条件の欄は出さない。求人の内容は自分で入れる', async () => {
    const m = mockAiApi({ create: create({ ...SCOUT_RESULT, target: { basis: 'member', job: null, member: SCOUT_MEMBER_SUMMARY } }, '作成: 法人営業（会員 70001）') });
    open('?company=101&basis=member');
    await ready();
    expect(screen.queryByText(SCOUT_TEXT.filtersLegend)).toBeNull();
    expect(screen.queryByRole('textbox', { name: '求人 ID' })).toBeNull();
    expect(field('ポジション名')).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText(SCOUT_TEXT.needMember)).toBeTruthy();
    type(field('会員 ID'), '12345');
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.checkMember }));
    expect(await screen.findByText(SCOUT_TEXT.memberNotFound)).toBeTruthy();
    expect(memberCard()).toBeNull();
    type(field('会員 ID'), '70001');
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.checkMember }));
    const cardEl = await screen.findByRole('region', { name: '候補者の情報' });
    expect(gets(m, /scout\/members\//)).toEqual(['GET /api/ai/scout/members/12345', 'GET /api/ai/scout/members/70001']);
    for (const t of ['会員 ID 70001', SCOUT_TEXT.memberPrivacy, '年齢層30代', '現住所東京都', '日本語ビジネス会話', '英語ネイティヴ', '経験職種営業、マーケティング', '希望職種営業、事業開発', SCOUT_TEXT.memberFilters]) expect(cardEl.textContent).toContain(t);
    expect(within(within(cardEl).getByRole('list', { name: '分析対象の絞り込みに使う条件' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['年齢層: 30代', '経験職種: 営業']);
    expect(window.location.search).toBe('?company=101&basis=member&memberId=70001');
    expect(m.bodies).toHaveLength(0);
    // ポジション名は自分で入れる（必須）
    fireEvent.click(runButton());
    expect(await screen.findByText('ポジション名を入れてください')).toBeTruthy();
    expect(posts(m)).toHaveLength(0);
    type(field('ポジション名'), '法人営業');
    fireEvent.click(runButton());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const input = (posts(m)[0].body as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ basis: 'member', jobId: null, memberId: '70001', positionName: '法人営業', jobOccupations: ['ITエンジニア', '営業', 'マーケティング'], filters: EMPTY_SCOUT_FILTERS });
    expect(ScoutInputSchema.safeParse(input).success).toBe(true);
    const target = await screen.findByRole('group', { name: SCOUT_TEXT.targetLabel });
    expect(target.textContent).toContain(SCOUT_BASIS_LABEL.member);
    expect(target.textContent).toContain('候補者: 会員 ID 70001・営業・日本語 ビジネス会話・英語 ネイティヴ');
    // 候補者の要約は畳んである
    expect((target.querySelector('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('求人 ID + 会員 ID から作る: 両方を確かめるまで実行できない。ポジション名の欄も、送る相手の条件の欄も出さない。添削とも組み合わせられる', async () => {
    const m = mockAiApi({ create: create(SCOUT_JOB_MEMBER_RESULT, '添削: バイリンガル法人営業マネージャー（求人 5001・会員 70001）') });
    open('?company=101&basis=jobMember&purpose=review');
    await ready();
    expect(screen.queryByRole('textbox', { name: 'ポジション名' })).toBeNull();
    expect(screen.queryByText(SCOUT_TEXT.filtersLegend)).toBeNull();
    const run = () => runButton('この内容で添削する');
    expect(run().disabled).toBe(true);
    expect(screen.getByText(SCOUT_TEXT.needJobMember)).toBeTruthy();
    type(field('求人 ID'), '5001');
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.checkJob }));
    await screen.findByRole('region', { name: '求人の内容' });
    expect(run().disabled).toBe(true);
    expect(screen.getByText(SCOUT_TEXT.needMember)).toBeTruthy();
    type(field('会員 ID'), '70001');
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.checkMember }));
    await screen.findByRole('region', { name: '候補者の情報' });
    await waitFor(() => expect(run().disabled).toBe(false));
    expect(window.location.search).toBe('?company=101&purpose=review&basis=jobMember&jobId=5001&memberId=70001');
    // 求人の ID を変えると、また実行できなくなる（候補者の確認は残る）
    type(field('求人 ID'), '500');
    expect(run().disabled).toBe(true);
    expect(screen.getByText(SCOUT_TEXT.needJob)).toBeTruthy();
    expect(memberCard()).not.toBeNull();
    type(field('求人 ID'), '5001');
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.checkJob }));
    await screen.findByRole('region', { name: '求人の内容' });
    expect(m.bodies).toHaveLength(0);
    type(field('件名'), '【ご案内】新しいポジション');
    type(field('本文'), 'はじめまして。{{企業名}} の採用担当です。');
    fireEvent.click(run());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const input = (posts(m)[0].body as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ purpose: 'review', basis: 'jobMember', jobId: '5001', memberId: '70001', positionName: '', jobOccupations: [], jobLocation: '', filters: EMPTY_SCOUT_FILTERS, subject: '【ご案内】新しいポジション' });
    expect(ScoutInputSchema.safeParse(input).success).toBe(true);
    const target = await screen.findByRole('group', { name: SCOUT_TEXT.targetLabel });
    for (const t of [SCOUT_BASIS_LABEL.jobMember, `求人: ${SCOUT_JOB_SUMMARY.title}（ID 5001）`, '候補者: 会員 ID 70001']) expect(target.textContent).toContain(t);
  });

  it('作り方を変えると、使わない ID は URL から外れる。履歴から開くと、作り方と ID が入力欄に戻り、自動で確かめ直す（AI は動かない）', async () => {
    const m = mockAiApi({ jobs: [makeJob({ id: ID1, kind: 'scout', companyId: '101', title: '作成: 求人 5001・会員 70001', input: SCOUT_JOB_MEMBER_INPUT, result: SCOUT_JOB_MEMBER_RESULT }), makeJob({ id: ID2, kind: 'scout', companyId: '101', title: '作成: 以前の結果', input: { ...SCOUT_INPUT, basis: undefined, jobId: undefined, memberId: undefined }, result: { ...SCOUT_RESULT, target: undefined }, createdAt: '2026-11-20T01:00:00.000Z' })] });
    open(`?company=101&job=${ID1}`);
    await screen.findByText(SCOUT_RESULT.summary);
    await waitFor(() => expect(window.location.search).toBe(`?company=101&job=${ID1}&basis=jobMember&jobId=5001&memberId=70001`));
    expect(basisRadio('jobMember').checked).toBe(true);
    expect((field('求人 ID') as HTMLInputElement).value).toBe('5001');
    expect((field('会員 ID') as HTMLInputElement).value).toBe('70001');
    expect(await screen.findAllByRole('region', { name: '求人の内容' })).not.toHaveLength(0);
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(gets(m, /scout\/jobs\//)).toEqual(['GET /api/companies/101/ai/scout/jobs/5001']);
    expect(gets(m, /scout\/members\//)).toEqual(['GET /api/ai/scout/members/70001']);
    expect(m.bodies).toHaveLength(0);
    // 作り方を変える: 会員 ID だけ → 求人 ID が URL から外れる。条件 → どちらも外れる
    pickBasis('member');
    expect(window.location.search).toBe(`?company=101&job=${ID1}&basis=member&memberId=70001`);
    expect(screen.queryByRole('textbox', { name: '求人 ID' })).toBeNull();
    pickBasis('conditions');
    expect(window.location.search).toBe(`?company=101&job=${ID1}&basis=conditions`);
    // target の無い以前の結果は、「条件を指定して作る」として開く
    const list = screen.getByRole('list', { name: 'これまでの結果' });
    fireEvent.click(within(list).getByRole('button', { name: /^作成: 以前の結果完了/ }));
    await waitFor(() => expect(window.location.search).toBe(`?company=101&job=${ID2}&basis=conditions`));
    await waitFor(() => expect((field('ポジション名') as HTMLInputElement).value).toBe('法人営業マネージャー'));
    expect(screen.queryByRole('group', { name: SCOUT_TEXT.targetLabel })).toBeNull();
  });
});

describe('② スカウト文面の AI 作成: 選ぶ・使ったかの記録・手直し・履歴', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('「この案を選ぶ」で PUT …/scout/choice（コメントつき）。選び直せる。「どれも使わない」は draftId = null', async () => {
    const m = mockAiApi({ jobs: [savedJob()] });
    open(`?company=101&job=${ID1}`);
    await screen.findByText(SCOUT_RESULT.summary);
    // 履歴から開くと、そのときの入力が欄に入る
    await waitFor(() => expect((field('ポジション名') as HTMLInputElement).value).toBe('法人営業マネージャー'));
    expect(within(await screen.findByRole('group', { name: '年齢層' })).getByRole('button', { name: '30代' }).getAttribute('aria-pressed')).toBe('true');
    // 選ぶ前は「企業が使いましたか？」を出さない
    expect(screen.queryByRole('region', { name: '企業の利用' })).toBeNull();
    type(field('コメント（任意）'), ' 件名が具体的 ');
    expect(screen.getByText(new RegExp(SCOUT_TEXT.commentHint))).toBeTruthy();
    fireEvent.click(within(card('モデル B')).getByRole('button', { name: SCOUT_TEXT.choose }));
    await waitFor(() => expect(puts(m, '/scout/choice')).toHaveLength(1));
    expect(puts(m, '/scout/choice')[0].url).toBe(`/api/ai/jobs/${ID1}/scout/choice`);
    expect(puts(m, '/scout/choice')[0].body).toEqual({ draftId: DB.draftId, comment: '件名が具体的' });
    expect(ScoutChoiceInputSchema.safeParse(puts(m, '/scout/choice')[0].body).success).toBe(true);
    await waitFor(() => expect(card('モデル B').getAttribute('data-selected')).toBe('true'));
    expect(within(card('モデル B')).getByRole('button', { name: SCOUT_TEXT.chosen }).getAttribute('aria-pressed')).toBe('true');
    expect(card('モデル A').getAttribute('data-selected')).toBeNull();
    expect(screen.getByRole('region', { name: '企業の利用' }).textContent).toContain('選んだ案: モデル B');
    // 選び直す
    fireEvent.click(within(card('モデル A')).getByRole('button', { name: SCOUT_TEXT.choose }));
    await waitFor(() => expect(card('モデル A').getAttribute('data-selected')).toBe('true'));
    expect(card('モデル B').getAttribute('data-selected')).toBeNull();
    // どれも使わない
    fireEvent.click(screen.getByRole('button', { name: SCOUT_TEXT.chooseNone }));
    await waitFor(() => expect(puts(m, '/scout/choice')).toHaveLength(3));
    expect((puts(m, '/scout/choice')[2].body as { draftId: unknown }).draftId).toBeNull();
    await waitFor(() => expect(screen.queryByRole('region', { name: '企業の利用' })).toBeNull());
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
    expect(screen.getByText('「どれも使わない」を記録しました')).toBeTruthy();
    // コメントだけを送り直せる（選択はそのまま）
    type(field('コメント（任意）'), '年収の書き方を直してほしい');
    fireEvent.click(screen.getByRole('button', { name: 'コメントを送る' }));
    await waitFor(() => expect(puts(m, '/scout/choice')).toHaveLength(4));
    expect(puts(m, '/scout/choice')[3].body).toEqual({ draftId: null, comment: '年収の書き方を直してほしい' });
  });

  it('選んだ後に「使った / 使わなかった / 未確認」を PUT …/scout/usage で記録する。送信実績と照合できたら、その数を出す', async () => {
    const chosen: ScoutResult = { ...SCOUT_RESULT, drafts: SCOUT_RESULT.drafts.map((d, i) => (i === 0 ? { ...d, feedback: { chosen: true, usedState: 'unknown', usedSource: null, sends: null, replies: null, hires: null, outcomeAt: null } } : d)) };
    const m = mockAiApi({ jobs: [savedJob({ result: chosen })] });
    const view = open(`?company=101&job=${ID1}`);
    const usage = await screen.findByRole('region', { name: '企業の利用' });
    expect(within(usage).getByText(SCOUT_TEXT.usageQuestion)).toBeTruthy();
    expect(within(usage).getByRole('button', { name: '未確認' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(usage).getByRole('button', { name: '使った' }));
    await waitFor(() => expect(puts(m, '/scout/usage')).toHaveLength(1));
    expect(puts(m, '/scout/usage')[0].url).toBe(`/api/ai/jobs/${ID1}/scout/usage`);
    expect(puts(m, '/scout/usage')[0].body).toEqual({ usedState: 'used' });
    expect(ScoutUsageInputSchema.safeParse(puts(m, '/scout/usage')[0].body).success).toBe(true);
    await waitFor(() => expect(within(screen.getByRole('region', { name: '企業の利用' })).getByRole('button', { name: '使った' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByText('画面で記録')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: '企業の利用' })).getByRole('button', { name: '使わなかった' }));
    await waitFor(() => expect(puts(m, '/scout/usage')).toHaveLength(2));
    expect(puts(m, '/scout/usage')[1].body).toEqual({ usedState: 'not_used' });
    view.unmount();

    // 送信実績から自動で確認できたとき
    clearResourceCache();
    const auto: ScoutResult = { ...chosen, drafts: chosen.drafts.map((d, i) => (i === 0 ? { ...d, feedback: { chosen: true, usedState: 'used', usedSource: 'auto', sends: 120, replies: 17, hires: 1, outcomeAt: '2026-11-27T00:00:00.000Z' } } : d)) };
    mockAiApi({ jobs: [savedJob({ result: auto })] });
    open(`?company=101&job=${ID1}`);
    const u = await screen.findByRole('region', { name: '企業の利用' });
    expect(within(u).getByText('送信実績から自動で確認')).toBeTruthy();
    const outcome = within(u).getByLabelText('この案の送信実績');
    expect(outcome.textContent).toBe('送信120 通返信17 件採用1 人');
  });

  it('案を手直しして保存すると PUT …/edited（結果と同じ形。feedback は入れない）。選択の状態は保たれる。元に戻すと DELETE', async () => {
    const chosen: ScoutResult = { ...SCOUT_RESULT, drafts: SCOUT_RESULT.drafts.map((d, i) => (i === 1 ? { ...d, feedback: { ...d.feedback!, chosen: true } } : d)) };
    const m = mockAiApi({ jobs: [savedJob({ result: chosen })] });
    open(`?company=101&job=${ID1}`);
    await screen.findByText(SCOUT_RESULT.summary);
    fireEvent.click(within(card('モデル B')).getByRole('button', { name: '手直し' }));
    const subject = within(card('モデル B')).getByRole('textbox', { name: '件名（手直し）' }) as HTMLInputElement;
    expect(subject.value).toBe(DB.subject);
    type(subject, '');
    fireEvent.click(within(card('モデル B')).getByRole('button', { name: '保存' }));
    expect(await within(card('モデル B')).findByText('件名を入れてください（200 文字まで）')).toBeTruthy();
    type(subject, '直した件名');
    fireEvent.click(within(card('モデル B')).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(puts(m, '/edited')).toHaveLength(1));
    const put = puts(m, '/edited')[0];
    expect(put.url).toBe(`/api/ai/jobs/${ID1}/edited`);
    const saved = (put.body as { result: ScoutResult }).result;
    expect(ScoutResultSchema.safeParse(saved).success).toBe(true);
    expect(saved.drafts[1].subject).toBe('直した件名');
    expect(saved.drafts[1].body).toBe(DB.body);
    expect(saved.drafts[0].subject).toBe(DA.subject);
    expect(saved.drafts.every((d) => d.feedback === null)).toBe(true);
    expect(saved.basis).toEqual(SCOUT_RESULT.basis);
    await waitFor(() => expect(card('モデル B').querySelector('[data-part="subject"]')?.textContent).toBe('直した件名'));
    // 直した版を重ねても、選択（元の結果の feedback）は消えない
    expect(card('モデル B').getAttribute('data-selected')).toBe('true');
    const drafts = screen.getByRole('region', { name: '3 つの案' });
    expect(within(drafts).getByText(AI_TEXT.edited)).toBeTruthy();
    fireEvent.click(within(drafts).getByRole('button', { name: '元の案に戻す' }));
    await waitFor(() => expect(m.calls).toContain(`DELETE /api/ai/jobs/${ID1}/edited`));
    await waitFor(() => expect(card('モデル B').querySelector('[data-part="subject"]')?.textContent).toBe(DB.subject));
  });

  it('保存されない見本（サンプルデータ）でも、選ぶ・使ったかの記録が画面の中でできる', async () => {
    const m = mockAiApi({
      config: { sampleMode: true, canWrite: false },
      create: (companyId, body) => ({ json: { job: makeJob({ id: ID1, kind: 'scout', companyId, input: body.input, result: SCOUT_RESULT, sample: true, title: '作成: 見本' }), fire: 'sample', fireMessage: null } }),
    });
    open('?company=101&basis=conditions');
    await ready();
    type(field('ポジション名'), '法人営業マネージャー');
    fireEvent.click(runButton());
    await screen.findByText(SCOUT_RESULT.summary);
    expect(screen.getByText(AI_TEXT.sample)).toBeTruthy();
    // 見本は URL に入れない
    expect(window.location.search).toBe('?company=101&basis=conditions');
    fireEvent.click(within(card('モデル C')).getByRole('button', { name: SCOUT_TEXT.choose }));
    await waitFor(() => expect(card('モデル C').getAttribute('data-selected')).toBe('true'));
    expect(m.calls).toContain(`PUT /api/ai/jobs/${ID1}/scout/choice`);
    fireEvent.click(within(screen.getByRole('region', { name: '企業の利用' })).getByRole('button', { name: '使った' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: '企業の利用' })).getByRole('button', { name: '使った' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('履歴: 開くと結果が出る。失敗した依頼は理由が出る。消せる', async () => {
    const jobs = [savedJob({ createdAt: '2026-11-24T02:00:00.000Z' }), makeJob({ id: ID2, kind: 'scout', companyId: '101', title: '作成: 失敗したもの', status: 'failed', error: '分析できる文面がありませんでした', completedAt: null, createdAt: '2026-11-23T02:00:00.000Z', input: SCOUT_INPUT })];
    const m = mockAiApi({ jobs });
    open('?company=101');
    const list = await screen.findByRole('list', { name: 'これまでの結果' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(list).getByRole('button', { name: /^作成: 失敗したもの失敗/ }));
    expect(await screen.findByText('分析できる文面がありませんでした')).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(`?company=101&job=${ID2}&basis=conditions`));
    expect(screen.getByRole('button', { name: AI_TEXT.retry })).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: /^作成: 法人営業マネージャー完了/ }));
    await screen.findByText(SCOUT_RESULT.summary);
    fireEvent.click(within(list).getByRole('button', { name: '作成: 法人営業マネージャー を履歴から消す' }));
    fireEvent.click(within(list).getByRole('button', { name: '消す' }));
    await waitFor(() => expect(m.calls).toContain(`DELETE /api/ai/jobs/${ID1}`));
    await waitFor(() => expect(window.location.search).toBe('?company=101&basis=conditions'));
  });
});

describe('② スカウト文面の AI 作成: モデルの成績', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('タブ「モデルの成績」（URL の tab）: 3 つのモデルの説明・いまの版・成績・版の履歴。管理者でない人には、ボタンとプレイブックを出さない', async () => {
    const m = mockAiApi();
    open('?company=101&basis=conditions');
    await ready();
    expect(m.calls).not.toContain('GET /api/ai/scout/models');
    fireEvent.click(screen.getByRole('button', { name: 'モデルの成績' }));
    expect(window.location.search).toBe('?company=101&tab=models&basis=conditions');
    const panel = await screen.findByRole('region', { name: 'モデルの成績' });
    expect(m.calls).toContain('GET /api/ai/scout/models');
    const tune = within(panel).getByRole('region', { name: '検証とチューニング' });
    for (const t of ['2026-11-24 09:10', SCOUT_MODELS.lastTuneNote!, SCOUT_MODELS.schedule]) expect(tune.textContent).toContain(t);
    const a = within(panel).getByRole('region', { name: 'モデル A' });
    expect(a.textContent).toContain('分析の要点をすべて取り入れる、標準の作り方');
    expect(a.textContent).toContain('第 3 版');
    const tiles = within(a).getByLabelText('いまの版の成績');
    for (const t of ['作った案42', '判断された数30', '選ばれた率46.7%14 / 30', '使われた数9', '返信率13.1%', '総合点61.4']) expect(tiles.textContent).toContain(t);
    // 判断が足りないモデルは、据え置きの説明を出す。値が無い率は「—」
    const b = within(panel).getByRole('region', { name: 'モデル B' });
    expect(b.textContent).toContain('判断された数が 8 件になるまでは');
    expect(within(b).getByLabelText('いまの版の成績').textContent).toContain('総合点—');
    // 版の履歴（畳んである。開くと新しい順）
    expect(within(a).queryByRole('table')).toBeNull();
    fireEvent.click(within(a).getByRole('button', { name: /版の履歴（3）/ }));
    const rows = within(within(a).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => (r as HTMLTableRowElement).cells[0].textContent)).toEqual(['第 3 版使用中', '第 2 版', '第 1 版']);
    expect(rows[0].textContent).toContain('チューニング');
    expect(rows[0].textContent).toContain('件名の先頭に年収を入れる指示を足した');
    expect(rows[0].textContent).toContain('2026-11-17 09:10');
    expect(rows[2].textContent).toContain('初版');
    expect(rows[2].textContent).toContain('31.3%');
    fireEvent.click(within(within(panel).getByRole('region', { name: 'モデル C' })).getByRole('button', { name: /版の履歴（2）/ }));
    expect(within(panel).getByRole('region', { name: 'モデル C' }).textContent).toContain('戻した');
    // 管理者でない人
    expect(screen.queryByRole('button', { name: SCOUT_TEXT.tuneNow })).toBeNull();
    expect(screen.queryByRole('button', { name: /プレイブック/ })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(SCOUT_TEXT.rollback) })).toBeNull();
    expect(panel.textContent).not.toContain('engine-x-1');
    expect(panel.textContent).not.toContain('管理');
  });

  it('管理者: プレイブックの表示、「今すぐ検証・チューニング」（POST /api/ai/scout/tune）の結果、「この版に戻す」（POST …/rollback）', async () => {
    const m = mockAiApi({ config: { admin: true }, scoutModels: SCOUT_MODELS });
    open('?tab=models');
    const panel = await screen.findByRole('region', { name: 'モデルの成績' });
    const a = () => within(screen.getByRole('region', { name: 'モデルの成績' })).getByRole('region', { name: 'モデル A' });
    expect(a().textContent).toContain('engine-x-1');
    // プレイブック（いまの版）
    fireEvent.click(within(a()).getByRole('button', { name: /プレイブック（作り方）を見る/ }));
    expect(within(a()).getByRole('region', { name: 'モデル A 第 3 版のプレイブック' }).textContent).toContain('1. 件名の先頭に年収と職種');
    // 前の版のプレイブックも見られる
    fireEvent.click(within(a()).getByRole('button', { name: /版の履歴（3）/ }));
    fireEvent.click(within(a()).getByRole('button', { name: '第 1 版のプレイブック' }));
    expect(within(a()).getByRole('region', { name: 'モデル A 第 1 版のプレイブック' }).textContent).toContain('第 1 版の作り方');
    // 今すぐ検証・チューニング
    fireEvent.click(within(panel).getByRole('button', { name: SCOUT_TEXT.tuneNow }));
    const done = await screen.findByRole('status', { name: '検証・チューニングの結果' });
    expect(m.bodies.some((x) => x.method === 'POST' && x.url === '/api/ai/scout/tune')).toBe(true);
    expect(done.textContent).toContain('実績を取り込んだ案: 7 件');
    const items = within(done).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-action'))).toEqual(['tuned', 'kept', 'rolledBack']);
    expect(items[0].textContent).toBe('モデル A直した第 3 版 → 第 4 版避けたい表現の指示を足しました');
    expect(items[1].textContent).toContain('据え置き第 1 版のまま');
    expect(items[2].textContent).toContain('戻した第 2 版 → 第 3 版');
    // 実行の後は、成績を読み直す
    await waitFor(() => expect(m.calls.filter((c) => c === 'GET /api/ai/scout/models').length).toBeGreaterThanOrEqual(2));
    // この版に戻す（確認つき）。使用中の版には出さない
    expect(within(a()).queryByRole('button', { name: `第 3 版: ${SCOUT_TEXT.rollback}` })).toBeNull();
    fireEvent.click(within(a()).getByRole('button', { name: `第 2 版: ${SCOUT_TEXT.rollback}` }));
    expect(m.bodies.some((x) => x.url.endsWith('/rollback'))).toBe(false);
    fireEvent.click(within(a()).getByRole('button', { name: '戻す' }));
    await waitFor(() => expect(m.bodies.some((x) => x.url.endsWith('/rollback'))).toBe(true));
    const rb = m.bodies.find((x) => x.url.endsWith('/rollback'))!;
    expect(rb.method).toBe('POST');
    expect(rb.url).toBe('/api/ai/scout/models/a/rollback');
    expect(rb.body).toEqual({ version: 2 });
    await waitFor(() => expect((within(within(a()).getByRole('table')).getAllByRole('row')[2] as HTMLTableRowElement).cells[0].textContent).toBe('第 2 版使用中'));
  });
});

describe('scoutModel', () => {
  it('toScoutInput / validateScout / scoutFormFromInput: 作成では件名と本文を送らない。往復できる', () => {
    const form = { ...emptyScoutForm(), subject: '件名', body: '本文', industry: 'IT・通信', positionName: '営業' };
    expect(toScoutInput('template', form)).toMatchObject({ purpose: 'template', subject: '', body: '' });
    expect(toScoutInput('review', form)).toMatchObject({ purpose: 'review', subject: '件名', body: '本文' });
    const v = validateScout('review', { ...form, subject: '' });
    expect(v.ok).toBe(false);
    expect(v.errors.subject).toBe('添削する件名を入れてください');
    expect(validateScout('template', { ...form, industry: '' }).errors.industry).toBe('業界を入れてください');
    const ok = validateScout('review', form);
    expect(ok.ok).toBe(true);
    const back = scoutFormFromInput(ok.input);
    expect(back).toEqual({ purpose: 'review', source: CONDITIONS_SOURCE, form });
    expect(scoutFormFromInput({ foo: 1 })).toBeNull();
    expect(scoutFormFromInput(SCOUT_INPUT)?.form.filters.ageGroups).toEqual(['30代']);
  });

  it('toScoutInput（作り方つき）: 求人 ID から作るときはポジション名・掲載職種・勤務地を送らない。会員 ID から作るときは条件を送らない。parseScoutId / filterChips', () => {
    const form = { ...emptyScoutForm(), industry: 'IT・通信', positionName: '営業', jobOccupations: ['営業'], jobLocation: '東京都', filters: { ...EMPTY_SCOUT_FILTERS, ageGroups: ['30代'] } };
    expect(toScoutInput('template', form)).toMatchObject({ basis: 'conditions', jobId: null, memberId: null, positionName: '営業' });
    expect(toScoutInput('template', form, { basis: 'job', jobId: '5001', memberId: '70001' })).toMatchObject({ basis: 'job', jobId: '5001', memberId: null, positionName: '', jobOccupations: [], jobLocation: '', filters: { ageGroups: ['30代'] } });
    expect(toScoutInput('template', form, { basis: 'member', jobId: '5001', memberId: '70001' })).toMatchObject({ basis: 'member', jobId: null, memberId: '70001', positionName: '営業', filters: EMPTY_SCOUT_FILTERS });
    // 確かめた ID が無いと、検証を通らない
    expect(validateScout('template', form, { basis: 'job', jobId: null, memberId: null }).errors.jobId).toBe('求人 ID を入れてください');
    expect(validateScout('template', form, { basis: 'jobMember', jobId: '5001', memberId: null }).errors.memberId).toBe('会員 ID を入れてください');
    expect(validateScout('template', { ...form, positionName: '' }, { basis: 'jobMember', jobId: '5001', memberId: '70001' }).ok).toBe(true);
    expect(scoutFormFromInput(SCOUT_JOB_MEMBER_INPUT)?.source).toEqual({ basis: 'jobMember', jobId: '5001', memberId: '70001' });
    expect(parseScoutId('job', ' 5001 ')).toEqual({ ok: true, id: '5001' });
    expect(parseScoutId('job', '')).toEqual({ ok: false, error: '求人 ID を入れてください' });
    expect(parseScoutId('member', '7000a')).toEqual({ ok: false, error: '会員 ID は数字で入れてください' });
    expect(filterChips(SCOUT_MEMBER_SUMMARY.filters)).toEqual([
      { key: 'ageGroups', label: '年齢層', value: '30代' },
      { key: 'occupations', label: '経験職種', value: '営業' },
    ]);
    // 求人 ID から作るときは、送らない欄（ポジション名・勤務地）の社名を見ない
    expect(scoutPii('template', { ...form, jobLocation: 'アクメ商事 本社' }, ['株式会社アクメ商事'], 'job')).toEqual([]);
  });

  it('toggleFilter: 選ぶ / 外す。上限（8 個）を超えて足さない', () => {
    let f = toggleFilter(EMPTY_SCOUT_FILTERS, 'ageGroups', '30代');
    expect(f.ageGroups).toEqual(['30代']);
    expect(EMPTY_SCOUT_FILTERS.ageGroups).toEqual([]);
    f = toggleFilter(f, 'ageGroups', '30代');
    expect(f.ageGroups).toEqual([]);
    for (let i = 0; i < SCOUT_FILTER_MAX + 2; i++) f = toggleFilter(f, 'residences', `地域${i}`);
    expect(f.residences).toHaveLength(SCOUT_FILTER_MAX);
  });

  it('scoutPii: 目的が作成のときは件名・本文を見ない。勤務地も見る', () => {
    const form = { ...emptyScoutForm(), subject: 'a@example.com', body: '', positionName: '営業', jobLocation: 'アクメ商事 本社' };
    expect(scoutPii('template', form, ['株式会社アクメ商事']).map((x) => x.message)).toEqual(['勤務地: 企業名が入っています（アクメ商事）。{{企業名}} に置き換えてください']);
    expect(scoutPii('review', form, []).some((x) => x.message.startsWith('件名: メールアドレス'))).toBe(true);
  });

  it('readScoutResult: 直した版は件名・本文だけを重ね、選択（feedback）は元の結果のものを使う。読めない結果は unreadable', () => {
    expect(readScoutResult(null)).toEqual({ result: null, original: null, edited: false, unreadable: false });
    const chosen: ScoutResult = withLocalChoice(SCOUT_RESULT, DA.draftId);
    const edited = withScoutDraft(chosen, DA.draftId, { subject: '直した件名', body: '直した本文' });
    if (!edited.ok) throw new Error('保存する形を作れませんでした');
    expect(edited.result.drafts.every((d) => d.feedback === null)).toBe(true);
    const r = readScoutResult({ result: chosen, editedResult: edited.result });
    expect(r.edited).toBe(true);
    expect(r.result?.drafts[0]).toMatchObject({ subject: '直した件名', body: '直した本文' });
    expect(r.result?.drafts[0].feedback?.chosen).toBe(true);
    expect(r.result?.drafts[1].subject).toBe(DB.subject);
    expect(readScoutResult({ result: { summary: 1 }, editedResult: null })).toMatchObject({ result: null, unreadable: true });
    const bad = withScoutDraft(SCOUT_RESULT, DA.draftId, { subject: '', body: 'x'.repeat(5001) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['body', 'subject']);
  });

  it('chosenDraft / withLocalChoice / withLocalUsage / scoutThresholdText', () => {
    expect(chosenDraft(SCOUT_RESULT)).toBeNull();
    const c = withLocalChoice(SCOUT_RESULT, DB.draftId);
    expect(chosenDraft(c)?.draftId).toBe(DB.draftId);
    const u = withLocalUsage(c, 'used');
    expect(chosenDraft(u)?.feedback).toMatchObject({ usedState: 'used', usedSource: 'cs' });
    expect(u.drafts[0].feedback?.usedState).toBe('unknown');
    // 選び直すと、利用の記録は未確認に戻る。どれも使わない = 選択なし
    expect(chosenDraft(withLocalChoice(u, DA.draftId))?.feedback?.usedState).toBe('unknown');
    expect(chosenDraft(withLocalChoice(u, null))).toBeNull();
    expect(scoutThresholdText(SCOUT_RESULT.basis)).toBe('返信率 10% 超の文面 412 件');
    expect(scoutThresholdText(SCOUT_REVIEW_RESULT.basis)).toBe('返信率 10% 超の文面が無いため、返信率の高い順に 37 件');
  });
});
