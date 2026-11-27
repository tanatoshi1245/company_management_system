import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { clearResourceCache } from '../../src/app/lib/useResource';
import ScoutPage from '../../src/app/features/ai/scout/ScoutPage';
import { chosenDraft, emptyScoutForm, readScoutResult, scoutFormFromInput, scoutPii, scoutThresholdText, toggleFilter, toScoutInput, validateScout, withLocalChoice, withLocalUsage, withScoutDraft } from '../../src/app/features/ai/scout/scoutModel';
import { AI_KIND_LABEL, type AiJobDetail } from '../../src/shared/ai/common';
import { AI_TEXT, SCOUT_TEXT } from '../../src/shared/ai/options';
import { EMPTY_SCOUT_FILTERS, SCOUT_FILTER_MAX, ScoutChoiceInputSchema, ScoutInputSchema, ScoutModelsResponseSchema, ScoutOptionsResponseSchema, ScoutResultSchema, ScoutTuneResponseSchema, ScoutUsageInputSchema, type ScoutResult } from '../../src/shared/ai/scout';
import { makeJob, mockAiApi, SCOUT_INPUT, SCOUT_MODELS, SCOUT_MODELS_VIEWER, SCOUT_OPTIONS, SCOUT_RESULT, SCOUT_REVIEW_RESULT, SCOUT_TUNE, type AiMock } from './aiFixtures';

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
const runButton = (name = '文面を作る') => screen.getByRole('button', { name }) as HTMLButtonElement;
const posts = (m: AiMock) => m.bodies.filter((b) => b.method === 'POST' && /\/ai\/jobs$/.test(b.url));
const puts = (m: AiMock, tail: string) => m.bodies.filter((b) => b.method === 'PUT' && b.url.endsWith(tail));
const ready = () => waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
const card = (label: string) => screen.getByRole('article', { name: label });
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
    expect(ScoutOptionsResponseSchema.safeParse(SCOUT_OPTIONS).success).toBe(true);
    expect(ScoutModelsResponseSchema.safeParse(SCOUT_MODELS).success).toBe(true);
    expect(ScoutModelsResponseSchema.safeParse(SCOUT_MODELS_VIEWER).success).toBe(true);
    expect(ScoutTuneResponseSchema.safeParse(SCOUT_TUNE).success).toBe(true);
  });
});

describe('② スカウト文面の AI 作成（/ai/scout）: 入力', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('見出しと入力欄が出る。企業を選ぶと業界と掲載職種が入り、URL に企業が入る。目的を変えると件名・本文の欄が出る', async () => {
    const m = mockAiApi({ config: { sampleMode: true } });
    open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AI_KIND_LABEL.scout);
    expect(AI_KIND_LABEL.scout).toBe('スカウト文面の AI 作成');
    expect(await screen.findByText(AI_TEXT.sampleMode)).toBeTruthy();
    expect(screen.getByText(AI_TEXT.historyNoCompany)).toBeTruthy();
    expect(screen.getByText('結果はここに出ます')).toBeTruthy();
    expect(screen.getByText(SCOUT_TEXT.filtersLegend)).toBeTruthy();
    await waitFor(() => expect(m.calls).toContain('GET /api/ai/config'));
    // 企業を選ぶまでは実行できない
    expect(runButton().disabled).toBe(true);
    await pickCompany('アクメ');
    expect(window.location.search).toBe('?company=101');
    await ready();
    const tags = () => Array.from(document.querySelectorAll('.ai-tag > span')).map((x) => x.textContent);
    expect(tags()).toEqual(['ITエンジニア', '営業', 'マーケティング']);
    expect(runButton().disabled).toBe(false);
    // 作成では件名・本文の欄は無い。添削にすると出る
    expect(screen.queryByRole('textbox', { name: '件名' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '文面の添削' }));
    expect(window.location.search).toBe('?company=101&purpose=review');
    expect(field('件名')).toBeTruthy();
    expect(screen.getByText(AI_TEXT.piiRule)).toBeTruthy();
    expect(screen.getByRole('button', { name: '添削する' })).toBeTruthy();
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
    open('?company=101');
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
    expect(window.location.search).toBe(`?company=101&job=${ID1}`);
    expect(m.calls).not.toContain(`GET /api/ai/jobs/${ID1}`);
    expect(m.calls.some((c) => c.endsWith('/fire'))).toBe(false);
    const cards = within(result).getAllByRole('article');
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
    open('?company=101&purpose=review');
    await ready();
    type(field('ポジション名'), '法人営業');
    fireEvent.click(runButton('添削する'));
    expect(await screen.findByText('添削する件名を入れてください')).toBeTruthy();
    expect(screen.getByText('添削する本文を入れてください')).toBeTruthy();
    expect(posts(m)).toHaveLength(0);
    type(field('件名'), '  【ご案内】新しいポジション ');
    type(field('本文'), 'はじめまして。{{企業名}} の採用担当です。');
    fireEvent.click(runButton('添削する'));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const input = (posts(m)[0].body as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ purpose: 'review', subject: '【ご案内】新しいポジション', body: 'はじめまして。{{企業名}} の採用担当です。', filters: EMPTY_SCOUT_FILTERS });
    expect(ScoutInputSchema.safeParse(input).success).toBe(true);
    const result = await screen.findByRole('region', { name: '結果' });
    expect((await within(result).findAllByRole('article')).length).toBe(2);
    expect(within(card('モデル A')).getByRole('list', { name: '主な変更点' }).textContent).toContain('件名の先頭に年収と職種を入れました');
    expect(result.textContent).toContain('モデル C は案を作れませんでした');
    expect(result.textContent).toContain('返信率 10% 超の文面が無いため、返信率の高い順に 37 件');
    expect(result.textContent).toContain('全業界');
    expect(result.textContent).toContain('送る相手の条件は指定なし');
  });

  it('メールアドレス・企業名が入っていると実行できない（block）。「〇〇様」は注意だけ（warn）で実行できる', async () => {
    const m = mockAiApi({ create: doneCreate() });
    open('?company=101&purpose=review');
    await ready();
    await waitFor(() => expect(runButton('添削する').disabled).toBe(false));
    type(field('件名'), 'ポジションのご案内');
    type(field('ポジション名'), '法人営業');
    type(field('本文'), 'ご連絡は saiyo@example.com までお願いします');
    expect(screen.getByRole('alert').textContent).toContain('本文: メールアドレスが入っています（saiyo@example.com）');
    expect(runButton('添削する').disabled).toBe(true);
    expect(screen.getByText('企業名・個人情報を消すと実行できます')).toBeTruthy();
    type(field('本文'), 'アクメ商事で一緒に働きませんか');
    expect(screen.getByRole('alert').textContent).toContain('本文: 企業名が入っています（アクメ商事）');
    type(field('本文'), 'はじめまして');
    type(field('補足'), '03-1234-5678 に電話');
    expect(screen.getByRole('alert').textContent).toContain('補足: 電話番号が入っています');
    expect(runButton('添削する').disabled).toBe(true);
    type(field('補足'), '');
    type(field('本文'), '山田様、はじめまして');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.ai-pii .notice.warn')?.textContent).toContain('本文: 個人名らしい書き方があります（「〇〇様」）');
    expect(runButton('添削する').disabled).toBe(false);
    fireEvent.click(runButton('添削する'));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
  });

  it('閲覧のみの人は実行できない。分析用のデータが無いときは、その知らせを出す', async () => {
    mockAiApi({ config: { canWrite: false }, scoutOptions: { ageGroups: [], nationalities: [], japaneseLevels: [], englishLevels: [], residences: [], occupations: [], dataDate: null } });
    open('?company=101');
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
    open('?company=101');
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
    expect(window.location.search).toBe(`?company=101&job=${ID2}`);
    fireEvent.click(screen.getByRole('button', { name: AI_TEXT.retry }));
    await screen.findByText(SCOUT_RESULT.summary);
    expect(posts(m)).toHaveLength(2);
    expect(posts(m)[1].url).toBe('/api/companies/101/ai/jobs');
    expect(posts(m)[1].body).toEqual(posts(m)[0].body);
    expect(m.calls.some((c) => c.endsWith('/fire'))).toBe(false);
    expect(window.location.search).toBe(`?company=101&job=${ID1}`);
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
    open('?company=101');
    await ready();
    type(field('ポジション名'), '法人営業マネージャー');
    fireEvent.click(runButton());
    await screen.findByText(SCOUT_RESULT.summary);
    expect(screen.getByText(AI_TEXT.sample)).toBeTruthy();
    // 見本は URL に入れない
    expect(window.location.search).toBe('?company=101');
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
    expect(window.location.search).toBe(`?company=101&job=${ID2}`);
    expect(screen.getByRole('button', { name: AI_TEXT.retry })).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: /^作成: 法人営業マネージャー完了/ }));
    await screen.findByText(SCOUT_RESULT.summary);
    fireEvent.click(within(list).getByRole('button', { name: '作成: 法人営業マネージャー を履歴から消す' }));
    fireEvent.click(within(list).getByRole('button', { name: '消す' }));
    await waitFor(() => expect(m.calls).toContain(`DELETE /api/ai/jobs/${ID1}`));
    await waitFor(() => expect(window.location.search).toBe('?company=101'));
  });
});

describe('② スカウト文面の AI 作成: モデルの成績', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('タブ「モデルの成績」（URL の tab）: 3 つのモデルの説明・いまの版・成績・版の履歴。管理者でない人には、ボタンとプレイブックを出さない', async () => {
    const m = mockAiApi();
    open('?company=101');
    await ready();
    expect(m.calls).not.toContain('GET /api/ai/scout/models');
    fireEvent.click(screen.getByRole('button', { name: 'モデルの成績' }));
    expect(window.location.search).toBe('?company=101&tab=models');
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
    expect(back).toEqual({ purpose: 'review', form });
    expect(scoutFormFromInput({ foo: 1 })).toBeNull();
    expect(scoutFormFromInput(SCOUT_INPUT)?.form.filters.ageGroups).toEqual(['30代']);
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
