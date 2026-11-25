import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { clearResourceCache } from '../../src/app/lib/useResource';
import JobPage from '../../src/app/features/ai/job/JobPage';
import { emptyJobForm, jobFormFromInput, jobPii, languageOfJob, patchFromPostedJob, readJobResult, toJobInput, validateJob, withJobDraft } from '../../src/app/features/ai/job/jobModel';
import { AI_KIND_LABEL } from '../../src/shared/ai/common';
import { AI_TEXT } from '../../src/shared/ai/options';
import { JobInputSchema, JobResultSchema, type JobResult } from '../../src/shared/ai/job';
import { DEFAULTS, JOB_RESULT, makeJob, mockAiApi, type AiMock } from './aiFixtures';

const ID1 = 'job0000000000001';

const open = (search = '') => {
  window.history.replaceState(null, '', `/ai/job${search}`);
  return render(<JobPage params={{}} />);
};
const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement | HTMLTextAreaElement;
const combo = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement;
const type = (el: Element, value: string) => fireEvent.change(el, { target: { value } });
const runButton = (name = '添削する') => screen.getByRole('button', { name }) as HTMLButtonElement;
const tags = () => Array.from(document.querySelectorAll('.ai-tag > span')).map((x) => x.textContent);
const posts = (m: AiMock) => m.bodies.filter((b) => b.method === 'POST' && /\/ai\/jobs$/.test(b.url));
const sampleCreate = (companyId: string, body: { kind: string; input: unknown }) => ({
  json: { job: makeJob({ id: ID1, kind: 'job', companyId, input: body.input, result: JOB_RESULT, sample: true, title: '求人の添削: 見本' }), fire: 'sample', fireMessage: null },
});
const ready = async () => {
  await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
  await waitFor(() => expect(runButton().disabled).toBe(false));
};

describe('③ 求人の AI 添削（/ai/job）', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('掲載中の求人から選ぶと、ポジション名・職種・勤務地・言語力・年収が入り（直せる）、jobKey で送る', async () => {
    const m = mockAiApi({ config: { sampleMode: true }, create: sampleCreate });
    open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AI_KIND_LABEL.job);
    // 企業を選ぶまで、求人は選べない
    const picker = () => combo('掲載中の求人から選ぶ');
    expect(picker().disabled).toBe(true);
    expect(picker().placeholder).toBe('先に企業を選んでください');
    const company = await screen.findByRole('combobox', { name: '既存企業を選択' });
    await waitFor(() => {
      type(company, 'アクメ');
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('option'));
    expect(window.location.search).toBe('?company=101');
    await ready();
    expect(tags()).toEqual(['ITエンジニア', '営業', 'マーケティング']);
    // 選ばずに実行すると、欄の下に誤り
    fireEvent.click(runButton());
    expect(await screen.findByText('添削する求人を選んでください')).toBeTruthy();
    expect(posts(m)).toHaveLength(0);
    // 掲載求人（閲覧の多い順）を予測変換 + プルダウンで選ぶ
    await waitFor(() => expect(picker().disabled).toBe(false));
    fireEvent.click(within(picker().parentElement!).getByRole('button', { name: '候補を開く' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['バイリンガル法人営業マネージャー営業・東京都・600〜800万円', 'バックエンドエンジニアITエンジニア・大阪府']);
    type(picker(), '法人');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option'));
    expect(screen.getByText('バイリンガル法人営業マネージャー', { selector: '.nm' })).toBeTruthy();
    expect(field('ポジション名').value).toBe('バイリンガル法人営業マネージャー');
    expect(tags()).toEqual(['営業']);
    expect(combo('勤務地').value).toBe('東京都');
    expect(combo('言語力').value).toBe('日本語: ネイティヴ / 英語: ビジネス会話');
    expect(combo('年収').value).toBe('600〜800万円');
    expect(screen.queryByText('添削する求人を選んでください')).toBeNull();
    // 直せる
    type(field('ポジション名'), '法人営業マネージャー');
    type(combo('勤務地'), '東京都（23 区）');
    fireEvent.click(runButton());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    expect(posts(m)[0].url).toBe('/api/companies/101/ai/jobs');
    expect(posts(m)[0].body).toEqual({
      kind: 'job',
      input: {
        purpose: 'review',
        source: 'posted',
        jobKey: 'J-1001',
        title: '',
        description: '',
        requirements: '',
        salary: '600〜800万円',
        industry: 'IT・通信',
        occupations: ['営業'],
        ageRange: '',
        nationality: '',
        language: '日本語: ネイティヴ / 英語: ビジネス会話',
        location: '東京都（23 区）',
        positionName: '法人営業マネージャー',
        note: '',
      },
    });

    // 見本の結果
    const result = screen.getByRole('region', { name: '結果' });
    await within(result).findByText(JOB_RESULT.summary);
    expect(within(result).getByText(AI_TEXT.sample)).toBeTruthy();
    const basis = within(result).getByRole('region', { name: '参考にした母集団' });
    expect(basis.textContent).toContain('18 社');
    expect(basis.textContent).toContain('読んだ求人64 件');
    expect(basis.textContent).toContain('上位の応募率（閲覧 → 応募）4.8%');
    expect(basis.textContent).not.toContain('注意:');
    expect(within(within(result).getByRole('region', { name: '応募率の高い求人に共通する構成・特徴' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(within(result).getByRole('region', { name: '添削の指摘' })).getAllByRole('listitem').map((li) => li.getAttribute('data-severity'))).toEqual(['high', 'mid']);
    const draft = within(result).getByRole('region', { name: '求人票の案' });
    expect(draft.querySelector('[data-part="title"]')?.textContent).toBe(JOB_RESULT.draft.title);
    expect(draft.querySelector('[data-part="description"]')?.textContent).toBe(JOB_RESULT.draft.description);
    expect(draft.querySelector('[data-part="requirements"]')?.textContent).toBe(JOB_RESULT.draft.requirements);
    expect(draft.textContent).toContain(JOB_RESULT.draft.rationale);
    for (const name of ['求人タイトルをコピー', '仕事内容をコピー', '応募条件をコピー', 'すべてコピー']) expect(within(draft).getByRole('button', { name })).toBeTruthy();

    // 企業を変えると、選んだ求人は外れる
    fireEvent.click(screen.getByRole('button', { name: '企業の選択を外す' }));
    expect(screen.queryByText('バイリンガル法人営業マネージャー', { selector: '.nm' })).toBeNull();
    expect(screen.getByText('結果はここに出ます')).toBeTruthy();
  });

  it('文を貼る: 仕事内容が必須。企業名・メールアドレスが入っていると実行できない。「〇〇様」は注意だけ', async () => {
    const m = mockAiApi({ create: sampleCreate });
    open('?company=101');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '文を貼る' }));
    expect(screen.queryByRole('combobox', { name: '掲載中の求人から選ぶ' })).toBeNull();
    expect(screen.getByText(AI_TEXT.piiRule)).toBeTruthy();
    type(field('ポジション名'), '法人営業');
    fireEvent.click(runButton());
    expect(await screen.findByText('添削する求人の仕事内容を入れてください')).toBeTruthy();
    expect(posts(m)).toHaveLength(0);
    type(field('求人タイトル'), '株式会社アクメ商事の法人営業');
    expect(document.querySelector('.ai-pii .notice.error')?.textContent).toContain('求人タイトル: 企業名が入っています');
    expect(runButton().disabled).toBe(true);
    type(field('求人タイトル'), '法人営業（英語を使います）');
    type(field('仕事内容'), '応募は recruit@example.com まで');
    expect(document.querySelector('.ai-pii .notice.error')?.textContent).toContain('仕事内容: メールアドレスが入っています');
    expect(runButton().disabled).toBe(true);
    type(field('仕事内容'), '外資系のお客様への提案営業です。上長は佐藤様です。');
    expect(document.querySelector('.ai-pii .notice.error')).toBeNull();
    expect(document.querySelector('.ai-pii .notice.warn')?.textContent).toContain('仕事内容: 個人名らしい書き方があります');
    expect(runButton().disabled).toBe(false);
    type(field('仕事内容'), '外資系のお客様への提案営業です。');
    type(field('応募条件'), '法人営業の経験 3 年以上');
    fireEvent.click(runButton());
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    const input = (posts(m)[0].body as { kind: string; input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ purpose: 'review', source: 'pasted', jobKey: null, title: '法人営業（英語を使います）', description: '外資系のお客様への提案営業です。', requirements: '法人営業の経験 3 年以上', positionName: '法人営業' });
    expect(JobInputSchema.safeParse(input).success).toBe(true);
  });

  it('求人票の作成: 求人を選ぶ欄は出ず、条件だけで送る', async () => {
    const m = mockAiApi({ create: sampleCreate });
    open('?company=101&purpose=create');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    expect(screen.queryByText('添削したい求人')).toBeNull();
    type(field('ポジション名'), 'データアナリスト');
    type(combo('年収'), '600〜800 万円');
    fireEvent.click(runButton('作成する'));
    await waitFor(() => expect(posts(m)).toHaveLength(1));
    expect((posts(m)[0].body as { input: Record<string, unknown> }).input).toMatchObject({ purpose: 'create', source: 'pasted', jobKey: null, title: '', description: '', positionName: 'データアナリスト', salary: '600〜800 万円' });
  });

  it('履歴から開いて、求人票の案を手直しして保存すると PUT（結果と同じ形）', async () => {
    const input = JobInputSchema.parse({ purpose: 'review', source: 'posted', jobKey: 'J-1002', industry: 'IT・通信', occupations: ['ITエンジニア'], positionName: 'バックエンドエンジニア' });
    const m = mockAiApi({ jobs: [makeJob({ id: ID1, kind: 'job', companyId: '101', title: '求人の添削: バックエンドエンジニア', input, result: JOB_RESULT })] });
    open('?company=101');
    const list = await screen.findByRole('list', { name: 'これまでの結果' });
    fireEvent.click(within(list).getByRole('listitem').querySelector('button.row')!);
    expect(window.location.search).toBe(`?company=101&job=${ID1}`);
    const result = screen.getByRole('region', { name: '結果' });
    await within(result).findByText(JOB_RESULT.summary);
    // そのときの入力（選んだ求人・条件）が欄に入る
    expect(await screen.findByText('バックエンドエンジニア', { selector: '.nm' })).toBeTruthy();
    expect(field('ポジション名').value).toBe('バックエンドエンジニア');
    expect(tags()).toEqual(['ITエンジニア']);
    const draft = within(result).getByRole('region', { name: '求人票の案' });
    fireEvent.click(within(draft).getByRole('button', { name: '手直し' }));
    type(within(draft).getByRole('textbox', { name: '求人タイトル（手直し）' }), '【英語 × 営業】法人営業マネージャー');
    type(within(draft).getByRole('textbox', { name: '応募条件（手直し）' }), '・法人営業の経験 3 年以上');
    fireEvent.click(within(draft).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.bodies.filter((b) => b.method === 'PUT')).toHaveLength(1));
    const put = m.bodies.find((b) => b.method === 'PUT')!;
    expect(put.url).toBe(`/api/ai/jobs/${ID1}/edited`);
    const saved = (put.body as { result: JobResult }).result;
    expect(JobResultSchema.safeParse(saved).success).toBe(true);
    expect(saved).toEqual({ ...JOB_RESULT, draft: { ...JOB_RESULT.draft, title: '【英語 × 営業】法人営業マネージャー', requirements: '・法人営業の経験 3 年以上' } });
    await waitFor(() => expect(draft.querySelector('[data-part="title"]')?.textContent).toBe('【英語 × 営業】法人営業マネージャー'));
    expect(within(draft).getByText(AI_TEXT.edited)).toBeTruthy();
    // やめる = 保存しない
    fireEvent.click(within(draft).getByRole('button', { name: '手直し' }));
    type(within(draft).getByRole('textbox', { name: '仕事内容（手直し）' }), '消します');
    fireEvent.click(within(draft).getByRole('button', { name: 'やめる' }));
    expect(draft.querySelector('[data-part="description"]')?.textContent).toBe(JOB_RESULT.draft.description);
    expect(m.bodies.filter((b) => b.method === 'PUT')).toHaveLength(1);
  });

  it('保存されていない見本の手直しは、画面の中だけで持つ（PUT が 404 でも直した版になる）', async () => {
    const m = mockAiApi({ config: { sampleMode: true }, create: sampleCreate });
    open('?company=101&purpose=create');
    await waitFor(() => expect(combo('業界').value).toBe('IT・通信'));
    type(field('ポジション名'), 'データアナリスト');
    fireEvent.click(runButton('作成する'));
    const draft = await screen.findByRole('region', { name: '求人票の案' });
    fireEvent.click(within(draft).getByRole('button', { name: '手直し' }));
    type(within(draft).getByRole('textbox', { name: '求人タイトル（手直し）' }), '直したタイトル');
    fireEvent.click(within(draft).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(draft.querySelector('[data-part="title"]')?.textContent).toBe('直したタイトル'));
    expect(m.calls).toContain(`PUT /api/ai/jobs/${ID1}/edited`);
    expect(within(draft).getByText(AI_TEXT.edited)).toBeTruthy();
  });
});

describe('jobModel', () => {
  const cond = { ...emptyJobForm().cond, industry: 'IT・通信', occupations: ['営業'], positionName: '営業' };
  it('toJobInput / validateJob: 添削は、選ぶなら jobKey、貼るなら仕事内容が必須。作成はどちらも不要', () => {
    const form = { ...emptyJobForm(), cond };
    expect(validateJob('review', form).errors).toEqual({ jobKey: '添削する求人を選んでください' });
    expect(validateJob('review', { ...form, jobKey: 'J-1' }).ok).toBe(true);
    expect(validateJob('review', { ...form, source: 'pasted' }).errors).toEqual({ description: '添削する求人の仕事内容を入れてください' });
    expect(validateJob('review', { ...form, source: 'pasted', description: '内容' }).ok).toBe(true);
    expect(validateJob('create', form).ok).toBe(true);
    // 使わない欄は送らない
    expect(toJobInput('review', { ...form, source: 'posted', jobKey: 'J-1', title: 'x', description: 'y' })).toMatchObject({ source: 'posted', jobKey: 'J-1', title: '', description: '' });
    expect(toJobInput('review', { ...form, source: 'pasted', jobKey: 'J-1', description: 'y' })).toMatchObject({ source: 'pasted', jobKey: null, description: 'y' });
    expect(toJobInput('create', { ...form, jobKey: 'J-1', description: 'y' })).toMatchObject({ source: 'pasted', jobKey: null, description: '' });
  });
  it('jobPii: 貼った文は「文を貼る」のときだけ見る', () => {
    const form = { ...emptyJobForm(), description: 'a@example.com', cond };
    expect(jobPii('review', form, [])).toEqual([]);
    expect(jobPii('review', { ...form, source: 'pasted' }, [])).toHaveLength(1);
    expect(jobPii('create', { ...form, source: 'pasted' }, [])).toEqual([]);
    expect(jobPii('create', { ...form, cond: { ...cond, positionName: 'アクメ商事の営業' } }, ['株式会社アクメ商事'])[0]).toMatchObject({ level: 'block' });
  });
  it('patchFromPostedJob / languageOfJob: 値のある項目だけ入れる（「未設定」は入れない）', () => {
    const [a, b] = DEFAULTS['101'].jobs;
    expect(patchFromPostedJob(a)).toEqual({ cond: { positionName: a.title, occupations: ['営業'], location: '東京都', language: '日本語: ネイティヴ / 英語: ビジネス会話' }, salary: '600〜800万円' });
    expect(patchFromPostedJob(b)).toEqual({ cond: { positionName: b.title, occupations: ['ITエンジニア'], location: '大阪府', language: '日本語: ビジネス会話' }, salary: undefined });
    expect(languageOfJob({ japaneseLevel: 'なし', englishLevel: null })).toBe('');
    expect(patchFromPostedJob({ ...a, title: 'あ'.repeat(120) }).cond.positionName).toHaveLength(80);
  });
  it('readJobResult / withJobDraft / jobFormFromInput', () => {
    expect(readJobResult({ result: JOB_RESULT, editedResult: null })).toMatchObject({ edited: false, unreadable: false });
    expect(readJobResult({ result: 'x', editedResult: null })).toMatchObject({ result: null, unreadable: true });
    const ng = withJobDraft(JOB_RESULT, { title: '', description: 'a', requirements: 'b' });
    expect(!ng.ok && ng.errors).toEqual({ title: '求人タイトルを入れてください（200 文字まで）' });
    expect(jobFormFromInput(null)).toBeNull();
    const read = jobFormFromInput(JobInputSchema.parse({ purpose: 'create', ...cond }));
    expect(read?.purpose).toBe('create');
    expect(read?.form.source).toBe('posted');
  });
});
