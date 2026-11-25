import { forwardRef, memo, useLayoutEffect, useRef, useState } from 'react';
import type { ReportSlide } from '../../../../../shared/ai/report';
import { SlideBody, type SlideContext } from './layouts';

interface Props {
  slide: ReportSlide;
  /** 1 始まりのページ番号 */
  page: number;
  total: number;
  ctx: SlideContext;
}

/**
 * 1 枚のスライド（1920×1080 の実寸）。複製元: slide_creator の src/app/slides/SlideCanvas.tsx。
 * memo: 入力が同じなら描き直さない（描くたびに SlideFrame の文字の自動調整が走り、何度もレイアウトを測るため）。
 */
export const ReportSlideView = memo(
  forwardRef<HTMLElement, Props>(function ReportSlideView({ slide, page, total, ctx }, ref) {
    return (
      <section ref={ref} className={`dj-slide${slide.layout === 'cover' ? ' slide--cover' : ''}`} lang="ja" data-layout={slide.layout} data-testid="slide" style={{ width: 1920, height: 1080, position: 'relative' }}>
        <SlideBody slide={slide} page={page} total={total} ctx={ctx} />
      </section>
    );
  }),
);

/** 置かれた幅に合わせて縮めて出す（16:9 の箱。中身は実寸のスライドを transform で縮める） */
export function ScaledSlide(p: Props & { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / 1920);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={`rs-stage ${p.className ?? ''}`}>
      <div className="rs-stage-inner" style={{ transform: `scale(${scale})` }}>
        <ReportSlideView slide={p.slide} page={p.page} total={p.total} ctx={p.ctx} />
      </div>
    </div>
  );
}
