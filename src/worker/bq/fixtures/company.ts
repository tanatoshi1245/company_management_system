import type { Row } from '../parseRows';
import { addDays, addMonths, eachDay, endOfMonth, monthOf, todayJst } from '../../../shared/calendar/periods';
import { STATUS_ORDER } from '../../../shared/labels';
import { between, pick, seeded } from './random';
import { mockCompanies, mockCompanyMaster, mockCompanyMonthly, mockCompanyLogin, mockIndustryBenchmark, mockMonths } from './board';

export function mockCompanyMasterOne(id: string, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  const row = mockCompanyMaster(today).find((r) => r.company_id === id);
  if (!c || !row) return [];
  return [{ ...row, profile_count: 2, contract_from: c.from, contract_to: c.to, sf_account_name: c.owner ? `${c.name}（SF）` : null }];
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
      return { ...r, ...st, in_selection: parts[5] + parts[6] + parts[7] + parts[8] + parts[9] };
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

export function mockMemberAttributes(id: string, fromYmd: string, today = todayJst()): Row[] {
  const c = mockCompanies(today).find((x) => String(x.id) === id);
  if (!c) return [];
  const rand = seeded(Number(id) * 11);
  const from = monthOf(fromYmd);
  const months = mockMonths(today).filter((m) => m >= from);
  const out: Row[] = [];
  for (const ym of months) {
    const total = Math.round((c.scoutLimit ?? 120) * c.activity * (0.6 + rand() * 0.6));
    for (const [type, values] of Object.entries(ATTR_VALUES)) {
      let remaining = total;
      values.forEach((v, i) => {
        const share = i === 0 ? 0.3 : i === values.length - 1 ? 0.08 : 0.6 / Math.max(1, values.length - 2);
        const n = Math.min(remaining, Math.round(total * share * (0.5 + rand())));
        remaining -= n;
        if (n > 0) out.push({ month_ym: ym, attribute_type: type, attribute_value: v, scouts: n, members: n, interested_scouts: Math.round(n * (0.05 + rand() * 0.15)) });
      });
    }
  }
  return out;
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
