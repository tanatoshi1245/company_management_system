/** 複製元: slide_creator の src/app/export/fontSubset.ts（変更なし） */
/**
 * 埋め込みフォント CSS の軽量化。
 * Noto Sans JP は unicode-range ごとに 100 以上のサブセットに分かれており、html-to-image の getFontEmbedCSS は
 * 使っているファミリーの全サブセット（woff2 と woff の両方）を data URL で返す。これを全スライドの SVG に入れると
 * 1 枚ごとに数十 MB のデコードが走るため、woff2 だけを残し、スライドの文字を含むサブセットだけを渡す。
 */
export interface FontRule {
  css: string;
  /** unicode-range（無指定なら null = 常に含める） */
  ranges: [number, number][] | null;
}

/** CSS の content や記号類など、textContent に出ない可能性がある文字（常に含める） */
const ALWAYS = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:;!?%&()[]/+-–—•·→←↑↓✓×○◎△…「」『』（）・、。〜￥¥';

function parseUnicodeRange(v: string): [number, number][] {
  return v
    .split(',')
    .map((s) => s.trim().replace(/^u\+/i, ''))
    .filter(Boolean)
    .map((s): [number, number] => {
      if (s.includes('?')) return [parseInt(s.replace(/\?/g, '0'), 16), parseInt(s.replace(/\?/g, 'f'), 16)];
      const [a, b] = s.split('-');
      return [parseInt(a, 16), parseInt(b ?? a, 16)];
    })
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

/** src の候補から woff2 だけを残す（woff2 が無ければそのまま） */
// data URL の mime 部（data:font/woff2;base64）に ';' が入るため、src は url(...) format(...) の並びとして読む
const SRC_ITEM = /url\((?:"[^"]*"|'[^']*'|[^)]*)\)(?:\s*format\([^)]*\))?/gi;
const SRC_DECL = /src\s*:\s*((?:url\((?:"[^"]*"|'[^']*'|[^)]*)\)(?:\s*format\([^)]*\))?\s*,?\s*)+)/i;

function keepWoff2(block: string): string {
  const m = SRC_DECL.exec(block);
  if (!m) return block;
  const parts = m[1].match(SRC_ITEM) ?? [];
  const w2 = parts.filter((x) => /woff2/i.test(x));
  return w2.length && w2.length < parts.length ? block.replace(m[1], `${w2.join(', ')}`) : block;
}

export function parseFontRules(css: string): FontRule[] {
  return (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).map((block) => {
    const ur = /unicode-range\s*:\s*([^;}]+)/i.exec(block);
    return { css: keepWoff2(block), ranges: ur ? parseUnicodeRange(ur[1]) : null };
  });
}

/** text に含まれる文字をカバーするルールだけを連結する */
export function fontCssForText(rules: FontRule[], text: string): string {
  const cps = Array.from(new Set(Array.from(text + ALWAYS, (ch) => ch.codePointAt(0) ?? 0))).sort((a, b) => a - b);
  const hit = (a: number, b: number): boolean => {
    // cps は昇順。a 以上の最初の要素が b 以下なら交差
    let lo = 0;
    let hi = cps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cps[mid] < a) lo = mid + 1;
      else hi = mid;
    }
    return lo < cps.length && cps[lo] <= b;
  };
  return rules
    .filter((r) => !r.ranges || r.ranges.some(([a, b]) => hit(a, b)))
    .map((r) => r.css)
    .join('\n');
}
