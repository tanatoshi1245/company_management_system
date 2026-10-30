import type { Row } from '../parseRows';
import { addDays, addMonths, lastNMonths, monthOf, todayJst } from '../../../shared/calendar/periods';
import { between, pick, seeded } from './random';

/**
 * ボード用のサンプルデータ（40 社・14 か月）。列名は実 SQL（src/worker/sql/*.ts）の出力と同じにする。
 * ペース遅れ・ログインなし・契約終了間近・目標未設定が必ず混ざるようにしてある
 */
const INDUSTRIES = ['通信・情報サービス関連', 'ソフトウェアベンダー', 'ITコンサルティング', '人材紹介会社', '商社・卸', '教育・学校', '旅行・ホテル・レジャー・外食', '機械メーカー'];
const TYPES = ['直接', '直接', '直接', '直接', '直接', '直接', '紹介', '派遣', 'RPO', 'DA', 'NW'];
const PLANS = ['DJ', 'DJ_成果報酬', 'RPO', 'WA', 'DJ_成果報酬（採用成功）'];
const OWNERS: { email: string; name: string; position: string }[] = [
  { email: 'preview@daijob.com', name: 'サンプル 利用者', position: 'CS' },
  { email: 's-kaku@daijob.com', name: 'シュウ カク', position: 'CS' },
  { email: 'm-tanabe@daijob.com', name: '田辺 真美', position: 'CS' },
  { email: 'n-yagi@daijob.com', name: '八木 なつき', position: 'CS' },
  { email: 'k-jung@daijob.com', name: 'JUNG KYOUNGJOON', position: 'CS' },
  { email: 'm-takayanagi@daijob.com', name: '高柳 瑞沙', position: 'CS' },
  { email: 'm-fujita@daijob.com', name: '藤田 茉優', position: 'FS' },
];
const NAMES = ['アーク情報システム', 'グローバルテック', 'サンライズ商事', 'ネクストリンク', 'ブルーオーシャン・コンサルティング', 'ミライ教育', 'オリオンホテルズ', '北斗精機', 'クレセント人材', 'エバーグリーン・ソフト', 'セントラル通信', 'ホライズン貿易', 'アルファ・ラーニング', 'トライデント・コンサル', 'プラネットIT', 'メイプル・リゾート', 'シルバーライン機械', 'ゼニス・パートナーズ', 'コスモ・デジタル', 'ラピッド商会'];

export interface MockCompany {
  id: number;
  name: string;
  industry: string;
  type: string;
  plan: string;
  owner: (typeof OWNERS)[number] | null;
  from: string;
  to: string | null;
  scoutLimit: number | null;
  jobLimit: number | null;
  /** 1 = 活発、0.4 = 低調（ペース遅れ） */
  activity: number;
  loginLag: number | null;
}

export function mockCompanies(today = todayJst()): MockCompany[] {
  const rand = seeded(20261023);
  const out: MockCompany[] = [];
  for (let i = 0; i < 40; i++) {
    const id = 1001 + i;
    const base = NAMES[i % NAMES.length];
    const name = i < NAMES.length ? `株式会社${base}` : `${base}ジャパン合同会社`;
    const type = TYPES[i % TYPES.length];
    const industry = type === 'DA' ? '人材紹介会社' : INDUSTRIES[i % INDUSTRIES.length];
    // 契約期間: 4 社は 60 日以内に終了、2 社は開始前、3 社は直近終了、残りは契約中
    let from: string;
    let to: string | null;
    if (i < 4) {
      from = addDays(today, -300 + i * 10);
      to = addDays(today, 10 + i * 12);
    } else if (i < 6) {
      from = addDays(today, 5 + (i - 4) * 7);
      to = addDays(from, 365);
    } else if (i < 9) {
      from = addDays(today, -400);
      to = addDays(today, -(10 + (i - 6) * 25));
    } else {
      from = addDays(today, -between(rand, 30, 500));
      to = i % 7 === 0 ? null : addDays(from, pick(rand, [182, 365, 365, 730]));
    }
    // NW（Network 契約）は求人枠もスカウト枠も 0 で、掲載・送信が無い
    const scoutLimit = type === 'NW' ? 0 : i % 9 === 8 ? null : pick(rand, [50, 100, 150, 200, 300]);
    const jobLimit = type === 'NW' ? 0 : i % 11 === 10 ? null : pick(rand, [5, 10, 15, 20, 30]);
    const activity = i % 5 === 0 ? 0.35 : i % 5 === 1 ? 0.7 : i % 5 === 2 ? 1.1 : 0.9;
    const loginLag = i % 6 === 5 ? null : i % 6 === 4 ? between(rand, 15, 60) : between(rand, 0, 6);
    const owner = i % 8 === 7 ? null : OWNERS[i % OWNERS.length];
    out.push({ id, name, industry, type, plan: PLANS[i % PLANS.length], owner, from, to, scoutLimit, jobLimit, activity, loginLag });
  }
  return out;
}

function stateOf(c: MockCompany, today: string): { state: string; daysToEnd: number | null; now: boolean } {
  const daysToEnd = c.to ? Math.round((Date.parse(c.to) - Date.parse(today)) / 86_400_000) : null;
  const started = c.from <= today;
  const now = started && (c.to === null || c.to >= today);
  let state = 'ended';
  if (now) state = daysToEnd !== null && daysToEnd <= 30 ? 'ending_30d' : 'active';
  else if (!started) state = 'upcoming';
  else if (daysToEnd !== null && daysToEnd >= -90) state = 'ended_recent';
  return { state, daysToEnd, now };
}

/** アカウント種別。4 社に 1 社（直接 / 紹介）は 直接 + 紹介 の 2 アカウント（複数アカウント企業のサンプル） */
export function mockAccountTypes(c: { id: number | string; type: string }): string[] {
  if (Number(c.id) % 4 === 0 && (c.type === '直接' || c.type === '紹介')) return ['直接', '紹介'];
  return ['直接', '紹介', '派遣'].includes(c.type) ? [c.type] : [];
}

export function mockCompanyMaster(today = todayJst()): Row[] {
  return mockCompanies(today).map((c) => {
    const s = stateOf(c, today);
    const daysSince = Math.round((Date.parse(today) - Date.parse(c.from)) / 86_400_000);
    return {
      company_id: String(c.id),
      company_name: c.name,
      internal_name: c.name,
      company_type: c.type,
      account_types: mockAccountTypes(c).join(','),
      dj_contract_type: c.plan.includes('成果') ? '採用成功報酬型' : '広告掲載型',
      active_from: c.from,
      active_to: c.to,
      is_contracted_now: s.now,
      contract_state: s.state,
      days_to_contract_end: s.daysToEnd,
      days_since_contract_start: daysSince,
      contract_days_total: c.to ? Math.round((Date.parse(c.to) - Date.parse(c.from)) / 86_400_000) + 1 : null,
      scout_limit: c.scoutLimit,
      job_posting_limit: c.jobLimit,
      scout_limit_period_default: 'month',
      industry: c.industry,
      industry_source: 'company_profiles',
      sf_link_status: c.owner ? 'linked' : 'unlinked',
      sf_account_id: c.owner ? `001${c.id}` : null,
      sf_contract_status: c.owner ? '有効' : null,
      sf_contract_start: c.owner ? c.from : null,
      sf_contract_end: c.owner ? c.to : null,
      plan_name: c.plan,
      plan_source: c.owner ? 'sf_contract' : 'company_profiles',
      sf_active_contract: Boolean(c.owner && s.now),
      sf_live_won_opp: Boolean(c.owner),
      da_active_profile: c.type === 'DA',
      sf_notice_check: false,
      sf_account_owner_name: c.owner?.name ?? null,
      sf_account_owner_email: c.owner?.email ?? null,
      sf_account_owner_position: c.owner?.position ?? null,
      sf_contract_owner_name: c.owner?.name ?? null,
      sf_contract_owner_email: c.owner?.email ?? null,
      sf_contract_owner_position: c.owner?.position ?? null,
      sales_staff: c.owner ? c.owner.name.split(' ').reverse().join(' ') : '未設定',
      cs_owner_email_default: c.owner?.email ?? null,
      cs_owner_name_default: c.owner?.name ?? null,
      owner_source: 'sales_staff',
      active_jobs_now: Math.min(c.jobLimit ?? 12, Math.round((c.jobLimit ?? 12) * c.activity)),
      run_date: today,
    };
  });
}

export function mockMonths(today = todayJst()): string[] {
  return lastNMonths(monthOf(today), 14);
}

export function mockCompanyMonthly(today = todayJst()): Row[] {
  const rand = seeded(7);
  const months = mockMonths(today);
  const cur = monthOf(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const rows: Row[] = [];
  for (const c of mockCompanies(today)) {
    for (const ym of months) {
      const isCur = ym === cur;
      const contracted = c.from <= `${ym}-31` && (c.to === null || c.to >= `${ym}-01`);
      const frac = isCur ? Math.max(0.05, (dayOfMonth - 1) / 30) : 1;
      const limit = c.scoutLimit ?? 120;
      // 7 社に 1 社は奇数月にスカウトを送らない（スカウト未利用の登録ページ・フィルタのサンプル）
      const skipMonth = Number(c.id) % 7 === 0 && Number(ym.slice(5, 7)) % 2 === 1;
      const sent = contracted && !skipMonth ? Math.round(limit * c.activity * frac * (0.75 + rand() * 0.5)) : 0;
      const manual = Math.round(sent * (0.5 + rand() * 0.4));
      const interested = Math.round(sent * (0.06 + rand() * 0.14));
      const jobs = contracted && c.jobLimit !== 0 ? Math.min(c.jobLimit ?? 12, Math.max(1, Math.round((c.jobLimit ?? 12) * c.activity * (0.8 + rand() * 0.3)))) : 0;
      const apps = contracted ? Math.round(jobs * (0.3 + rand() * 1.2) * frac) : 0;
      const views = contracted ? Math.round(jobs * (15 + rand() * 40) * frac) : 0;
      const hires = contracted && rand() < 0.12 * c.activity ? 1 : 0;
      const inSel = Math.round((apps + interested) * 0.2 * rand());
      rows.push({
        company_id: String(c.id),
        month_ym: ym,
        account_type: '__ALL__',
        is_current_month: isCur,
        data_days: isCur ? dayOfMonth - 1 : 30,
        is_contracted_in_month: contracted,
        scout_limit: c.scoutLimit,
        job_posting_limit: c.jobLimit,
        active_jobs_eom: jobs,
        new_jobs: contracted ? between(rand, 0, 3) : 0,
        scout_sent: sent,
        scout_sent_manual: manual,
        scout_sent_auto: sent - manual,
        scout_sent_contract_to_date: sent * 3,
        interested_by_send_month: interested,
        interested_by_reply_month: Math.round(interested * 0.9),
        applications: apps,
        job_views: views,
        hires,
        in_selection: inSel,
        st01_no_response: Math.round((apps + interested) * 0.3 * rand()),
        st11_hired: hires,
        login_days: ym < '2026-05' ? null : contracted ? (c.loginLag === null ? 0 : between(rand, 2, 18)) : 0,
      });
    }
  }
  return rows;
}

export function mockCompanyLogin(today = todayJst()): Row[] {
  const rand = seeded(11);
  const yesterday = addDays(today, -1);
  return mockCompanies(today).map((c) => {
    const last = c.loginLag === null ? null : addDays(yesterday, -c.loginLag);
    return {
      company_id: String(c.id),
      last_login_date: last,
      last_login_at: last ? `${last}T09:12:00Z` : null,
      days_since_login: c.loginLag,
      login_days_mtd: last ? between(rand, 1, 10) : 0,
      login_days_30d: c.loginLag === null ? 0 : c.loginLag > 30 ? 0 : between(rand, 3, 16),
      login_days_90d: c.loginLag === null ? 0 : between(rand, 5, 40),
      data_available_from: '2026-05-15',
      data_through_date: yesterday,
    };
  });
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 月次フィクスチャから算出した業界ベンチマーク（実 SQL と同じ指標名・ロールアップ） */
export function mockIndustryBenchmark(monthYm: string, today = todayJst()): Row[] {
  const comps = new Map(mockCompanies(today).map((c) => [String(c.id), c]));
  const groups = new Map<string, Map<string, number[]>>();
  const push = (ind: string, typ: string, metric: string, v: number | null, cid: string) => {
    if (v === null || !Number.isFinite(v)) return;
    const k = `${ind}|${typ}`;
    const g = groups.get(k) ?? new Map<string, number[]>();
    const arr = g.get(metric) ?? [];
    arr.push(v);
    g.set(metric, arr);
    groups.set(k, g);
    const ids = g.get(`__ids__${metric}`) ?? [];
    ids.push(Number(cid));
    g.set(`__ids__${metric}`, ids);
  };
  for (const r of mockCompanyMonthly(today)) {
    if (r.month_ym !== monthYm || !r.is_contracted_in_month) continue;
    const c = comps.get(String(r.company_id));
    if (!c) continue;
    const sent = Number(r.scout_sent);
    const jobs = Number(r.active_jobs_eom);
    const metrics: [string, number | null][] = [
      ['scout_utilization', c.scoutLimit ? sent / c.scoutLimit : null],
      ['job_utilization', c.jobLimit ? jobs / c.jobLimit : null],
      ['reply_rate', sent ? Number(r.interested_by_send_month) / sent : null],
      ['apps_per_active_job', jobs ? Number(r.applications) / jobs : null],
      ['views_per_active_job', jobs ? Number(r.job_views) / jobs : null],
      ['interested_per_100_scouts', sent ? (Number(r.interested_by_send_month) * 100) / sent : null],
      ['hires', Number(r.hires)],
      ['login_days', r.login_days === null ? null : Number(r.login_days)],
    ];
    for (const [ind, typ] of [[c.industry, c.type], [c.industry, '__ALL__'], ['__ALL__', c.type], ['__ALL__', '__ALL__']]) for (const [m, v] of metrics) push(ind, typ, m, v, String(c.id));
  }
  const rows: Row[] = [];
  for (const [k, g] of groups) {
    const [industry, company_type] = k.split('|');
    for (const [metric, vals] of g) {
      if (metric.startsWith('__ids__')) continue;
      const sorted = [...vals].sort((a, b) => a - b);
      rows.push({ industry, company_type, metric, n_companies: new Set(g.get(`__ids__${metric}`) ?? []).size, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75) });
    }
  }
  return rows;
}

/** 2 か月前〜当月のサンプル（daily usage は M2 で使う） */
export function mockPrevMonth(today = todayJst()): string {
  return addMonths(monthOf(today), -1);
}
