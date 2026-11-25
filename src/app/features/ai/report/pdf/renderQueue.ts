/** 複製元: slide_creator の src/app/export/renderQueue.ts（変更なし） */
import { toJpeg, toPng } from 'html-to-image';
import { fontCssForText, type FontRule } from './fontSubset';

export interface RenderOptions {
  pixelRatio: number;
  format: 'jpeg' | 'png';
  quality?: number;
  fontEmbedCSS?: string;
  /** 指定時はスライドの文字を含むサブセットだけを埋め込む（fontEmbedCSS より優先） */
  fontRules?: FontRule[];
  signal?: AbortSignal;
}

export interface RenderedSlide {
  index: number;
  dataUrl: string;
}

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function imagesLoaded(node: HTMLElement): Promise<void> {
  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
    ),
  );
}

/** 1 枚を画像化（非縮尺の 1920×1080 ノード） */
export async function renderNode(node: HTMLElement, opts: RenderOptions): Promise<string> {
  await nextPaint();
  await imagesLoaded(node);
  const fontEmbedCSS = opts.fontRules ? fontCssForText(opts.fontRules, node.textContent ?? '') : opts.fontEmbedCSS;
  const common = { width: 1920, height: 1080, pixelRatio: opts.pixelRatio, cacheBust: false, backgroundColor: '#FFFFFF', fontEmbedCSS, skipFonts: fontEmbedCSS !== undefined };
  return opts.format === 'png' ? toPng(node, common) : toJpeg(node, { ...common, quality: opts.quality ?? 0.92 });
}

/**
 * スライドを 1 枚ずつ順番に描画して画像化する。
 * mount(index) が対象スライドをオフスクリーンの単一ノードに描画し、そのノードを返すこと。
 */
export async function* renderDeck(
  total: number,
  mount: (index: number) => Promise<HTMLElement>,
  opts: RenderOptions,
  onProgress?: (done: number, total: number) => void,
): AsyncGenerator<RenderedSlide> {
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const node = await mount(i);
    const dataUrl = await renderNode(node, opts);
    onProgress?.(i + 1, total);
    yield { index: i, dataUrl };
    await new Promise((r) => setTimeout(r, 0));
  }
}
