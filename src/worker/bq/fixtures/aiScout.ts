import type { BuiltQuery } from '../params';
import type { Row } from '../parseRows';
import { todayJst } from '../../../shared/calendar/periods';

/**
 * ② スカウト文面の AI 作成: 日次マート dwh.cms_ai_*（bq/ai/）のフィクスチャ。ラベルは src/worker/sql/aiScout.ts。
 * 数値はもっともらしい固定の値で、文面は実在しない作り物（社名・個人名は差し込みの記号だけ）。
 */

const str = (q: BuiltQuery, name: string): string => String(q.params.find((x) => x.name === name)?.parameterValue.value ?? '');
const arr = (q: BuiltQuery, name: string): string[] => (q.params.find((x) => x.name === name)?.parameterValue.arrayValues ?? []).map((v) => v.value);

function addMonthsYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 作り物の文面（6 件。返信率の高い順） */
const DIGEST = [
  {
    subject: '【年収 600〜900 万円 / 東京・リモート可】バイリンガルのプロジェクトマネージャーを募集しています',
    body: '{{候補者名}}様\n\nはじめまして。{{企業名}}の採用担当です。\nご経歴を拝見し、海外拠点との調整のご経験に魅力を感じてご連絡しました。\n\n■ ポジション: プロジェクトマネージャー\n■ 年収: 600〜900 万円\n■ 勤務地: 東京（週 2 日までリモート可）\n■ 英語: 会議・メールで日常的に使用\n\nまずは 30 分ほど、オンラインで仕事内容をご説明できれば幸いです。\nご興味がございましたら「興味あり」でご返信ください。',
    lang: 'ja',
    sends: 84,
    replies: 21,
  },
  {
    subject: '【海外営業 / 英語を活かせます】ご経験を拝見してご連絡しました',
    body: '{{候補者名}}様\n\n突然のご連絡失礼いたします。{{企業名}}です。\nレジュメを拝見し、法人営業と英語でのご商談のご経験が、今回の海外営業のポジションに合うと考えました。\n\n・担当エリア: 東南アジア\n・年収: 500〜750 万円（ご経験による）\n・勤務地: 大阪\n・出張: 年 4 回ほど\n\n詳しい内容は下記からご覧いただけます。\n{{URL}}\n\nお気軽にご返信ください。',
    lang: 'ja',
    sends: 120,
    replies: 26,
  },
  {
    subject: 'Bilingual Customer Success Manager (Tokyo / Hybrid) - JPY 6M-8M',
    body: 'Dear {{候補者名}},\n\nI came across your profile and was impressed by your experience in client-facing roles in both Japanese and English.\n\nWe are {{企業名}}, and we are looking for a Customer Success Manager.\n\n- Location: Tokyo (hybrid, 2 days remote)\n- Salary: JPY 6M-8M\n- Language: business-level Japanese and English\n\nIf you are interested, please reply to this message and I will share the details.\n\nBest regards,',
    lang: 'en',
    sends: 65,
    replies: 13,
  },
  {
    subject: '【急募】バックエンドエンジニア（フルリモート・フレックス）',
    body: '{{候補者名}}様\n\n{{企業名}}の採用チームです。\nご経験の開発言語とクラウドのご経験を拝見し、ぜひ一度お話ししたくご連絡しました。\n\n【仕事内容】自社サービスの設計・開発\n【年収】700〜1,000 万円\n【働き方】フルリモート・フレックス\n【休日】完全週休 2 日・年間休日 125 日\n\nカジュアル面談から始められます。ご返信をお待ちしております。',
    lang: 'ja',
    sends: 58,
    replies: 11,
  },
  {
    subject: 'ホテルのフロントスタッフ（英語を使う仕事です）',
    body: '{{候補者名}}様\n\nはじめまして。{{企業名}}です。\n接客のご経験と語学力を拝見し、ご連絡しました。\n\n● 勤務地: 京都\n● 月給: 26〜32 万円\n● 寮あり・ビザのサポートあり\n\nご興味がありましたら、お気軽にご連絡ください。',
    lang: 'ja',
    sends: 40,
    replies: 7,
  },
  {
    subject: 'Software Engineer opportunity - English-speaking team in Tokyo',
    body: 'Hi {{候補者名}},\n\nThank you for reading this message. Your background in backend development caught our attention.\n\nOur company is growing its engineering team in Tokyo.\n\n* Salary: JPY 7M-10M\n* Remote work available\n* Visa support\n\nFeel free to reply if you would like to hear more. A short call is welcome.',
    lang: 'en',
    sends: 52,
    replies: 8,
  },
];

/** ai_scout_benchmark: 1 行。条件の指定があれば類似業界（条件つき）、「その他」や対応表に無い業界は全業界、の形を返す */
export function mockAiScoutBenchmark(q: BuiltQuery): Row[] {
  const data = todayJst();
  const filterNames = ['ages', 'nationalities', 'japanese_levels', 'english_levels', 'residences', 'occupations'];
  const filtered = filterNames.some((n) => arr(q, n).length > 0);
  const lang = str(q, 'lang') || 'ja';
  const hasGroup = str(q, 'industry_group') !== '';
  // 条件が 4 種類以上のときは「該当が少なくて条件を外した」形にする
  const tooNarrow = filterNames.filter((n) => arr(q, n).length > 0).length >= 4;
  const level = tooNarrow ? (hasGroup ? 5 : 6) : filtered ? (hasGroup ? 2 : 3) : hasGroup ? 1 : 3;
  const templates = level === 1 ? 86 : level === 2 || level === 5 ? 214 : 1000;
  const sends = templates * 31;
  const replies = Math.round(sends * 0.172);
  const overallSends = templates * 118;
  const picked = [...DIGEST].sort((a, b) => Number(b.lang === lang) - Number(a.lang === lang));
  const digest = picked.map((d, i) => ({ rank: i + 1, subject: d.subject, body: d.body.slice(0, Number(str(q, 'digest_chars')) || 900), body_chars: d.body.length, sends: d.sends, replies: d.replies, lang: d.lang }));
  return [
    {
      level,
      any_over: true,
      data_date: data,
      period_from: addDaysYmd(addMonthsYmd(data, -(Number(str(q, 'months')) || 12)), 1),
      period_to: data,
      templates,
      companies: Math.round(templates / 6),
      sends,
      replies,
      overall_sends: overallSends,
      overall_replies: Math.round(overallSends * 0.078),
      subject_p25: 28,
      subject_median: 39,
      subject_p75: 52,
      body_p25: 520,
      body_median: 760,
      body_p75: 1040,
      lines_p25: 14,
      lines_median: 21,
      lines_p75: 30,
      has_salary: Math.round(templates * 0.71),
      has_location: Math.round(templates * 0.83),
      has_bullets: Math.round(templates * 0.64),
      has_why_you: Math.round(templates * 0.58),
      has_job_url: Math.round(templates * 0.37),
      has_company_intro: Math.round(templates * 0.49),
      has_cta: Math.round(templates * 0.88),
      has_remote: Math.round(templates * 0.33),
      has_urgency: Math.round(templates * 0.12),
      has_brackets_subject: Math.round(templates * 0.54),
      has_benefits: Math.round(templates * 0.46),
      has_meeting_offer: Math.round(templates * 0.41),
      lang_ja: Math.round(templates * 0.82),
      lang_en: templates - Math.round(templates * 0.82),
      digest_json: JSON.stringify(digest),
    },
  ];
}

const OPTIONS: Record<string, string[]> = {
  ageGroups: ['25-34歳', '35-44歳', '45-54歳', '24歳以下', '55歳以上'],
  nationalities: ['日本国籍以外', '日本国籍'],
  japaneseLevels: ['6. ネイティヴ', '5. 流暢', '4. ビジネス会話', '3. 日常会話', '2. 最低限のコミュニケーション', '1. なし'],
  englishLevels: ['5. 流暢', '4. ビジネス会話', '6. ネイティヴ', '3. 日常会話', '2. 最低限のコミュニケーション', '1. なし'],
  residences: ['東京都', '神奈川県', '日本以外', '大阪府', '埼玉県', '千葉県', '愛知県', '兵庫県', '福岡県', '京都府'],
  occupations: ['IT関連', '営業', 'アドミン系', 'サービス・リテール系', 'マーケティング', '教育/トレーニング/語学系', '電機・機械', 'エグゼクティブ/経営', '金融/保険/不動産系', 'コンサルティング', 'クリエイティブ', 'その他の職種'],
};

/** ai_scout_options: 属性 × 値 × 送信数（多い順）+ 更新日の 1 行 */
export function mockAiScoutOptions(): Row[] {
  const data = todayJst();
  const rows: Row[] = [];
  for (const [attr, values] of Object.entries(OPTIONS)) {
    values.forEach((value, i) => rows.push({ attr, value, n: 60000 - i * 4500, data_date: data }));
  }
  rows.push({ attr: 'dataDate', value: null, n: 0, data_date: data });
  return rows;
}

/** ai_scout_outcomes: サンプルデータでは、照合できた案は無い */
export function mockAiScoutOutcomes(): Row[] {
  return [];
}
