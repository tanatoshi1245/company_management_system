import { z } from 'zod';
import type { AiStatus } from './common';
import { TargetConditionShape } from './scout';

/**
 * AI 機能の画面で使う選択肢（プルダウン + 予測変換の候補）と、②③ 共通の条件の型・画面の文言。
 * 候補は「よくある値」で、一覧に無い文字もそのまま入れられる（業界・職種の候補は API の defaults から来る）。
 */

const TargetConditionSchema = z.object(TargetConditionShape);
/** ②③ 共通の条件（業界・掲載職種・年齢層・国籍・言語力・勤務地・ポジション名・補足） */
export type TargetCondition = z.infer<typeof TargetConditionSchema>;
export type TargetConditionKey = keyof TargetCondition;

export const emptyTargetCondition = (): TargetCondition => ({ industry: '', occupations: [], ageRange: '', nationality: '', language: '', location: '', positionName: '', note: '' });

/** 企業を選んだときに自動で入れる掲載職種の数（多い順の上位） */
export const AI_AUTOFILL_OCCUPATIONS = 3;
/** プルダウンに 1 度に出す候補の数（これより多いときは、絞り込みを促す） */
export const AI_COMBOBOX_LIMIT = 50;

export const AI_AGE_RANGE_OPTIONS: string[] = ['20 代', '20 代後半〜30 代前半', '30 代', '30 代後半〜40 代前半', '40 代', '50 代以上', '問わない'];
export const AI_NATIONALITY_OPTIONS: string[] = ['日本国籍', '外国籍', '問わない'];
export const AI_LANGUAGE_OPTIONS: string[] = [
  '英語ビジネスレベル以上',
  '英語ネイティブレベル',
  '日本語ビジネスレベル以上',
  '日本語ネイティブレベル',
  '英語・日本語ともビジネスレベル以上',
  '日本語ネイティブレベル・英語ビジネスレベル以上',
  '英語ネイティブレベル・日本語ビジネスレベル以上',
  '問わない',
];
const PREFECTURES = [
  '東京都', '神奈川県', '大阪府', '愛知県', '埼玉県', '千葉県', '福岡県', '兵庫県', '京都府', '北海道',
  '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '新潟県',
  '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '三重県', '滋賀県', '奈良県',
  '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];
/** 勤務地（よく使う順に主要な都府県 → そのほかの道県 → リモート・海外） */
export const AI_LOCATION_OPTIONS: string[] = ['東京都（23 区）', ...PREFECTURES, 'フルリモート', '一部リモート', '海外'];
export const AI_SALARY_OPTIONS: string[] = ['〜400 万円', '400〜600 万円', '600〜800 万円', '800〜1000 万円', '1000 万円〜', '応相談'];

export const AI_CONDITION_LABEL: Record<TargetConditionKey, string> = {
  industry: '業界',
  occupations: '掲載職種',
  ageRange: '年齢層',
  nationality: '国籍',
  language: '言語力',
  location: '勤務地',
  positionName: 'ポジション名',
  note: '補足',
};

export const AI_STATUS_LABEL: Record<AiStatus, string> = { queued: '未起動', running: '作成中', done: '完了', failed: '失敗' };

/** 画面の文言（3 機能で共通） */
export const AI_TEXT = {
  sampleMode: 'サンプルデータのため、セッションは立ち上げず見本を表示します',
  readOnly: '閲覧のみ（Google ログインが必要）',
  fireMissing: 'セッションを立ち上げる設定がまだありません（docs/AI機能.md）',
  storeMissing: '結果の保存先がまだありません（docs/AI機能.md）',
  running: 'Claude Code のセッションで作成中です（数分かかります。このページを開いたままお待ちください。離れても、履歴から開けます）',
  queued: 'セッションを立ち上げられませんでした',
  failed: '作成に失敗しました',
  refire: 'もう一度立ち上げる',
  sample: 'サンプル（見本）',
  openSession: 'セッションを開く',
  historyNoCompany: '企業を選ぶと、これまでの結果が出ます',
  historyEmpty: 'この企業の結果は、まだありません',
  edited: '直した版あり',
  moreOptions: 'さらに絞り込んでください',
  noOptions: '一致する候補がありません',
  companyPlaceholder: '企業名を入力して選ぶ',
  companyOnlyBoard: 'ダッシュボードに表示されている企業だけ選べます',
  piiRule: '企業名・氏名・メールアドレス・電話番号を書かないでください。差し込みは {{企業名}} {{候補者名}} のように書きます',
  copied: 'コピーしました',
  copyFailed: 'コピーできませんでした',
} as const;

export const AI_KIND_DESCRIPTION = {
  report: '企業ページで見ている期間・企業の利用状況を分析し、企業への提案までをスライドにまとめます',
  scout: '同じ業界で返信率の高い企業のスカウト文面の構成・特徴をふまえて、文面を添削する / テンプレートを作ります',
  job: '同じ業界・職種で「閲覧 → 応募」の率が高い求人の構成・特徴をふまえて、求人を添削する / 求人票を作ります',
} as const;

export const AI_SEVERITY_LABEL = { high: '重要', mid: '中', low: '軽微' } as const;
