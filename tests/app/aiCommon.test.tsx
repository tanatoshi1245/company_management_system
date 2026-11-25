import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { clearResourceCache } from '../../src/app/lib/useResource';
import { Combobox } from '../../src/app/features/ai/common/Combobox';
import { TagCombobox } from '../../src/app/features/ai/common/TagCombobox';
import { CompanyCombobox } from '../../src/app/features/ai/common/CompanyCombobox';
import { AiPageHeader } from '../../src/app/features/ai/common/AiPageHeader';
import { AiJobStatus, elapsedLabel } from '../../src/app/features/ai/common/AiJobStatus';
import { AiHistory } from '../../src/app/features/ai/common/AiHistory';
import { PiiNotice } from '../../src/app/features/ai/common/PiiNotice';
import { CopyButton } from '../../src/app/features/ai/common/CopyButton';
import { TargetConditionFields } from '../../src/app/features/ai/common/TargetConditionFields';
import { useCompanyAutofill } from '../../src/app/features/ai/common/useCompanyAutofill';
import { fieldErrors, piiByField } from '../../src/app/features/ai/common/formModel';
import { AI_COMBOBOX_LIMIT, AI_TEXT, emptyTargetCondition, type TargetCondition } from '../../src/shared/ai/options';
import { AI_KIND_LABEL } from '../../src/shared/ai/common';
import { ScoutInputSchema } from '../../src/shared/ai/scout';
import { COMPANIES, DEFAULTS, makeJob, mockAiApi } from './aiFixtures';

const FRUITS = ['りんご', 'みかん', 'ぶどう', 'Apple', 'Ｂａｎａｎａ'];

function Harness({ allowFree, options = FRUITS, initial = '' }: { allowFree?: boolean; options?: string[]; initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <div>
      <Combobox value={v} onChange={setV} options={options} allowFree={allowFree} ariaLabel="果物" />
      <output data-testid="value">{v}</output>
    </div>
  );
}
const input = () => screen.getByRole('combobox', { name: '果物' }) as HTMLInputElement;
const optionTexts = () => screen.queryAllByRole('option').map((o) => o.textContent);
const value = () => screen.getByTestId('value').textContent;

describe('Combobox（テキストの予測変換 + プルダウン）', () => {
  afterEach(() => cleanup());

  it('WAI-ARIA の combobox。入力で絞り込み、クリックで選ぶ', () => {
    render(<Harness />);
    const el = input();
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.getAttribute('aria-autocomplete')).toBe('list');
    const listId = el.getAttribute('aria-controls')!;
    expect(document.getElementById(listId)?.getAttribute('role')).toBe('listbox');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.change(el, { target: { value: 'ん' } });
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(optionTexts()).toEqual(['りんご', 'みかん']);
    fireEvent.click(screen.getByRole('option', { name: 'みかん' }));
    expect(value()).toBe('みかん');
    expect(el.getAttribute('aria-expanded')).toBe('false');
  });

  it('全角・半角、大文字・小文字の違いを無視して絞り込む', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'ａｐｐ' } });
    expect(optionTexts()).toEqual(['Apple']);
    fireEvent.change(input(), { target: { value: 'banana' } });
    expect(optionTexts()).toEqual(['Ｂａｎａｎａ']);
  });

  it('↑↓ で移動（aria-activedescendant）、Enter で選択、Esc で閉じる', () => {
    render(<Harness />);
    const el = input();
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(optionTexts()).toEqual(FRUITS);
    const first = screen.getAllByRole('option')[0];
    expect(el.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(el.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2].id);
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(el.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(value()).toBe('みかん');
    expect(el.getAttribute('aria-expanded')).toBe('false');
    // ↑ は末尾へ回る
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'ArrowUp' });
    expect(el.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[FRUITS.length - 1].id);
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(value()).toBe('みかん');
  });

  it('▼ ボタンで全件（入力があっても絞り込まない）', () => {
    render(<Harness initial="みかん" />);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '候補を開く' }));
    expect(optionTexts()).toEqual(FRUITS);
    fireEvent.click(screen.getByRole('button', { name: '候補を閉じる' }));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('自由入力（既定）: 一覧に無い文字もそのまま入る', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'ドラゴンフルーツ' } });
    expect(value()).toBe('ドラゴンフルーツ');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    fireEvent.blur(input());
    expect(value()).toBe('ドラゴンフルーツ');
  });

  it('allowFree = false: 候補を選んだときだけ値になる。選ばずに離れると元に戻る', () => {
    render(<Harness allowFree={false} />);
    const el = input();
    fireEvent.change(el, { target: { value: 'ドラゴン' } });
    expect(value()).toBe('');
    expect(screen.getByText(AI_TEXT.noOptions)).toBeTruthy();
    fireEvent.blur(el);
    expect(el.value).toBe('');
    fireEvent.change(el, { target: { value: 'ぶど' } });
    expect(value()).toBe('');
    // 候補が 1 つに絞れていれば Enter で選ぶ
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(value()).toBe('ぶどう');
    expect(el.value).toBe('ぶどう');
    fireEvent.change(el, { target: { value: 'ぶどうx' } });
    fireEvent.blur(el);
    expect(el.value).toBe('ぶどう');
    fireEvent.change(el, { target: { value: '' } });
    expect(value()).toBe('');
  });

  it(`候補は ${AI_COMBOBOX_LIMIT} 件まで出し、「さらに絞り込んでください」を添える`, () => {
    const many = Array.from({ length: 400 }, (_, i) => `企業 ${String(i + 1).padStart(3, '0')}`);
    render(<Harness options={many} />);
    fireEvent.click(screen.getByRole('button', { name: '候補を開く' }));
    expect(screen.getAllByRole('option')).toHaveLength(AI_COMBOBOX_LIMIT);
    expect(screen.getByText(new RegExp(`${AI_TEXT.moreOptions}（400 件中 ${AI_COMBOBOX_LIMIT} 件を表示）`))).toBeTruthy();
    fireEvent.change(input(), { target: { value: '企業 39' } });
    expect(screen.getAllByRole('option')).toHaveLength(10);
    expect(screen.queryByText(new RegExp(AI_TEXT.moreOptions))).toBeNull();
  });

  it('変換の確定の Enter（isComposing）では選ばない', () => {
    render(<Harness />);
    const el = input();
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'Enter', isComposing: true });
    expect(value()).toBe('');
  });
});

describe('TagCombobox（複数）', () => {
  afterEach(() => cleanup());
  function Tags({ max = 3 }: { max?: number }) {
    const [v, setV] = useState<string[]>(['営業']);
    return (
      <div>
        <TagCombobox values={v} onChange={setV} options={['営業', 'ITエンジニア', 'マーケティング']} max={max} ariaLabel="掲載職種" />
        <output data-testid="value">{v.join('|')}</output>
      </div>
    );
  }
  it('チップで表示・× で外す・候補から足す・自由入力も足せる・上限まで', () => {
    render(<Tags />);
    const el = screen.getByRole('combobox', { name: '掲載職種を足す' }) as HTMLInputElement;
    // 選んだものは候補から外れる
    fireEvent.click(screen.getByRole('button', { name: '候補を開く' }));
    expect(optionTexts()).toEqual(['ITエンジニア', 'マーケティング']);
    fireEvent.click(screen.getByRole('option', { name: 'ITエンジニア' }));
    expect(value()).toBe('営業|ITエンジニア');
    expect(el.value).toBe('');
    fireEvent.change(el, { target: { value: '通訳' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(value()).toBe('営業|ITエンジニア|通訳');
    // 上限（3 個）で入力できなくなる
    expect(el.disabled).toBe(true);
    expect(el.placeholder).toBe('3 個まで');
    fireEvent.click(screen.getByRole('button', { name: '営業 を外す' }));
    expect(value()).toBe('ITエンジニア|通訳');
    expect(el.disabled).toBe(false);
    // 同じものは足さない。欄の外へ出たときも足す
    fireEvent.change(el, { target: { value: '通訳' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(value()).toBe('ITエンジニア|通訳');
    fireEvent.change(el, { target: { value: '人事' } });
    fireEvent.blur(el);
    expect(value()).toBe('ITエンジニア|通訳|人事');
  });
  it('空の欄で Backspace を押すと、最後の 1 つを外す', () => {
    render(<Tags />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: '掲載職種を足す' }), { key: 'Backspace' });
    expect(value()).toBe('');
  });
});

describe('CompanyCombobox（既存企業の選択）', () => {
  afterEach(() => cleanup());
  function Pick() {
    const [v, setV] = useState<string | null>(null);
    return (
      <div>
        <CompanyCombobox companies={COMPANIES} value={v} onChange={setV} />
        <output data-testid="value">{v ?? ''}</output>
      </div>
    );
  }
  it('一覧にある企業だけ選べる。同名は業界・種別で見分ける。× で外せる', () => {
    render(<Pick />);
    const el = screen.getByRole('combobox', { name: '既存企業を選択' }) as HTMLInputElement;
    fireEvent.change(el, { target: { value: '一覧に無い会社' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(AI_TEXT.noOptions)).toBeTruthy();
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.blur(el);
    expect(value()).toBe('');
    expect(el.value).toBe('');
    fireEvent.change(el, { target: { value: 'グローバル' } });
    const opts = screen.getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(['グローバル物流株式会社物流・運輸・直接', 'グローバル物流株式会社人材サービス・紹介']);
    fireEvent.click(opts[1]);
    expect(value()).toBe('103');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('グローバル物流株式会社')).toBeTruthy();
    expect(screen.getByText('人材サービス・紹介')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '企業の選択を外す' }));
    expect(value()).toBe('');
    expect(screen.getByRole('combobox', { name: '既存企業を選択' })).toBeTruthy();
  });
});

describe('AiPageHeader・AiJobStatus・PiiNotice・CopyButton', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const cfg = { fireConfigured: true, storeConfigured: true, sampleMode: false, canWrite: true, admin: false };

  it('見出しと、見本モード / 閲覧のみ / 設定なし の知らせ', () => {
    const { rerender } = render(<AiPageHeader kind="scout" config={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AI_KIND_LABEL.scout);
    expect(screen.queryByText(AI_TEXT.sampleMode)).toBeNull();
    rerender(<AiPageHeader kind="job" config={cfg} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AI_KIND_LABEL.job);
    expect(document.querySelectorAll('.notice')).toHaveLength(0);
    rerender(<AiPageHeader kind="job" config={{ ...cfg, sampleMode: true, fireConfigured: false, canWrite: false }} />);
    expect(screen.getByText(AI_TEXT.sampleMode)).toBeTruthy();
    // サンプルデータ中は、仮の利用者でも見本を実行できるので「閲覧のみ」は出さない
    expect(screen.queryByText(AI_TEXT.readOnly)).toBeNull();
    expect(screen.queryByText(AI_TEXT.fireMissing)).toBeNull();
    rerender(<AiPageHeader kind="job" config={{ ...cfg, canWrite: false }} />);
    expect(screen.getByText(AI_TEXT.readOnly)).toBeTruthy();
    rerender(<AiPageHeader kind="job" config={{ ...cfg, fireConfigured: false }} />);
    expect(screen.getByText(AI_TEXT.fireMissing)).toBeTruthy();
  });

  it('running = 作成中の文と経過時間、queued / failed = 理由と「もう一度立ち上げる」、done の見本 = 印、セッションの URL = リンク', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T01:03:12.000Z'));
    const onRefire = vi.fn();
    const base = makeJob({ id: 'a'.repeat(16), kind: 'scout', companyId: '101' });
    const { rerender } = render(<AiJobStatus job={null} polling={false} />);
    expect(document.querySelector('.ai-status')).toBeNull();
    rerender(<AiJobStatus job={{ ...base, status: 'running', completedAt: null, sessionUrl: 'https://claude.ai/code/session_x' }} polling />);
    expect(screen.getByText(AI_TEXT.running)).toBeTruthy();
    expect(screen.getByText('経過 3 分 12 秒')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByText('経過 3 分 15 秒')).toBeTruthy();
    expect((screen.getByRole('link', { name: AI_TEXT.openSession }) as HTMLAnchorElement).href).toBe('https://claude.ai/code/session_x');
    expect(screen.queryByRole('button', { name: AI_TEXT.refire })).toBeNull();
    rerender(<AiJobStatus job={{ ...base, status: 'queued', completedAt: null }} polling={false} fireMessage="発火の設定がありません" onRefire={onRefire} />);
    expect(screen.getByText(AI_TEXT.queued)).toBeTruthy();
    expect(screen.getByText('発火の設定がありません')).toBeTruthy();
    expect(screen.queryByRole('link', { name: AI_TEXT.openSession })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: AI_TEXT.refire }));
    expect(onRefire).toHaveBeenCalledTimes(1);
    rerender(<AiJobStatus job={{ ...base, status: 'failed', error: '期限切れ（60 分以内に結果が返りませんでした）' }} polling={false} onRefire={onRefire} />);
    expect(screen.getByText('期限切れ（60 分以内に結果が返りませんでした）')).toBeTruthy();
    expect(screen.getByRole('button', { name: AI_TEXT.refire })).toBeTruthy();
    rerender(<AiJobStatus job={{ ...base, sample: true }} polling={false} />);
    expect(screen.getByText(AI_TEXT.sample)).toBeTruthy();
    rerender(<AiJobStatus job={base} polling={false} />);
    expect(screen.queryByText(AI_TEXT.sample)).toBeNull();
    expect(elapsedLabel('2026-11-25T01:03:00.000Z', Date.parse('2026-11-25T01:03:12.000Z'))).toBe('12 秒');
    expect(elapsedLabel('x', 0)).toBeNull();
  });

  it('PiiNotice: block は赤（alert）、warn は黄。空なら何も出さない', () => {
    const { rerender, container } = render(<PiiNotice findings={[]} />);
    expect(container.innerHTML).toBe('');
    rerender(
      <PiiNotice
        findings={[
          { level: 'warn', message: '個人名らしい書き方があります' },
          { level: 'block', message: 'メールアドレスが入っています（a@example.com）' },
        ]}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('error');
    expect(alert.textContent).toContain('メールアドレスが入っています');
    const warn = screen.getByRole('status');
    expect(warn.className).toContain('warn');
    expect(warn.textContent).toContain('個人名らしい書き方があります');
  });

  it('CopyButton: クリップボードへ写し、「コピーしました」を 2 秒出す', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyButton text="本文です" label="本文をコピー" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '本文をコピー' }));
    });
    expect(writeText).toHaveBeenCalledWith('本文です');
    expect(screen.getByRole('button').textContent).toContain(AI_TEXT.copied);
    act(() => void vi.advanceTimersByTime(1900));
    expect(screen.getByRole('button').textContent).toContain(AI_TEXT.copied);
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole('button').textContent).toContain('本文をコピー');
  });
});

describe('AiHistory（履歴）', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  it('企業を選ぶ前は案内だけ。選ぶと新しい順に、日時（JST）・見出し・状態・作成した人・「直した版あり」が出る。押すと開く・消せる', async () => {
    const jobs = [
      makeJob({ id: 'a'.repeat(16), kind: 'scout', companyId: '101', title: '添削: 古い文面', createdAt: '2026-11-20T00:30:00.000Z', createdBy: 'tanaka@daijob.com', edited: true }),
      makeJob({ id: 'b'.repeat(16), kind: 'scout', companyId: '101', title: 'テンプレート: 営業', createdAt: '2026-11-24T03:00:00.000Z', status: 'running', completedAt: null }),
      makeJob({ id: 'c'.repeat(16), kind: 'job', companyId: '101', title: '求人の添削（別の機能）' }),
      makeJob({ id: 'd'.repeat(16), kind: 'scout', companyId: '102', title: '別の企業' }),
    ];
    const m = mockAiApi({ jobs });
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const { rerender } = render(<AiHistory companyId={null} kind="scout" activeId={null} onSelect={onSelect} />);
    expect(screen.getByText(AI_TEXT.historyNoCompany)).toBeTruthy();
    expect(m.calls).toEqual([]);
    rerender(<AiHistory companyId="101" kind="scout" activeId={'a'.repeat(16)} onSelect={onSelect} onDelete={onDelete} />);
    const list = await screen.findByRole('list', { name: 'これまでの結果' });
    expect(m.calls).toEqual(['GET /api/ai/jobs?company=101&kind=scout']);
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.ttl')?.textContent)).toEqual(['テンプレート: 営業', '添削: 古い文面']);
    expect(rows[0].textContent).toContain('作成中');
    expect(rows[0].textContent).toContain('2026-11-24 12:00');
    expect(rows[1].textContent).toContain('完了');
    expect(rows[1].textContent).toContain(AI_TEXT.edited);
    expect(rows[1].textContent).toContain('tanaka');
    expect(rows[1].className).toContain('active');
    expect(rows[0].textContent).not.toContain(AI_TEXT.edited);
    fireEvent.click(rows[0].querySelector('button.row')!);
    expect(onSelect).toHaveBeenCalledWith('b'.repeat(16));
    // 消すのは 2 回押してから
    fireEvent.click(within(rows[1]).getByRole('button', { name: '添削: 古い文面 を履歴から消す' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(rows[1]).getByRole('button', { name: '消す' }));
    expect(onDelete).toHaveBeenCalledWith('a'.repeat(16));
  });

  it('結果が無い企業は、その旨を出す', async () => {
    mockAiApi();
    render(<AiHistory companyId="104" kind="job" activeId={null} onSelect={() => undefined} />);
    expect(await screen.findByText(AI_TEXT.historyEmpty)).toBeTruthy();
  });
});

describe('TargetConditionFields・useCompanyAutofill', () => {
  beforeEach(() => clearResourceCache());
  afterEach(() => cleanup());

  function Form({ initialCompany = null as string | null }) {
    const [companyId, setCompanyId] = useState<string | null>(initialCompany);
    const [cond, setCond] = useState<TargetCondition>(emptyTargetCondition);
    const autofill = useCompanyAutofill(companyId, (patch) => setCond((c) => ({ ...c, ...patch })));
    return (
      <div>
        {COMPANIES.map((c) => (
          <button key={c.id} type="button" onClick={() => setCompanyId(c.id)}>
            企業 {c.id}
          </button>
        ))}
        <button type="button" onClick={() => setCompanyId(null)}>
          外す
        </button>
        <TargetConditionFields
          value={cond}
          onChange={(patch) => {
            if ('industry' in patch) autofill.markEdited('industry');
            if ('occupations' in patch) autofill.markEdited('occupations');
            setCond((c) => ({ ...c, ...patch }));
          }}
          defaults={autofill.defaults}
          errors={{ positionName: 'ポジション名を入れてください' }}
        />
        <output data-testid="cond">{JSON.stringify(cond)}</output>
      </div>
    );
  }
  const cond = () => JSON.parse(screen.getByTestId('cond').textContent ?? '{}') as TargetCondition;
  const industry = () => screen.getByRole('combobox', { name: '業界' }) as HTMLInputElement;

  it('企業を選ぶと、業界と掲載職種（上位 3 つ）が入る。候補は defaults の一覧。誤りは欄の下に出る', async () => {
    mockAiApi();
    render(<Form />);
    expect(cond().industry).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '企業 101' }));
    await waitFor(() => expect(cond().industry).toBe('IT・通信'));
    expect(cond().occupations).toEqual(['ITエンジニア', '営業', 'マーケティング']);
    expect(industry().value).toBe('IT・通信');
    fireEvent.change(industry(), { target: { value: '金融' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['金融・保険']);
    expect(screen.getByRole('alert').textContent).toBe('ポジション名を入れてください');
    // 年齢層・国籍・言語力・勤務地は、よくある値から選べて、自由入力もできる
    const age = screen.getByRole('combobox', { name: '年齢層' });
    fireEvent.change(age, { target: { value: '30' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('20 代後半〜30 代前半');
    fireEvent.change(age, { target: { value: '35 歳前後' } });
    expect(cond().ageRange).toBe('35 歳前後');
    fireEvent.change(screen.getByRole('combobox', { name: '勤務地' }), { target: { value: '大阪' } });
    fireEvent.click(screen.getByRole('option', { name: '大阪府' }));
    expect(cond().location).toBe('大阪府');
  });

  it('入力者が直した項目は、同じ企業の間は上書きしない。企業を選び直すと入れ直す', async () => {
    const m = mockAiApi();
    render(<Form initialCompany="101" />);
    await waitFor(() => expect(cond().industry).toBe('IT・通信'));
    fireEvent.change(industry(), { target: { value: 'ソフトウェア' } });
    fireEvent.click(screen.getByRole('button', { name: 'ITエンジニア を外す' }));
    expect(cond().industry).toBe('ソフトウェア');
    expect(cond().occupations).toEqual(['営業', 'マーケティング']);
    // 同じ企業のまま再描画・再取得しても、直した値のまま
    fireEvent.click(screen.getByRole('button', { name: '企業 101' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(cond().industry).toBe('ソフトウェア');
    expect(cond().occupations).toEqual(['営業', 'マーケティング']);
    // 別の企業にすると入れ直す
    fireEvent.click(screen.getByRole('button', { name: '企業 102' }));
    await waitFor(() => expect(cond().industry).toBe('物流・運輸'));
    expect(cond().occupations).toEqual(['カスタマーサポート']);
    // 外して同じ企業を選び直しても入れ直す
    fireEvent.change(industry(), { target: { value: '倉庫' } });
    fireEvent.click(screen.getByRole('button', { name: '外す' }));
    fireEvent.click(screen.getByRole('button', { name: '企業 102' }));
    await waitFor(() => expect(cond().industry).toBe('物流・運輸'));
    expect(m.calls.filter((c) => c.includes('/defaults'))).toEqual(['GET /api/ai/companies/101/defaults', 'GET /api/ai/companies/102/defaults']);
  });

  it('業界・職種の無い企業へ選び直すと、前の企業から自動で入れた値は消す（入力者が入れた値は残す）', async () => {
    mockAiApi();
    render(<Form initialCompany="101" />);
    await waitFor(() => expect(cond().industry).toBe('IT・通信'));
    fireEvent.click(screen.getByRole('button', { name: '企業 104' }));
    await waitFor(() => expect(cond().industry).toBe(''));
    expect(cond().occupations).toEqual([]);
    fireEvent.change(industry(), { target: { value: '商社' } });
    fireEvent.click(screen.getByRole('button', { name: '外す' }));
    fireEvent.click(screen.getByRole('button', { name: '企業 104' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(cond().industry).toBe('商社');
    expect(DEFAULTS['104'].industry).toBeNull();
  });
});

describe('formModel', () => {
  it('fieldErrors: zod の誤りを項目ごとの最初の文にする（上限は日本語で）', () => {
    const r = ScoutInputSchema.safeParse({ purpose: 'review', subject: '', body: '', industry: '', occupations: ['a', 'b', 'c', 'd', 'e', 'f'], positionName: 'x'.repeat(81) });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrors(r.error)).toEqual({ industry: '業界を入れてください', occupations: '5 個までです', positionName: '80 文字までです', subject: '添削する件名を入れてください', body: '添削する本文を入れてください' });
  });
  it('piiByField: どの欄かを頭に付け、block を先に並べる', () => {
    const f = piiByField(
      [
        { label: '件名', text: '山田様へ' },
        { label: '本文', text: 'アクメ商事です。a@example.com' },
        { label: '補足', text: '' },
      ],
      ['株式会社アクメ商事'],
    );
    expect(f.map((x) => `${x.level}|${x.message.split('（')[0]}`)).toEqual(['block|本文: メールアドレスが入っています', 'block|本文: 企業名が入っています', 'warn|件名: 個人名らしい書き方があります']);
  });
});
