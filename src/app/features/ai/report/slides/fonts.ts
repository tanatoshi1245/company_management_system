/**
 * スライドの書体（slide_creator の src/shared/slides/typefaces.ts と同じ 3 つ・同じ太さ）。
 * アプリの本体（main.tsx）が読み込んでいない太さだけを、このページのチャンクで足す。
 *   Noto Sans JP 400 / 500 / 700 / 800、Inter 400 / 600 / 700 / 800、Hanken Grotesk 600 / 800
 */
import '@fontsource/noto-sans-jp/800.css';
import '@fontsource/inter/800.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/800.css';

/** PDF を作る前に読み込みを終えておく書体と太さ（pdf/fonts.ts） */
export const SLIDE_FONTS: readonly [string, number][] = [
  ['Noto Sans JP', 400],
  ['Noto Sans JP', 500],
  ['Noto Sans JP', 700],
  ['Noto Sans JP', 800],
  ['Inter', 400],
  ['Inter', 600],
  ['Inter', 700],
  ['Inter', 800],
  ['Hanken Grotesk', 600],
  ['Hanken Grotesk', 800],
];
export const SLIDE_FONT_FAMILIES = ['Noto Sans JP', 'Inter', 'Hanken Grotesk'] as const;
