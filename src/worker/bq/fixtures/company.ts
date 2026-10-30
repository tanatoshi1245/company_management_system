import type { Row } from '../parseRows';
import { addDays, addMonths, eachDay, endOfMonth, monthOf, todayJst } from '../../../shared/calendar/periods';
import { STATUS_ORDER } from '../../../shared/labels';
import { between, pick, seeded } from './random';
import { mockAccountTypes, mockCompanies, mockCompanyMaster, mockCompanyMonthly, mockCompanyLogin, mockIndustryBenchmark, mockMonths } from './board';

export function mockCompanyMasterOne(id: string, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  const row = mockCompanyMaster(today).find((r) => r.company_id === id);
  if (!c || !row) return [];
  const jobs = mockJobs(id, today);
  return [{ ...row, profile_count: mockAccountTypes(c).length * 2, contract_from: c.from, contract_to: c.to, sf_account_name: c.owner ? `${c.name}（SF）` : null, scout_unused_json: mockScoutUnusedJson(id, today), jobs_window_distinct: new Set(jobs.map((j) => j.k)).size, accounts_json: mockAccountsJson(id, today), jobs_json: JSON.stringify(jobs) }];
}

/** accounts_json: アカウント種別ごとに 日 / 英 の 2 プロファイル */
export function mockAccountsJson(id: string, today = todayJst()): string {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c) return '[]';
  const out: { type: string; profile_id: number; profile_name: string; language: string }[] = [];
  mockAccountTypes(c).forEach((type, i) => {
    out.push({ type, profile_id: Number(id) * 10 + i * 2, profile_name: c.name, language: '日' });
    out.push({ type, profile_id: Number(id) * 10 + i * 2 + 1, profile_name: `${c.name} (EN)`, language: '英' });
  });
  return JSON.stringify(out);
}

/** jobs_json: 窓に掛かる求人。掲載開始・終了を散らして、期間を変えると件数が変わるようにする。アカウントが 2 つなら 6:4 で分ける */
export function mockJobs(id: string, today = todayJst()): { a: string; k: number; s: string; e: string | null }[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c || c.jobLimit === 0) return [];
  const rand = seeded(Number(id) * 17);
  const months = mockMonths(today);
  const accounts = mockAccountTypes(c);
  const n = (c.jobLimit ?? 12) * 2 + (Number(id) % 5);
  const out: { a: string; k: number; s: string; e: string | null }[] = [];
  for (let i = 0; i < n; i++) {
    const startM = months[between(rand, 0, months.length - 1)];
    const s = `${startM}-${String(between(rand, 1, 28)).padStart(2, '0')}`;
    const open = rand() < 0.5;
    const e = open ? null : addDays(s, between(rand, 20, 120));
    const a = accounts.length > 1 ? (i % 5 < 3 ? accounts[0] : accounts[1]) : (accounts[0] ?? c.type);
    out.push({ a, k: Number(id) * 1000 + i, s, e: e && e < s ? null : e });
  }
  return out.sort((x, y) => (x.s < y.s ? 1 : -1));
}

/** アカウント種別ごとの月次。2 アカウントの企業は全体を 6:4 に分ける（合計 = 全体） */
export function mockCompanyAccountMonthlyOne(id: string, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c) return [];
  const accounts = mockAccountTypes(c);
  if (!accounts.length) return [];
  const out: Row[] = [];
  const keys = ['active_jobs_eom', 'scout_sent', 'interested_by_reply_month', 'applications', 'job_views', 'hires_from_application', 'hires_from_scout', 'in_selection'];
  for (const r of mockCompanyMonthlyOne(id, today)) {
    if (accounts.length === 1) {
      const row: Row = { account_type: accounts[0], month_ym: r.month_ym };
      for (const k of keys) row[k] = Number(r[k] ?? 0);
      out.push(row);
      continue;
    }
    const first: Row = { account_type: accounts[0], month_ym: r.month_ym };
    const second: Row = { account_type: accounts[1], month_ym: r.month_ym };
    for (const k of keys) {
      const total = Number(r[k] ?? 0);
      const a = Math.round(total * 0.6);
      first[k] = a;
      second[k] = total - a;
    }
    out.push(first, second);
  }
  return out;
}

const UNUSED_REASONS = ['1. 企業担当者の作業時間取れず未利用', '2. そもそもスカウト対象が1人もいなく、1通も送れない', '5. 応募で十分間に合うのでスカウト不要', '7. その他の理由', null];
const UNUSED_REMARKS = ['運用開始直後', '先方事情でスカウト送付不可', null, null];

/** スカウト未利用の記録（3 社に 1 社、直近 1〜4 か月分）。JSON 配列の文字列で返す（マートと同じ形） */
export function mockScoutUnusedJson(id: string, today = todayJst()): string {
  const n = Number(id);
  if (n % 3 !== 0) return '[]';
  const rand = seeded(n * 13);
  const months = mockMonths(today).slice(-5, -1).reverse().slice(0, 1 + between(rand, 0, 3));
  return JSON.stringify(months.map((month) => ({ month, reason: pick(rand, UNUSED_REASONS), remarks: pick(rand, UNUSED_REMARKS) })));
}

/** 月次（1 社）。ステータス別の列も付ける */
export function mockCompanyMonthlyOne(id: string, today = todayJst()): Row[] {
  const rand = seeded(Number(id));
  return mockCompanyMonthly(today)
    .filter((r) => r.company_id === id)
    .map((r) => {
      const pool = Number(r.applications) + Number(r.interested_by_send_month);
      const parts = [0.3, 0.05, 0.03, 0.2, 0.15, 0.06, 0.08, 0.04, 0.01, 0.02, 0.03, 0.03].map((w) => Math.round(pool * w * (0.6 + rand() * 0.8)));
      const keys = ['st01_no_response', 'st02_contact_planned', 'st03_pass_planned', 'st04_contacted', 'st05_rejected', 'st06_interview_adjusting', 'st07_interview_1st', 'st08_interview_2nd', 'st09_interview_3rd', 'st10_interview_final', 'st11_hired', 'st12_declined'];
      const st: Row = {};
      keys.forEach((k, i) => (st[k] = parts[i]));
      st.st11_hired = Number(r.hires);
      const hires = Number(r.hires);
      const viaScout = hires > 0 && rand() < 0.4 ? 1 : 0;
      return { ...r, ...st, hires_from_application: Math.max(0, hires - viaScout), hires_from_scout: viaScout, in_selection: parts[5] + parts[6] + parts[7] + parts[8] + parts[9] };
    });
}

export function mockCompanyLoginOne(id: string, today = todayJst()): Row[] {
  return mockCompanyLogin(today).filter((r) => r.company_id === id);
}

/** 日次（前月 + 当月、昨日まで）。月内累積付き */
export function mockDailyUsage(id: string, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c) return [];
  const rand = seeded(Number(id) * 7);
  const prev = addMonths(monthOf(today), -1);
  const days = eachDay(`${prev}-01`, addDays(today, -1));
  const out: Row[] = [];
  let month = '';
  let cum = { sent: 0, apps: 0, int: 0, views: 0 };
  for (const d of days) {
    const m = monthOf(d);
    if (m !== month) {
      month = m;
      cum = { sent: 0, apps: 0, int: 0, views: 0 };
    }
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const base = ((c.scoutLimit ?? 120) / 22) * c.activity;
    const sent = weekend ? 0 : Math.max(0, Math.round(base * (0.3 + rand() * 1.4)));
    const apps = weekend ? between(rand, 0, 1) : between(rand, 0, 3);
    const int = rand() < 0.15 ? 1 : 0;
    const views = between(rand, 5, 60);
    cum = { sent: cum.sent + sent, apps: cum.apps + apps, int: cum.int + int, views: cum.views + views };
    out.push({ usage_date: d, month_ym: m, day_of_month: Number(d.slice(8, 10)), scout_sent: sent, scout_sent_cum: cum.sent, applications: apps, applications_cum: cum.apps, interested: int, interested_cum: cum.int, job_views: views, job_views_cum: cum.views, active_jobs: Math.min(c.jobLimit ?? 12, Math.round((c.jobLimit ?? 12) * c.activity)), login_events: c.loginLag === null ? 0 : rand() < 0.4 ? between(rand, 1, 3) : 0 });
  }
  return out;
}

const COHORT_WEIGHTS = [0.25, 0.05, 0.03, 0.2, 0.18, 0.06, 0.07, 0.04, 0.01, 0.02, 0.04, 0.05];

function cohortRows(id: string, today: string, seed: number, scale: number, statusCol: string, cntCol: string): Row[] {
  const rand = seeded(seed);
  const months = mockMonths(today).slice(-8);
  const out: Row[] = [];
  for (const ym of months) {
    const total = Math.round(scale * (0.5 + rand()));
    STATUS_ORDER.forEach((s, i) => {
      const w = i < COHORT_WEIGHTS.length ? COHORT_WEIGHTS[i] : 0.02;
      const n = Math.round(total * w * (0.5 + rand()));
      if (n > 0) out.push({ month_ym: ym, [statusCol]: s, [cntCol]: n, members: n });
    });
  }
  return out;
}

export function mockScoutCohort(id: string, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c) return [];
  return cohortRows(id, today, Number(id) * 3, ((c.scoutLimit ?? 120) * c.activity) / 8, 'status', 'cnt');
}

export function mockApplicationCohort(id: string, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c) return [];
  return cohortRows(id, today, Number(id) * 5, (c.jobLimit ?? 12) * 2 * c.activity, 'status', 'cnt');
}

const ATTR_VALUES: Record<string, string[]> = {
  japanese_level: ['6. ネイティヴ', '5. ビジネスレベル', '4. 日常会話レベル', '3. 初級', '2. 挨拶程度', '1. なし', '(未入力)'],
  english_level: ['6. ネイティヴ', '5. ビジネスレベル', '4. 日常会話レベル', '3. 初級', '1. なし', '(未入力)'],
  residence_prefecture: ['東京都', '神奈川県', '大阪府', '千葉県', '埼玉県', '愛知県', '福岡県', '日本以外', '(未入力)'],
  last_occupation_group: ['IT関連', '営業', 'アドミン系', 'マーケティング', 'コンサルティング', 'サービス・リテール系', '金融/保険/不動産系', 'エグゼクティブ/経営', 'その他の職種'],
  experienced_occupation: ['ソフトウェア開発', 'ITインフラ', '営業', '企画', '人事', '経理', 'カスタマーサポート', 'マーケティング'],
  desired_occupation: ['ソフトウェア開発', '営業', '企画', 'プロジェクトマネジメント', 'データ分析', 'マーケティング', '人事'],
  current_income_range: ['300万円以下', '301万円〜500万円', '501万円〜800万円', '801万円以上', '(未入力)'],
  desired_income_range: ['300万円以下', '301万円〜500万円', '501万円〜800万円', '801万円以上', '(未入力)'],
  age_group: ['24歳以下', '25-34歳', '35-44歳', '45-54歳', '55歳以上'],
  target_flag: ['ターゲット', 'ターゲット外', '(未入力)'],
  member_category: ['A', 'B', 'C', 'I', 'D', 'E', 'F', '(未入力)'],
};

/**
 * 会員属性（期間 from〜to・アカウント種別で集約済み。マートの memberAttributesQuery と同じ形）。
 * 月ごとに scout / view / application の 3 種を作り、2 アカウントの企業は 6:4 に分けてから合算する
 */
export function mockMemberAttributes(id: string, fromYmd: string, toYmd: string, account: string | null, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c) return [];
  const accounts = mockAccountTypes(c);
  if (account && !accounts.includes(account)) return [];
  const share = account && accounts.length > 1 ? (account === accounts[0] ? 0.6 : 0.4) : 1;
  const rand = seeded(Number(id) * 11);
  const from = monthOf(fromYmd);
  const to = monthOf(toYmd);
  const acc = new Map<string, { kind: string; attribute_type: string; attribute_value: string; scouts: number; interested_scouts: number }>();
  const add = (kind: string, type: string, value: string, n: number, interested: number) => {
    const k = `${kind}|${type}|${value}`;
    const cur = acc.get(k) ?? { kind, attribute_type: type, attribute_value: value, scouts: 0, interested_scouts: 0 };
    cur.scouts += Math.round(n * share);
    cur.interested_scouts += Math.round(interested * share);
    acc.set(k, cur);
  };
  for (const ym of mockMonths(today)) {
    const total = Math.round((c.scoutLimit ?? 120) * c.activity * (0.6 + rand() * 0.6));
    const inRange = ym >= from && ym <= to;
    for (const [type, values] of Object.entries(ATTR_VALUES)) {
      let remaining = total;
      values.forEach((v, i) => {
        const shareV = i === 0 ? 0.3 : i === values.length - 1 ? 0.08 : 0.6 / Math.max(1, values.length - 2);
        const n = Math.min(remaining, Math.round(total * shareV * (0.5 + rand())));
        remaining -= n;
        const interested = Math.round(n * (0.05 + rand() * 0.15));
        // 閲覧した会員（スカウトより多く、構成比は少し違う）、応募した会員（閲覧の 1 割弱）
        const vn = Math.round(n * (1.5 + rand() * 2) + (i % 2 === 0 ? 3 : 0));
        const an = Math.round(vn * (0.04 + rand() * 0.06));
        if (n > 0 && inRange) {
          add('scout', type, v, n, interested);
          add('view', type, v, vn, 0);
          if (an > 0) add('application', type, v, an, 0);
        }
      });
    }
  }
  return Array.from(acc.values()).filter((r) => r.scouts > 0);
}

export function mockBenchSeries(industry: string, companyType: string, today = todayJst()): Row[] {
  const out: Row[] = [];
  for (const ym of mockMonths(today)) {
    for (const r of mockIndustryBenchmark(ym, today)) {
      const ind = String(r.industry);
      const typ = String(r.company_type);
      if ((ind === industry || ind === '__ALL__') && (typ === companyType || typ === '__ALL__')) out.push({ month_ym: ym, ...r });
    }
  }
  return out;
}

export function lastDayOf(ym: string): string {
  return endOfMonth(`${ym}-01`);
}

export function pickOne<T>(xs: readonly T[], seed: number): T {
  return pick(seeded(seed), xs);
}
