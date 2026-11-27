import type { AiJobDetail } from '../../../../shared/ai/common';
import { REPORT_SLIDES_MIN, ReportInputSchema, ReportResultSchema, type ReportInput, type ReportResult, type ReportSlide } from '../../../../shared/ai/report';
import { addMonths, lastNMonths } from '../../../../shared/calendar/periods';
import type { SlideContext } from './slides/layouts';

/**
 * ① AI 分析とレポート生成の、画面を持たない部分（結果の読み取り・スライドの編集・ファイル名）。
 * 直した内容は、結果と同じ形（ReportResult）のまま持つ。数値（推移・比較の値）は、渡されたデータの値なので画面では直さない（文字だけ）。
 */

/** 期間の選択肢の月数（直近 13 か月 + 当月。企業ページの窓と同じ） */
export const REPORT_MONTHS = 14;
/** 期間の指定が無いときの長さ（当月までの 3 か月） */
export const REPORT_DEFAULT_SPAN = 3;

export function monthOptions(currentMonth: string): string[] {
  return lastNMonths(currentMonth, REPORT_MONTHS);
}

/** URL の from / to を確定させる（窓の外・逆順は直す。企業ページの resolvePeriod と同じ考え方） */
export function resolveReportPeriod(currentMonth: string, url: { from: string; to: string }): { from: string; to: string } {
  const months = monthOptions(currentMonth);
  const to = months.includes(url.to) ? url.to : currentMonth;
  const def = addMonths(to, -(REPORT_DEFAULT_SPAN - 1));
  let from = months.includes(url.from) ? url.from : def < months[0] ? months[0] : def;
  if (from > to) from = to;
  return { from, to };
}

/** ジョブの結果（直した版があればそれ）を読む。形が違えば null */
export function readReport(job: Pick<AiJobDetail, 'result' | 'editedResult'> | null): { result: ReportResult; edited: boolean } | null {
  if (!job) return null;
  if (job.editedResult != null) {
    const e = ReportResultSchema.safeParse(job.editedResult);
    if (e.success) return { result: e.data, edited: true };
  }
  const r = ReportResultSchema.safeParse(job.result);
  return r.success ? { result: r.data, edited: false } : null;
}

/** ジョブの入力（期間・アカウント種別・補足） */
export function readInput(job: Pick<AiJobDetail, 'input'> | null): ReportInput | null {
  if (!job) return null;
  const r = ReportInputSchema.safeParse(job.input);
  return r.success ? r.data : null;
}

/** 表紙に差し込む内容（企業名・期間・作成日は、画面がジョブから入れる） */
export function slideContext(job: Pick<AiJobDetail, 'companyName' | 'createdAt' | 'sample' | 'input'>): SlideContext {
  const input = readInput(job);
  const t = Date.parse(job.createdAt);
  // 作成日は日本時間
  const createdOn = Number.isNaN(t) ? job.createdAt.slice(0, 10) : new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
  return { companyName: job.companyName, from: input?.from ?? '', to: input?.to ?? '', account: input?.account ?? null, createdOn, sample: job.sample };
}

type Path = readonly (string | number)[];

/** 直せる文字の欄 1 つ。path はスライドの中の場所（例: ['points', 0, 'text']） */
export interface TextField {
  key: string;
  path: Path;
  label: string;
  max: number;
  required: boolean;
  multiline: boolean;
  value: string;
}

const f = (path: Path, label: string, max: number, value: string, opts: { required?: boolean; multiline?: boolean } = {}): TextField => ({
  key: path.join('.'),
  path,
  label,
  max,
  value,
  required: opts.required ?? true,
  multiline: opts.multiline ?? max > 40,
});

/** スライドの中の、直せる文字の一覧（上限は src/shared/ai/report.ts と同じ。保存できるかは zod で確かめる） */
export function slideFields(s: ReportSlide): TextField[] {
  if (s.layout === 'cover') return [f(['title'], 'タイトル', 40, s.title), f(['subtitle'], 'サブタイトル', 60, s.subtitle, { required: false })];
  const out: TextField[] = [f(['kicker'], 'スライドタイトル', 30, s.kicker), f(['lead'], 'リード文', 80, s.lead)];
  const comment = (v: string) => out.push(f(['comment'], '補足の 1 文', 120, v, { required: false }));
  switch (s.layout) {
    case 'summary':
      s.points.forEach((p, i) => out.push(f(['points', i, 'label'], `${i + 1} 見出し`, 16, p.label), f(['points', i, 'text'], `${i + 1} 本文`, 90, p.text)));
      break;
    case 'kpi':
      s.cards.forEach((k, i) =>
        out.push(
          f(['cards', i, 'label'], `${i + 1} 項目名`, 20, k.label),
          f(['cards', i, 'value'], `${i + 1} 値`, 14, k.value),
          f(['cards', i, 'unit'], `${i + 1} 単位`, 8, k.unit, { required: false }),
          f(['cards', i, 'note'], `${i + 1} 補足`, 40, k.note, { required: false, multiline: false }),
        ),
      );
      comment(s.comment);
      break;
    case 'trend':
      out.push(f(['unit'], '単位', 8, s.unit, { required: false }));
      s.series.forEach((x, i) => out.push(f(['series', i, 'name'], `系列 ${i + 1} の名前`, 20, x.name)));
      comment(s.comment);
      break;
    case 'bars':
      out.push(f(['unit'], '単位', 8, s.unit, { required: false }), f(['valueLabel'], '値の名前', 16, s.valueLabel, { required: false }), f(['compareLabel'], '比べる相手の名前', 16, s.compareLabel, { required: false }));
      s.items.forEach((x, i) => out.push(f(['items', i, 'label'], `項目 ${i + 1}`, 24, x.label)));
      comment(s.comment);
      break;
    case 'table':
      s.columns.forEach((c, i) => out.push(f(['columns', i], `列 ${i + 1} の見出し`, 16, c)));
      s.rows.forEach((r, i) => r.forEach((c, j) => out.push(f(['rows', i, j], `${i + 1} 行目・${s.columns[j] ?? `列 ${j + 1}`}`, 40, c, { required: false, multiline: false }))));
      comment(s.comment);
      break;
    case 'findings':
      s.items.forEach((x, i) => out.push(f(['items', i, 'title'], `${i + 1} 見出し`, 28, x.title), f(['items', i, 'body'], `${i + 1} 本文`, 110, x.body)));
      break;
    case 'proposal':
      s.actions.forEach((x, i) =>
        out.push(f(['actions', i, 'title'], `${i + 1} 見出し`, 28, x.title), f(['actions', i, 'body'], `${i + 1} 本文`, 110, x.body), f(['actions', i, 'effect'], `${i + 1} 期待できる変化`, 50, x.effect, { required: false })),
      );
      break;
    case 'next':
      s.steps.forEach((x, i) => out.push(f(['steps', i, 'when'], `${i + 1} いつ`, 16, x.when), f(['steps', i, 'what'], `${i + 1} 何を`, 70, x.what)));
      break;
  }
  return out;
}

function setAt(node: unknown, path: Path, value: string): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(node)) {
    const copy = node.slice();
    copy[head as number] = setAt(copy[head as number], rest, value);
    return copy;
  }
  const obj = (node ?? {}) as Record<string, unknown>;
  return { ...obj, [head]: setAt(obj[head as string], rest, value) };
}

/** index 枚目のスライドの、path の文字を差し替える（元の結果は変えない） */
export function setSlideText(result: ReportResult, index: number, path: Path, value: string): ReportResult {
  if (!result.slides[index]) return result;
  const slides = result.slides.slice();
  slides[index] = setAt(slides[index], path, value) as ReportSlide;
  return { ...result, slides };
}

/** スライドを 1 枚外せるか（下限 = REPORT_SLIDES_MIN 枚） */
export const canRemoveSlide = (result: ReportResult): boolean => result.slides.length > REPORT_SLIDES_MIN;

export function removeSlide(result: ReportResult, index: number): ReportResult {
  if (!canRemoveSlide(result) || !result.slides[index]) return result;
  return { ...result, slides: result.slides.filter((_s, i) => i !== index) };
}

/** 上へ（-1）/ 下へ（+1）。端では何もしない */
export function moveSlide(result: ReportResult, index: number, dir: -1 | 1): ReportResult {
  const to = index + dir;
  if (!result.slides[index] || to < 0 || to >= result.slides.length) return result;
  const slides = result.slides.slice();
  [slides[index], slides[to]] = [slides[to], slides[index]];
  return { ...result, slides };
}

export interface ReportIssue {
  /** 何枚目か（0 始まり）。スライドの外（要約・枚数）は null */
  slide: number | null;
  /** スライドの中の場所（TextField.key と同じ書き方） */
  key: string;
  message: string;
}

/** 保存できる形か（zod の上限・必須）。保存するのは、検証を通った後の値（前後の空白を落としたもの） */
export function validateReport(result: ReportResult): { ok: true; result: ReportResult } | { ok: false; issues: ReportIssue[] } {
  const r = ReportResultSchema.safeParse(result);
  if (r.success) return { ok: true, result: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => {
      const inSlide = i.path[0] === 'slides' && typeof i.path[1] === 'number';
      const message = i.code === 'too_big' ? `${String(i.maximum)} ${i.type === 'array' ? '個' : '文字'}までです` : i.code === 'too_small' ? (i.type === 'array' ? `${String(i.minimum)} 個以上にしてください` : '入力してください') : i.message;
      return { slide: inSlide ? (i.path[1] as number) : null, key: (inSlide ? i.path.slice(2) : i.path).join('.'), message };
    }),
  };
}

export const sameReport = (a: ReportResult | null, b: ReportResult | null): boolean => JSON.stringify(a) === JSON.stringify(b);

const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);

/** ダウンロードのファイル名: 利用実績レポート_<企業名>_<from>-<to>.pdf */
export function pdfFilename(companyName: string, from: string, to: string): string {
  return `利用実績レポート_${safeName(companyName) || '企業'}_${from}-${to}.pdf`;
}
