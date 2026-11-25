/** 複製元: slide_creator の src/app/export/fonts.ts。変更点: 書体と太さの一覧を slides/fonts.ts から受け取る */
import { getFontEmbedCSS } from 'html-to-image';
import { SLIDE_FONTS, SLIDE_FONT_FAMILIES } from '../slides/fonts';
import { parseFontRules, type FontRule } from './fontSubset';

/** 使用する全ウェイトを一度描画してフォントの読み込みを完了させる */
export async function preloadFonts(): Promise<void> {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
  for (const [f, w] of SLIDE_FONTS) {
    const s = document.createElement('span');
    s.style.fontFamily = `'${f}'`;
    s.style.fontWeight = String(w);
    s.textContent = 'Daijob 利用実績 0123456789';
    probe.appendChild(s);
  }
  document.body.appendChild(probe);
  try {
    await Promise.all(SLIDE_FONTS.map(([f, w]) => document.fonts.load(`${w} 20px '${f}'`).catch(() => [])));
    await document.fonts.ready;
  } finally {
    probe.remove();
  }
}

/**
 * フォント埋め込み CSS を 1 回だけ計算して全スライドで使い回す（最大の高速化ポイント）。
 * getFontEmbedCSS は node 内で使われているファミリーだけを返すため、全ファミリーを含む探査ノードを渡す。
 */
export async function fontEmbedCss(): Promise<FontRule[]> {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
  for (const f of SLIDE_FONT_FAMILIES) {
    const s = document.createElement('span');
    s.style.fontFamily = `'${f}'`;
    s.textContent = 'a';
    probe.appendChild(s);
  }
  document.body.appendChild(probe);
  try {
    return parseFontRules(await getFontEmbedCSS(probe));
  } finally {
    probe.remove();
  }
}
