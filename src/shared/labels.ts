/** 画面の日本語ラベルと並び順（マートの値 → 表示）。値そのものはマート README を参照 */

export const COMPANY_TYPES = ['DA', 'RPO', '直接', '紹介', '派遣', '不明'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];
export const COMPANY_TYPE_SHORT: Record<string, string> = { DA: 'DA', RPO: 'RPO', 直接: '直接', 紹介: '紹介', 派遣: '派遣', '紹介（派遣含む）': '紹介', 不明: '不明' };

/** 担当の表示名（苗字だけ）。「田辺 真美」→「田辺」、「JUNG KYOUNGJOON」→「JUNG」。空白が無ければそのまま */
export function surname(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = name.trim().split(/[\s\u3000]+/)[0];
  return t || null;
}

export const CONTRACT_STATES = ['active', 'ending_30d', 'upcoming', 'ended_recent', 'ended'] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];
export const CONTRACT_STATE_LABEL: Record<ContractState, string> = { active: '契約中', ending_30d: '終了間近', upcoming: '開始前', ended_recent: '直近終了', ended: '終了' };

/** 選考ステータス（応募・スカウト共通。値は member_applications.status / scouts.application_status） */
export const STATUS_KEYS = ['st01_no_response', 'st02_contact_planned', 'st03_pass_planned', 'st04_contacted', 'st05_rejected', 'st06_interview_adjusting', 'st07_interview_1st', 'st08_interview_2nd', 'st09_interview_3rd', 'st10_interview_final', 'st11_hired', 'st12_declined'] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];
export const STATUS_VALUES: Record<StatusKey, string> = {
  st01_no_response: '1.未対応',
  st02_contact_planned: '2.連絡予定',
  st03_pass_planned: '3.見送り予定',
  st04_contacted: '4.連絡済み',
  st05_rejected: '5.不採用',
  st06_interview_adjusting: '6.面接調整中',
  st07_interview_1st: '7.1stインタビュー',
  st08_interview_2nd: '8.2ndインタビュー',
  st09_interview_3rd: '9.3rdインタビュー',
  st10_interview_final: '10.Finalインタビュー',
  st11_hired: '11.採用',
  st12_declined: '12.辞退',
};
export const STATUS_SHORT: Record<string, string> = {
  '1.未対応': '未対応',
  '2.連絡予定': '連絡予定',
  '3.見送り予定': '見送り予定',
  '4.連絡済み': '連絡済み',
  '5.不採用': '不採用',
  '6.面接調整中': '面接調整中',
  '7.1stインタビュー': '1次面接',
  '8.2ndインタビュー': '2次面接',
  '9.3rdインタビュー': '3次面接',
  '10.Finalインタビュー': '最終面接',
  '11.採用': '採用',
  '12.辞退': '辞退',
  '(未設定)': '未設定',
};
/** コホート表の列順（未設定は最後） */
export const STATUS_ORDER: string[] = [...STATUS_KEYS.map((k) => STATUS_VALUES[k]), '(未設定)'];
/** 「選考中」= 面接調整中〜最終面接 */
export const IN_SELECTION_KEYS: StatusKey[] = ['st06_interview_adjusting', 'st07_interview_1st', 'st08_interview_2nd', 'st09_interview_3rd', 'st10_interview_final'];

export const ATTRIBUTE_TYPES = ['japanese_level', 'english_level', 'residence_prefecture', 'last_occupation_group', 'experienced_occupation', 'desired_occupation', 'current_income_range', 'desired_income_range', 'age_group', 'target_flag', 'member_category'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];
export const ATTRIBUTE_LABEL: Record<AttributeType, string> = {
  japanese_level: '日本語レベル',
  english_level: '英語レベル',
  residence_prefecture: '現住所',
  last_occupation_group: '最終経験職種',
  experienced_occupation: '経験職種',
  desired_occupation: '希望職種',
  current_income_range: '現年収',
  desired_income_range: '希望年収',
  age_group: '年代',
  target_flag: 'ターゲット区分',
  member_category: '会員分類',
};

export const OWNER_SOURCE_LABEL: Record<string, string> = {
  override: '画面で上書き',
  sf_account_owner: 'Salesforce 取引先の所有者',
  sf_contract_owner: 'Salesforce 契約の所有者',
  sales_staff: '企業管理ツールの担当（active_companies）',
  none: '未設定',
};

export const INDUSTRY_SOURCE_LABEL: Record<string, string> = { company_profiles: 'Daijob 企業プロファイル', sf_accounts: 'Salesforce 取引先', none: '未設定' };
export const PLAN_SOURCE_LABEL: Record<string, string> = { sf_contract: 'SF 契約', sf_opportunity: 'SF 成立商談', company_profiles: 'Daijob 契約種別', none: '未設定' };
