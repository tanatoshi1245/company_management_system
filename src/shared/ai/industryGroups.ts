/**
 * ② スカウト: 「類似業界」のまとまり（業界 = cms_company_master.industry の 48 種 → 12 のまとまり）。
 * 分析対象は 同じ業界 → 類似業界（このまとまり）→ 全業界 の順に広げる（src/shared/ai/scout.ts）。
 * **同じ対応表が BigQuery のマート dwh.cms_ai_dim_industry_group（bq/ai/scout_marts.sql）にある。**
 * 変えるときは両方を一緒に直す（tests/worker/aiScoutData.test.ts が突き合わせる）。
 */
export interface IndustryGroup {
  /** まとまりの ID（マートの industry_group） */
  id: string;
  /** 画面に出す名前（マートの group_label） */
  label: string;
  /** 入っている業界（マートの industry と同じ表記） */
  industries: readonly string[];
}

export const INDUSTRY_GROUPS: readonly IndustryGroup[] = [
  {
    id: 'it',
    label: 'IT・通信',
    industries: ['通信・情報サービス関連', 'ITコンサルティング', 'その他IT関連', 'ソフトウェアベンダー', 'システムインテグレーター', 'ソフトウェア（受託開発）', 'インターネット・プロバイダー関連', 'ゲーム関連'],
  },
  { id: 'hr', label: '人材', industries: ['人材紹介会社', '派遣会社', 'アウトソーシング'] },
  {
    id: 'maker',
    label: 'メーカー',
    industries: [
      '自動車・輸送機器メーカー',
      '機械メーカー',
      '半導体・電気・電子部品メーカー',
      'その他製造業',
      '産業機器・重電・設備メーカー',
      '電気・家電メーカー',
      'コンピュータ・OA・通信機器メーカー',
      '化学・石油メーカー',
      '精密・測定機器メーカー',
      '繊維メーカー',
      '鉄鋼・金属・非鉄',
      '食品メーカー',
    ],
  },
  { id: 'consulting', label: 'コンサルティング', industries: ['ビジネスコンサルティング', 'その他コンサルティング', 'マーケットリサーチ・シンクタンク'] },
  { id: 'finance', label: '金融', industries: ['その他金融', '投資・ファンド関連', '銀行・証券関連', '生命保険・損害保険'] },
  {
    id: 'consumer',
    label: 'サービス・消費',
    industries: ['旅行・ホテル・レジャー・外食', '流通・小売', 'ファッション・アパレル・アクセサリー関連', '化粧品メーカー', '高級消費財', '消費財/FMCGメーカー'],
  },
  { id: 'trading', label: '商社・物流', industries: ['商社・卸', '運輸・倉庫・物流'] },
  { id: 'public', label: '教育・公共', industries: ['教育・学校', '官公庁・団体'] },
  { id: 'media', label: 'メディア', industries: ['マスコミ・広告・出版・印刷・放送'] },
  { id: 'realestate', label: '不動産・建設・エネルギー', industries: ['住宅・不動産・施設関連', 'プラント・建築・建設', '電力・ガス・石油・エネルギー関連'] },
  { id: 'medical', label: '医療・ヘルスケア', industries: ['医療・福祉関連', '医療機器メーカー', '製薬メーカー'] },
  { id: 'other', label: 'その他', industries: ['その他'] },
];

const BY_INDUSTRY: ReadonlyMap<string, IndustryGroup> = new Map(INDUSTRY_GROUPS.flatMap((g) => g.industries.map((i) => [i, g] as const)));

/** 業界 → まとまり。対応表に無い業界（手で入れた文字など）は null（分析対象は全業界になる） */
export function industryGroupOf(industry: string): IndustryGroup | null {
  return BY_INDUSTRY.get(industry.trim()) ?? null;
}

export function industryGroupById(id: string): IndustryGroup | null {
  return INDUSTRY_GROUPS.find((g) => g.id === id) ?? null;
}
