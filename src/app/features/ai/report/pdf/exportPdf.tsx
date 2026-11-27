import { createRoot } from 'react-dom/client';
import type { ReportSlide } from '../../../../../shared/ai/report';
import { ReportSlideView } from '../slides/ReportSlideView';
import type { SlideContext } from '../slides/layouts';
import { download } from './blob';
import { fontEmbedCss, preloadFonts } from './fonts';
import { buildPdf } from './pdf';
import { renderDeck } from './renderQueue';

/**
 * レポートを PDF にする（全スライドを画像にして 1 つの PDF にまとめる。ブラウザの中で作る）。
 * 複製元: slide_creator の src/app/export/usePdfExport.tsx。変更点: フックではなく関数（呼ぶ側が動的 import する。
 * html-to-image・jspdf を、PDF を作るときにだけ読み込むため）。
 * host は、画面の外でスライドを 1 枚ずつ実寸（1920×1080）で描くための要素。
 */
export interface PdfArgs {
  slides: readonly ReportSlide[];
  ctx: SlideContext;
  host: HTMLElement;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const PIXEL_RATIO = 1.5;
const frames = (n: number) => new Promise<void>((resolve) => {
  const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
});

export async function buildReportPdf({ slides, ctx, host, signal, onProgress }: PdfArgs): Promise<{ blob: Blob; pages: number }> {
  const total = slides.length;
  const root = createRoot(host);
  try {
    const mount = async (i: number): Promise<HTMLElement> => {
      root.render(<ReportSlideView key={i} slide={slides[i]} page={i + 1} total={total} ctx={ctx} />);
      await frames(2);
      // このスライドで初めて出る文字のフォント（小分けの読み込み）を待ち、文字の大きさの測り直し（SlideFrame）が終わってから撮る
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 90));
      await frames(1);
      return host.firstElementChild as HTMLElement;
    };
    onProgress?.(0, total);
    await preloadFonts();
    const fontRules = await fontEmbedCss();
    const images: { dataUrl: string; format: 'jpeg' | 'png' }[] = [];
    for await (const r of renderDeck(total, mount, { pixelRatio: PIXEL_RATIO, format: 'jpeg', fontRules, signal }, onProgress)) {
      images.push({ dataUrl: r.dataUrl, format: 'jpeg' });
    }
    return { blob: await buildPdf(images), pages: total };
  } finally {
    // 描画の途中で外さないよう、次のタスクで片付ける
    setTimeout(() => root.unmount(), 0);
  }
}

/** PDF を作ってダウンロードする */
export async function downloadReportPdf(args: PdfArgs & { filename: string }): Promise<{ pages: number }> {
  const { blob, pages } = await buildReportPdf(args);
  download(blob, args.filename);
  return { pages };
}
