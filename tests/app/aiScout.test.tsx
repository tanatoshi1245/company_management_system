import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { clearResourceCache } from '../../src/app/lib/useResource';
import ScoutPage from '../../src/app/features/ai/scout/ScoutPage';
import { readScoutResult, scoutFormFromInput, scoutPii, toScoutInput, validateScout, withScoutDraft, emptyScoutForm } from '../../src/app/features/ai/scout/scoutModel';
import { AI_KIND_LABEL, type AiJobDetail } from '../../src/shared/ai/common';
import { AI_TEXT } from '../../src/shared/ai/options';
import { ScoutInputSchema, ScoutResultSchema, type ScoutResult } from '../../src/shared/ai/scout';
import { makeJob, mockAiApi, SCOUT_RESULT, type AiMock } from './aiFixtures';

const ID1 = 'scout00000000001';
const ID2 = 'scout00000000002';

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
const runButton = (name = '添削する') => screen.getByRole('button', { name }) as HTMLButtonElement;
const posts = (m: AiMock) => m.bodies.filter((b) => b.method === 'POST' && /\/ai\/jobs$/.test(b.url));
/** 作成の応答（見本）: 入力をそのまま持つジョブを返す。保存はしない */
const sampleCreate = (companyId: string, body: { kind: string; input: unknown }) => ({
  json: { job: makeJob({ id: ID1, kind: 'scout', companyId, input: body.input, result: SCOUT_RESULT, sample: true, title: '添削: 見本' }), fire: 'sample', fireMessage: null },
});

describe('② スカウト文面の AI 添削（/ai/scout）', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('見出しと入力欄が出る。企業を選ぶと業界と掲載職種が入り、URL に企業が入る。直した後は上書きされない', async () => {
    const m = mockAiApi({ config: { sampleMode: true } });
    open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AI_KIND_LABEL.scout);
    expect(await screen.findByText(AI_TEXT.sampleMode)).toBeTruthy();
    expect(screen.getByText(AI_TEXT.historyNoCompany)).toBeTruthy();
    expect(screen.getByText(AI_TEXT.piiRule)).toBeTruthy();
    expect(screen.getByText('結果はここに出ます')).toBeTruthy();
    // 企業を選ぶまでは実行できない
    await waitFor(() => expect(m.calls).toContain('GET /api/ai/config'));
    expect(runButton().disabled).toBe(true);
    await pickCompany('アクメ');
    expect(window.location.search).toBe('?company=101');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    const tags = () => Array.from(document.querySelectorAll('.ai-tag > span')).map((x) => x.textContent);
    expect(tags()).toEqual(['ITエンジニア', '営業', 'マーケティング']);
    expect(runButton().disabled).toBe(false);
    // 直せる（予測変換 + プルダウン）
    type(combo('業界'), '金融');
    fireEvent.click(screen.getByRole('option', { name: '金融・保険' }));
    fireEvent.click(screen.getByRole('button', { name: 'ITエンジニア を外す' }));
    type(combo('掲載職種を足す'), '翻訳');
    fireEvent.click(screen.getByRole('option', { name: '翻訳・通訳' }));
    expect(combo('業界').value).toBe('金融・保険');
    expect(tags()).toEqual(['営業', 'マーケティング', '翻訳・通訳']);
    // 目的を変えても（再描画しても）、直した値のまま
    fireEvent.click(screen.getByRole('button', { name: 'スカウトテンプレートの作成' }));
    expect(window.location.search).toBe('?company=101&purpose=template');
    expect(screen.queryByRole('textbox', { name: '件名' })).toBeNull();
    expect(screen.getByRole('button', { name: '作成する' })).toBeTruthy();
    expect(combo('業界').value).toBe('金融・保険');
    expect(tags()).toEqual(['営業', 'マーケティング', '翻訳・通訳']);
    // 企業を選び直すと入れ直す
    fireEvent.click(screen.getByRole('button', { name: '企業の選択を外す' }));
    expect(window.location.search).toBe('?purpose=template');
    await pickCompany('グローバル', 0);
    await waitFor(() => expect(combo('業界').value).toBe('物流・運輸'));
    expect(tags()).toEqual(['カスタマーサポート']);
  });

  it('添削は件名と本文が必須（欄の下に誤りを出し、送らない）。入れると POST /api/companies/:id/ai/jobs が正しい本文で呼ばれ、見本の結果が描ける', async () => {
    const m = mockAiApi({ config: { sampleMode: true }, create: sampleCreate });
    open('?company=101');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    fireEvent.click(runButton());
    expect(await screen.findByText('添削する件名を入れてください')).toBeTruthy();
    expect(screen.getByText('添削する本文を入れてください')).toBeTruthy();
    expect(screen.getByText('ポジション名を入れてください')).toBeTruthy();
    expect(posts(m)).toHaveLength(0);
    type(field('件名'), '  【ご案内】新しいポジション ');
    type(field('本文'), 'はじめまして。{{企業名}} の採用担当です。\nぜひ一度お話しさせてください。');
    type(field('ポジション名'), '法人営業マネージャー');
    type(combo('年齢層'), '30 代');
    type(combo('国籍'), '問わない');
    type(combo('言語力'), '英語ビジネスレベル以上');
    type(combo('勤務地'), '東京都');
    type(field('補足'), 'カジュアルすぎない文面で');
    expect(screen.queryByText('添削する件名を入れてください')).toBeNull();
    fireEvent.click(runButton());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const sent = posts(m)[0];
    expect(sent.url).toBe('/api/companies/101/ai/jobs');
    expect(sent.body).toEqual({
      kind: 'scout',
      input: {
        purpose: 'review',
        subject: '【ご案内】新しいポジション',
        body: 'はじめまして。{{企業名}} の採用担当です。\nぜひ一度お話しさせてください。',
        industry: 'IT・通信',
        occupations: ['ITエンジニア', '営業', 'マーケティング'],
        ageRange: '30 代',
        nationality: '問わない',
        language: '英語ビジネスレベル以上',
        location: '東京都',
        positionName: '法人営業マネージャー',
        note: 'カジュアルすぎない文面で',
      },
    });
    // 企業は URL のパスだけ（本文に企業 ID・企業名を入れない）
    expect(JSON.stringify(sent.body)).not.toContain('アクメ');
    expect(ScoutInputSchema.safeParse((sent.body as { input: unknown }).input).success).toBe(true);

    // 見本の結果
    const result = await screen.findByRole('region', { name: '結果' });
    await within(result).findByText(SCOUT_RESULT.summary);
    expect(within(result).getByText(AI_TEXT.sample)).toBeTruthy();
    // 見本は URL に入れない（保存されないことがある）
    expect(window.location.search).toBe('?company=101');
    const basis = within(result).getByRole('region', { name: '参考にした母集団' });
    expect(basis.textContent).toContain(SCOUT_RESULT.basis.scope);
    expect(basis.textContent).toContain('42 社');
    expect(basis.textContent).toContain('180 件');
    expect(basis.textContent).toContain('上位の返信率12.4%');
    expect(basis.textContent).toContain('全体の返信率5.1%');
    expect(basis.textContent).toContain(SCOUT_RESULT.basis.caveat);
    const traits = within(result).getByRole('region', { name: '返信率の高い文面に共通する構成・特徴' });
    expect(within(traits).getAllByRole('listitem')).toHaveLength(3);
    // 指摘は重要度の順（重要 → 中 → 軽微）で、色だけでなく文字でも出す
    const review = within(result).getByRole('region', { name: '添削の指摘' });
    const items = within(review).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-severity'))).toEqual(['high', 'mid', 'low']);
    expect(items.map((li) => li.querySelector('.badge')?.textContent)).toEqual(['重要', '中', '軽微']);
    expect(items[0].textContent).toContain('件名から職種が分かりません');
    expect(items[0].textContent).toContain('先頭に職種名と英語の条件を入れます');
    // 案はタブで切り替える
    const drafts = within(result).getByRole('region', { name: '文面の案' });
    expect(within(drafts).getByRole('button', { name: '案 A（経験に触れる）' }).getAttribute('aria-pressed')).toBe('true');
    expect(drafts.querySelector('[data-part="subject"]')?.textContent).toBe(SCOUT_RESULT.drafts[0].subject);
    expect(drafts.querySelector('[data-part="body"]')?.textContent).toBe(SCOUT_RESULT.drafts[0].body);
    expect(drafts.textContent).toContain(SCOUT_RESULT.drafts[0].rationale);
    expect(within(drafts).getByRole('button', { name: '件名をコピー' })).toBeTruthy();
    expect(within(drafts).getByRole('button', { name: '本文をコピー' })).toBeTruthy();
    expect(within(drafts).getByRole('button', { name: 'すべてコピー' })).toBeTruthy();
    fireEvent.click(within(drafts).getByRole('button', { name: '案 B（短く）' }));
    expect(drafts.querySelector('[data-part="subject"]')?.textContent).toBe(SCOUT_RESULT.drafts[1].subject);
    expect(drafts.textContent).toContain(SCOUT_RESULT.drafts[1].rationale);
  });

  it('テンプレートの作成では件名と本文を送らない', async () => {
    const m = mockAiApi({ config: { sampleMode: true }, create: sampleCreate });
    open('?company=101&purpose=template');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    type(field('ポジション名'), 'バックエンドエンジニア');
    fireEvent.click(runButton('作成する'));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const input = (posts(m)[0].body as { kind: string; input: Record<string, unknown> }).input;
    expect(input.purpose).toBe('template');
    expect(input.subject).toBe('');
    expect(input.body).toBe('');
    expect(input.positionName).toBe('バックエンドエンジニア');
  });

  it('メールアドレス・企業名が入っていると実行できない（block）。「〇〇様」は注意だけ（warn）で実行できる', async () => {
    const m = mockAiApi({ create: sampleCreate });
    open('?company=101');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    await waitFor(() => expect(runButton().disabled).toBe(false));
    type(field('件名'), 'ポジションのご案内');
    type(field('ポジション名'), '法人営業');
    type(field('本文'), 'ご連絡は saiyo@example.com までお願いします');
    expect(screen.getByRole('alert').textContent).toContain('本文: メールアドレスが入っています（saiyo@example.com）');
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText('企業名・個人情報を消すと実行できます')).toBeTruthy();
    // 選んだ企業の名前（法人格を外した名前でも）
    type(field('本文'), 'アクメ商事で一緒に働きませんか');
    expect(screen.getByRole('alert').textContent).toContain('本文: 企業名が入っています（アクメ商事）');
    expect(runButton().disabled).toBe(true);
    // 補足・ポジション名も確かめる
    type(field('本文'), 'はじめまして');
    type(field('補足'), '03-1234-5678 に電話');
    expect(screen.getByRole('alert').textContent).toContain('補足: 電話番号が入っています');
    expect(runButton().disabled).toBe(true);
    type(field('補足'), '');
    // 「〇〇様」は注意（黄）。実行はできる
    type(field('本文'), '山田様、はじめまして');
    expect(screen.queryByRole('alert')).toBeNull();
    const warn = document.querySelector('.ai-pii .notice.warn');
    expect(warn?.textContent).toContain('本文: 個人名らしい書き方があります（「〇〇様」）');
    expect(runButton().disabled).toBe(false);
    // 差し込みは対象外
    type(field('本文'), '{{候補者名}} 様、{{企業名}} の採用担当です');
    expect(document.querySelector('.ai-pii .notice')).toBeNull();
    fireEvent.click(runButton());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
  });

  it('閲覧のみの人は実行できない', async () => {
    mockAiApi({ config: { canWrite: false } });
    open('?company=101');
    expect(await screen.findByText(AI_TEXT.readOnly)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText('実行には Google ログインが必要です')).toBeTruthy();
  });

  it('セッションを立ち上げたら「作成中」を出し、URL にジョブが入る。立ち上げに失敗したら理由と「もう一度立ち上げる」', async () => {
    const m = mockAiApi({
      create: (companyId, body, mock) => {
        const job = makeJob({ id: ID1, kind: 'scout', companyId, input: body.input, status: 'queued', completedAt: null, title: '添削: 新しい文面' });
        mock.jobs.set(job.id, job);
        return { json: { job, fire: 'failed', fireMessage: 'セッションを立ち上げる API が 503 を返しました' } };
      },
    });
    open('?company=101');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    type(field('件名'), 'ポジションのご案内');
    type(field('本文'), 'はじめまして');
    type(field('ポジション名'), '法人営業');
    fireEvent.click(runButton());
    expect(await screen.findByText(AI_TEXT.queued)).toBeTruthy();
    expect(screen.getByText('セッションを立ち上げる API が 503 を返しました')).toBeTruthy();
    expect(window.location.search).toBe(`?company=101&job=${ID1}`);
    // 作成の応答をそのまま使う（読み直さない）
    expect(m.calls).not.toContain(`GET /api/ai/jobs/${ID1}`);
    // 履歴に出る
    await waitFor(() => expect(screen.getByRole('list', { name: 'これまでの結果' }).textContent).toContain('添削: 新しい文面'));
    fireEvent.click(screen.getByRole('button', { name: AI_TEXT.refire }));
    expect(await screen.findByText(AI_TEXT.running)).toBeTruthy();
    expect(m.calls).toContain(`POST /api/ai/jobs/${ID1}/fire`);
    expect(screen.queryByText(AI_TEXT.queued)).toBeNull();
  });

  it('履歴から開くと、結果とそのときの入力が出る。案を手直しして保存すると PUT（結果と同じ形）、元に戻すと DELETE', async () => {
    const input = ScoutInputSchema.parse({ purpose: 'template', industry: 'コンサルティング', occupations: ['営業'], positionName: 'アカウントマネージャー', language: '英語ネイティブレベル' });
    const jobs: AiJobDetail[] = [
      makeJob({ id: ID1, kind: 'scout', companyId: '101', title: 'テンプレート: アカウントマネージャー', input, result: SCOUT_RESULT, createdAt: '2026-11-24T02:00:00.000Z' }),
      makeJob({ id: ID2, kind: 'scout', companyId: '101', title: '添削: 失敗したもの', status: 'failed', error: '期限切れ', completedAt: null, createdAt: '2026-11-23T02:00:00.000Z' }),
    ];
    const m = mockAiApi({ jobs });
    open('?company=101');
    const list = await screen.findByRole('list', { name: 'これまでの結果' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(list).getAllByRole('listitem')[0].querySelector('button.row')!);
    expect(window.location.search).toBe(`?company=101&job=${ID1}`);
    const result = screen.getByRole('region', { name: '結果' });
    await within(result).findByText(SCOUT_RESULT.summary);
    expect(m.calls).toContain(`GET /api/ai/jobs/${ID1}`);
    expect(within(result).getByRole('heading', { name: 'テンプレート: アカウントマネージャー' })).toBeTruthy();
    expect(within(result).queryByText(AI_TEXT.sample)).toBeNull();
    // そのときの入力が欄に入る（企業の自動入力で上書きされない）
    await waitFor(() => expect(window.location.search).toBe(`?company=101&job=${ID1}&purpose=template`));
    expect(combo('業界').value).toBe('コンサルティング');
    expect(field('ポジション名').value).toBe('アカウントマネージャー');
    expect(combo('言語力').value).toBe('英語ネイティブレベル');
    expect(Array.from(document.querySelectorAll('.ai-tag > span')).map((x) => x.textContent)).toEqual(['営業']);
    await new Promise((r) => setTimeout(r, 30));
    expect(combo('業界').value).toBe('コンサルティング');

    // 手直し → 保存
    const drafts = within(result).getByRole('region', { name: '文面の案' });
    fireEvent.click(within(drafts).getByRole('button', { name: '手直し' }));
    const subject = within(drafts).getByRole('textbox', { name: '件名（手直し）' }) as HTMLInputElement;
    const body = within(drafts).getByRole('textbox', { name: '本文（手直し）' }) as HTMLTextAreaElement;
    expect(subject.value).toBe(SCOUT_RESULT.drafts[0].subject);
    expect((within(drafts).getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    // 空にすると保存できない（結果と同じ形で確かめる）
    type(subject, '   ');
    fireEvent.click(within(drafts).getByRole('button', { name: '保存' }));
    expect(await within(drafts).findByText('件名を入れてください（200 文字まで）')).toBeTruthy();
    expect(m.bodies.filter((b) => b.method === 'PUT')).toHaveLength(0);
    type(subject, '【直した件名】法人営業マネージャー');
    type(body, '{{候補者名}} 様\n\n直した本文です。');
    fireEvent.click(within(drafts).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.bodies.filter((b) => b.method === 'PUT')).toHaveLength(1));
    const put = m.bodies.find((b) => b.method === 'PUT')!;
    expect(put.url).toBe(`/api/ai/jobs/${ID1}/edited`);
    const saved = (put.body as { result: ScoutResult }).result;
    expect(ScoutResultSchema.safeParse(saved).success).toBe(true);
    expect(saved.drafts[0]).toEqual({ ...SCOUT_RESULT.drafts[0], subject: '【直した件名】法人営業マネージャー', body: '{{候補者名}} 様\n\n直した本文です。' });
    expect(saved.drafts[1]).toEqual(SCOUT_RESULT.drafts[1]);
    expect({ ...saved, drafts: [] }).toEqual({ ...SCOUT_RESULT, drafts: [] });
    // 画面は直した版になり、「直した版あり」と「元の案に戻す」が出る
    await waitFor(() => expect(drafts.querySelector('[data-part="subject"]')?.textContent).toBe('【直した件名】法人営業マネージャー'));
    expect(within(drafts).queryByRole('textbox')).toBeNull();
    expect(within(drafts).getByText(AI_TEXT.edited)).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'これまでの結果' })).getAllByRole('listitem')[0].textContent).toContain(AI_TEXT.edited));
    fireEvent.click(within(drafts).getByRole('button', { name: '元の案に戻す' }));
    await waitFor(() => expect(drafts.querySelector('[data-part="subject"]')?.textContent).toBe(SCOUT_RESULT.drafts[0].subject));
    expect(m.calls).toContain(`DELETE /api/ai/jobs/${ID1}/edited`);
    expect(within(drafts).queryByRole('button', { name: '元の案に戻す' })).toBeNull();

    // 失敗したジョブを開く
    fireEvent.click(within(screen.getByRole('list', { name: 'これまでの結果' })).getAllByRole('listitem')[1].querySelector('button.row')!);
    expect(await within(result).findByText('期限切れ')).toBeTruthy();
    expect(within(result).getByText(AI_TEXT.failed)).toBeTruthy();
    expect(within(result).queryByRole('region', { name: '文面の案' })).toBeNull();

    // 履歴から消す（開いているジョブなら URL からも外す）
    const row = within(screen.getByRole('list', { name: 'これまでの結果' })).getAllByRole('listitem')[1];
    fireEvent.click(within(row).getByRole('button', { name: '添削: 失敗したもの を履歴から消す' }));
    fireEvent.click(within(row).getByRole('button', { name: '消す' }));
    await waitFor(() => expect(m.calls).toContain(`DELETE /api/ai/jobs/${ID2}`));
    await waitFor(() => expect(window.location.search).toBe('?company=101&purpose=template'));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'これまでの結果' })).getAllByRole('listitem')).toHaveLength(1));
  });

  it('URL のジョブを直接開ける（企業が URL に無くても、ジョブの企業になる）', async () => {
    const input = ScoutInputSchema.parse({ purpose: 'review', subject: '件名です', body: '本文です', industry: 'IT・通信', occupations: ['営業'], positionName: '法人営業' });
    mockAiApi({ jobs: [makeJob({ id: ID1, kind: 'scout', companyId: '101', input, result: SCOUT_RESULT, editedResult: { ...SCOUT_RESULT, summary: '直した要約です。' }, edited: true })] });
    open(`?job=${ID1}`);
    expect(await screen.findByText('直した要約です。')).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(`?company=101&job=${ID1}`));
    expect(field('件名').value).toBe('件名です');
    expect(await screen.findByText('株式会社アクメ商事', { selector: '.nm' })).toBeTruthy();
  });

  it('保存に失敗したら、その理由を出す', async () => {
    const m = mockAiApi({ create: () => ({ status: 400, json: { error: '入力に企業名が入っています', code: 'pii', details: [{ path: 'body', message: '企業名が入っています' }] } }) });
    open('?company=101');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    type(field('件名'), 'ポジションのご案内');
    type(field('本文'), 'はじめまして');
    type(field('ポジション名'), '法人営業');
    fireEvent.click(runButton());
    expect(await screen.findByText('入力に企業名が入っています（企業名が入っています）')).toBeTruthy();
    expect(posts(m)).toHaveLength(1);
    expect(screen.getByText('結果はここに出ます')).toBeTruthy();
  });
});

describe('scoutModel', () => {
  it('toScoutInput / validateScout: 添削は件名と本文が必須。テンプレートは不要', () => {
    const form = { ...emptyScoutForm(), subject: '件名', body: '本文', cond: { ...emptyScoutForm().cond, industry: 'IT・通信', occupations: ['営業'], positionName: '営業' } };
    expect(validateScout('review', form).ok).toBe(true);
    expect(validateScout('review', { ...form, subject: ' ' }).errors).toEqual({ subject: '添削する件名を入れてください' });
    expect(validateScout('template', { ...form, subject: '', body: '' }).ok).toBe(true);
    expect(toScoutInput('template', form)).toMatchObject({ purpose: 'template', subject: '', body: '' });
    expect(validateScout('review', { ...form, cond: { ...form.cond, occupations: [] } }).errors).toEqual({ occupations: '職種を 1 つ以上入れてください' });
  });
  it('scoutPii: テンプレートの作成では、件名と本文を見ない', () => {
    const form = { ...emptyScoutForm(), body: 'a@example.com' };
    expect(scoutPii('review', form, [])).toHaveLength(1);
    expect(scoutPii('template', form, [])).toEqual([]);
  });
  it('readScoutResult: 直した版を優先。形が違う結果は読めないと分かる', () => {
    expect(readScoutResult(null)).toEqual({ result: null, original: null, edited: false, unreadable: false });
    const edited = { ...SCOUT_RESULT, summary: '直した' };
    const r = readScoutResult({ result: SCOUT_RESULT, editedResult: edited });
    expect(r.result?.summary).toBe('直した');
    expect(r.original?.summary).toBe(SCOUT_RESULT.summary);
    expect(r.edited).toBe(true);
    expect(readScoutResult({ result: { foo: 1 }, editedResult: null })).toMatchObject({ result: null, unreadable: true });
  });
  it('withScoutDraft / scoutFormFromInput', () => {
    const ok = withScoutDraft(SCOUT_RESULT, 1, { subject: '新しい件名', body: '新しい本文' });
    expect(ok.ok && ok.result.drafts[1].subject).toBe('新しい件名');
    expect(ok.ok && ok.result.drafts[0]).toEqual(SCOUT_RESULT.drafts[0]);
    const ng = withScoutDraft(SCOUT_RESULT, 0, { subject: 'x', body: '' });
    expect(ng.ok).toBe(false);
    expect(!ng.ok && ng.errors).toEqual({ body: '本文を入れてください（5,000 文字まで）' });
    expect(scoutFormFromInput({ foo: 1 })).toBeNull();
  });
});
