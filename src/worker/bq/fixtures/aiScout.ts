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

/** 作り物の求人（2 件。求人 1001 は企業 1001、求人 1002 は企業 1002 のもの。社名は差し込みの記号だけ） */
const JOBS: Record<string, { company_id: string; row: Row }> = {
  '1001': {
    company_id: '1001',
    row: {
      job_id: '1001',
      title: 'バイリンガルのプロジェクトマネージャー（海外拠点との開発プロジェクト）',
      occupation: 'IT関連（オープン・WEB系） - プロジェクトマネージャー',
      industry: 'ITコンサルティング',
      location: '東京都',
      salary: '600万円〜900万円',
      japanese_level: '流暢',
      english_level: 'ビジネス会話',
      published: true,
      description:
        '{{企業名}}の受託開発プロジェクトで、海外拠点のエンジニアと日本のお客様の間に立つプロジェクトマネージャーを募集します。\n\n【仕事内容】\n・要件の整理と、開発計画の作成\n・海外拠点（英語）との進行管理、品質の確認\n・お客様への報告と、追加のご提案\n\n【働き方】\n・週 2 日までリモート可、フレックスタイム\n・チームは 6〜10 名',
      requirements:
        '【必須】\n・システム開発のプロジェクトマネジメントのご経験 3 年以上\n・英語での会議、メールのご経験\n・日本語: 流暢\n\n【歓迎】\n・オフショア開発のご経験\n・クラウドの基礎知識',
    },
  },
  '1002': {
    company_id: '1002',
    row: {
      job_id: '1002',
      title: '海外営業（東南アジア担当）',
      occupation: '営業 - 海外担当営業',
      industry: '機械メーカー',
      location: '大阪府',
      salary: '500万円〜750万円',
      japanese_level: 'ビジネス会話',
      english_level: '流暢',
      published: false,
      description: '東南アジアの代理店への、産業用機器の提案営業です。\n・既存の代理店への販売支援\n・新しい代理店の開拓\n・年 4 回ほどの海外出張',
      requirements: '・法人営業のご経験 2 年以上\n・英語での商談のご経験',
    },
  },
};

/** ai_scout_job: 企業と求人の両方が合う 1 行だけ（ほかの企業の ID では 0 行。SQL の WHERE と同じ） */
export function mockAiScoutJob(q: BuiltQuery): Row[] {
  const j = JOBS[str(q, 'job_id')];
  if (!j || j.company_id !== str(q, 'company_id')) return [];
  const chars = Number(str(q, 'chars')) || 1500;
  return [{ ...j.row, description: String(j.row.description).slice(0, chars), requirements: String(j.row.requirements).slice(0, chars) }];
}

/** 作り物の候補者（2 人。値は選択肢（OPTIONS）と同じ形。氏名・連絡先は無い） */
const MEMBERS: Record<string, Row> = {
  '20001': {
    member_id: '20001',
    age_group: '25-34歳',
    nationality_category: '日本国籍以外',
    japanese_level: '5. 流暢',
    english_level: '6. ネイティヴ',
    residence: '東京都',
    occupation_group: 'IT関連',
    last_industry: 'IT関連',
    career_level: '3. シニアレベル',
    income_range: '501万円〜800万円',
    desired_income_range: '801万円以上',
    experienced_json: JSON.stringify(['IT関連（オープン・WEB系）', 'IT関連（その他）', 'コンサルティング']),
    desired_json: JSON.stringify(['IT関連（オープン・WEB系）', 'エグゼクティブ/経営']),
  },
  '20002': {
    member_id: '20002',
    age_group: '35-44歳',
    nationality_category: '日本国籍',
    japanese_level: '6. ネイティヴ',
    english_level: '4. ビジネス会話',
    residence: '大阪府',
    occupation_group: '営業',
    last_industry: '製造業',
    career_level: '(未入力)',
    income_range: '(未入力)',
    desired_income_range: '501万円〜800万円',
    experienced_json: JSON.stringify(['営業', '企画/マーケティング/PR']),
    desired_json: JSON.stringify([]),
  },
};

/** ai_scout_member: 作り物の 2 人だけ（ほかの ID は 0 行） */
export function mockAiScoutMember(q: BuiltQuery): Row[] {
  const m = MEMBERS[str(q, 'member_id')];
  return m ? [{ ...m }] : [];
}

/**
 * 作り物の職務経歴・自己PR（会員 20001 だけ。日本語と英語の 2 行。20002 はレジュメなし）。
 * 実在しない内容で、社名・人名は無い（マート dwh_restricted.cms_ai_member_resumes と同じく、勤務先の社名の列は無い）
 */
const RESUMES: Record<string, { lang: 'ja' | 'en'; appeal: string; work: { title: string | null; start_ym: string | null; end_ym: string | null; notes: string }[]; work_count: number; job_change_times: number | null }[]> = {
  '20001': [
    {
      lang: 'ja',
      appeal:
        'Web アプリケーションの開発に 8 年ほど携わり、直近の 3 年はプロジェクトマネージャーとして、日本と海外拠点の開発チームの橋渡しを担当してきました。' +
        '要件の整理から進行管理、リリース後の改善までを一貫して進めることを得意としています。' +
        '英語と日本語の両方で会議の進行と資料の作成ができ、認識のずれを早い段階で見つけて解消することを心がけています。' +
        '開発の経験があるため、技術的な課題を自分で読み解き、エンジニアと同じ言葉で話せることが強みです。' +
        '今後は、より大きな規模のプロダクトで、海外のメンバーを含むチームをまとめる役割に挑戦したいと考えています。' +
        '新しい技術の習得にも継続して取り組んでおり、クラウドの設計に関する資格の取得を進めています。',
      work: [
        {
          title: 'プロジェクトマネージャー',
          start_ym: '2022-04',
          end_ym: null,
          notes:
            '受託開発のプロジェクトで、進行管理と顧客との調整を担当。\n・メンバー 8 名（うち海外拠点 4 名）のチームの進行管理\n・要件の整理と、見積りの作成\n・週次の定例会議の進行（英語・日本語）\n・リリースの計画と、品質の確認',
        },
        {
          title: 'Web エンジニア',
          start_ym: '2017-04',
          end_ym: '2022-03',
          notes: '業務システムと EC サイトの開発を担当。\n・サーバーサイドの設計と実装\n・コードレビューと、新しいメンバーの育成\n・運用の自動化による、作業時間の短縮',
        },
      ],
      work_count: 2,
      job_change_times: 2,
    },
    {
      lang: 'en',
      appeal:
        'I have about eight years of experience in web application development, and for the last three years I have worked as a project manager bridging development teams in Japan and overseas. ' +
        'I am comfortable leading meetings and preparing documents in both English and Japanese.',
      work: [
        { title: 'Project Manager', start_ym: '2022-04', end_ym: null, notes: 'Managed schedules and client communication for contract development projects.\n- Led a team of eight, including four members overseas\n- Organized requirements and prepared estimates' },
        { title: 'Web Engineer', start_ym: '2017-04', end_ym: '2022-03', notes: 'Developed business systems and e-commerce sites.\n- Server-side design and implementation\n- Code review and onboarding of new members' },
      ],
      work_count: 2,
      job_change_times: 2,
    },
  ],
};

/** ai_scout_member_resume: 文面の言語（@lang）のレジュメを優先して 1 行（SQL の ORDER BY と同じ）。本文は @appeal_chars / @work_chars 文字、職務経歴は @work_max 社まで */
export function mockAiScoutMemberResume(q: BuiltQuery): Row[] {
  const memberId = str(q, 'member_id');
  const list = RESUMES[memberId];
  if (!list || list.length === 0) return [];
  const r = list.find((x) => x.lang === str(q, 'lang')) ?? list[0];
  const appealChars = Number(str(q, 'appeal_chars')) || 600;
  const workChars = Number(str(q, 'work_chars')) || 600;
  const workMax = Number(str(q, 'work_max')) || 3;
  return [
    {
      member_id: memberId,
      lang: r.lang,
      appeal: r.appeal.slice(0, appealChars),
      appeal_chars: r.appeal.length,
      work_json: JSON.stringify(r.work.slice(0, workMax).map((w) => ({ ...w, notes: w.notes.slice(0, workChars) }))),
      work_count: r.work_count,
      work_chars: r.work.reduce((n, w) => n + w.notes.length, 0),
      management_experience: null,
      management_experience_years: 0,
      job_change_times: r.job_change_times,
    },
  ];
}
