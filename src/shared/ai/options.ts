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

export const AI_STATUS_LABEL: Record<AiStatus, string> = { queued: '未作成', running: '作成中', done: '完了', failed: '失敗' };

/** 画面の文言（3 機能で共通） */
export const AI_TEXT = {
  sampleMode: 'サンプルデータのため、Vertex AI は呼ばず見本を表示します',
  readOnly: '閲覧のみ（Google ログインが必要）',
  fireMissing: 'Vertex AI を呼ぶ設定がまだありません（docs/AI機能.md）',
  storeMissing: '結果の保存先がまだありません（docs/AI機能.md）',
  running: '作成中です（このページを開いたままお待ちください）',
  failed: '作成できませんでした',
  retry: 'もう一度作る',
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

/** ② スカウトの画面の文言 */
export const SCOUT_TEXT = {
  generating: '分析して 3 つの案を作っています（10〜30 秒）',
  filtersLegend: '送る相手の条件（指定すると、その条件の送信実績で分析します）',
  noMart: '分析用のデータがまだありません',
  choose: 'この案を選ぶ',
  chosen: '選択中',
  chooseNone: 'どれも使わない',
  commentHint: 'モデルの改善に使います',
  usageQuestion: '企業が使いましたか？',
  placeholders: '{{企業名}} {{候補者名}} などの差し込みは、送る前に置き換えてください。AI が、依頼に無い内容（業務の説明・待遇など）を書くことがあります。企業へ渡す前に、事実と合っているかを確かめてください',
  tuneNow: '今すぐ検証・チューニング',
  rollback: 'この版に戻す',
  /* 何をもとに作るか（最初に選ぶ。選ぶ・確かめるだけでは AI は動かない） */
  basisLegend: '何をもとに作りますか？',
  basisHint: '選ぶと、入力欄が出ます。選ぶ・確かめるだけでは AI は動きません',
  checkJob: '求人を確かめる',
  checkMember: '候補者を確かめる',
  checking: '確かめています…',
  jobIdHint: '求人ページの URL の数字。この企業の求人だけ使えます',
  memberIdHint: '会員 ID（数字）',
  jobNeedsCompany: '先に企業を選んでください',
  jobNotFound: 'この企業の求人が見つかりません',
  memberNotFound: '会員が見つかりません',
  jobUnpublished: 'この求人は掲載が終わっています。内容がいまの募集と合っているか確かめてください',
  jobFields: 'ポジション名・掲載職種・勤務地は、求人の内容を使います',
  memberPrivacy: '氏名・連絡先は表示されません。属性は現在のプロフィールです',
  memberFilters: '分析対象は、この候補者の年齢層・経験職種の送信実績で絞り込みます',
  memberNoFilters: '絞り込みに使える属性が無いため、条件を付けずに分析します',
  runHint: '実行すると AI が動きます（十数秒）',
  needJob: '求人を確かめると実行できます',
  needMember: '候補者を確かめると実行できます',
  needJobMember: '求人と候補者を確かめると実行できます',
  targetLabel: '何をもとに作ったか',
} as const;

export const AI_KIND_DESCRIPTION = {
  report: '企業ページで見ている期間・企業の利用状況を分析し、企業への提案までをスライドにまとめます',
  scout: '類似業界の直近 1 年で返信率の高いスカウト文面を分析し、件名・構成・文章量・特徴をもとに、3 つのモデルが文面の案を作ります',
  job: '同じ業界・職種で「閲覧 → 応募」の率が高い求人の構成・特徴をふまえて、求人を添削する / 求人票を作ります',
} as const;

export const AI_SEVERITY_LABEL = { high: '重要', mid: '中', low: '軽微' } as const;
