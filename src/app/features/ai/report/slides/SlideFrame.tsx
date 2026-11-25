import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * スライドの枠（1920×1080）。複製元: slide_creator の src/app/slides/_shared/SlideFrame.tsx。
 * 変更点: 日本語だけ（i18n を外した）・文字の手直しは結果そのものを書き換えるので applyEdits を外した・
 *        サービス名のラベルと右側の写真（会社概要）を外した・ロゴと地図の画像は public/ の直下。
 * 本文の文字の大きさの決め方（fitContent 以下）は、複製元のまま（slide_creator の docs/スライドの文字ルール.md）。
 */
export interface SlideFrameProps {
  page: number;
  total: number;
  /** 左上の章名（このアプリでは「利用実績レポート」） */
  sectionLabel: string;
  variant?: 'default' | 'cover';
  /** スライドタイトル（何のページか）。無いときは title をタイトルにし、リード文は出さない */
  kicker?: string;
  /** リード文（このページで一番言いたい結論。1〜2 行） */
  title: string;
  /** 出典（人が読める文）。本文の下に小さな注記「出典：…」として出す */
  source?: string;
  /** 数値が見本（サンプルデータ）のときの印 */
  sample?: boolean;
  contentStyle?: CSSProperties;
  /** false で本文の自動拡大・縮小を止める（既定は true） */
  fit?: boolean;
  children?: ReactNode;
}

export const FOOTER_TEXT = 'Strictly confidential · © 1998-2026 Human Resocia Co., Ltd.';
export const SAMPLE_MARK = '【サンプル】見本のデータによる表示。';

/** 本文の倍率の候補（大きい順）。最初に収まった倍率を使う */
const FIT_SCALES = [1.9, 1.8, 1.7, 1.6, 1.5, 1.42, 1.34, 1.26, 1.18, 1.1, 1, 0.94, 0.88, 0.82, 0.76];
/** 収まり判定で下端に残す余白（px・スライド座標） */
const FIT_SLACK = 6;
/**
 * 本文の文字の下限（px・スライド上の大きさ。28px = 14pt）。大きい順に試し、収まった最初の値を使う。
 * 補足は 0.72 倍、中見出し・数字は 1.2 倍を下限にする（slide.css の [data-fx]）。docs/スライドの文字ルール.md
 */
export const BODY_FLOORS = [28, 26, 24, 22, 20, 18, 16];
/** 文字の下限を保つときに、余白・図を縮めてよい限度（これより小さい倍率は使わない） */
const FLOOR_MIN_SCALE = 1;
/** 語の途中の折り返しを避けるために、余白を詰めてよい割合（収まる最大の倍率に対して） */
const STRICT_MIN_RATIO = 0.7;

/** 数字として大きく見せる要素のクラス（28px 以上でも上限をかけない） */
const DISPLAY_CLASSES = ['num', 'kpi-big', 'kpi-unit', 'm-num', 'exec-num', 'pillar-num', 'rec-num', 'display'];

/**
 * テンプレートに書いた文字サイズ（px・拡大前）から役割を決める。n = 補足、b = 本文、h = 中見出し、d = 大きな数字。
 * 28px 以上でも、数字を含まない文は中見出しにする（カードの見出しがスライドタイトルより大きくならないように）。
 */
export function textRole(px: number, display = true): 'n' | 'b' | 'h' | 'd' {
  return px < 14 ? 'n' : px < 20 ? 'b' : px < 28 || !display ? 'h' : 'd';
}

/**
 * 文字を直接持つ要素に、元の文字サイズ（--fsb）と役割（data-fx）を付ける。
 * 以後の文字サイズは slide.css が「元のサイズ × 倍率」を役割ごとの下限・上限に収めて決める。SVG（グラフ）の中は対象外。
 */
function tagText(inner: HTMLElement) {
  // 前回の印を外して、テンプレートが書いたサイズを測り直す（データで行数や大きさが変わるため）
  inner.querySelectorAll<HTMLElement>('[data-fx]').forEach((el) => {
    el.removeAttribute('data-fx');
    el.style.removeProperty('--fsb');
  });
  const found = new Map<HTMLElement, number>();
  const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent || !n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!(el instanceof HTMLElement) || found.has(el)) continue;
    found.set(el, parseFloat(getComputedStyle(el).fontSize));
  }
  for (const [el, px] of found) {
    if (!Number.isFinite(px) || px <= 0) continue;
    el.style.setProperty('--fsb', `${px}px`);
    const display = px >= 28 && (DISPLAY_CLASSES.some((c) => el.classList.contains(c)) || /\d/.test(el.textContent ?? ''));
    el.dataset.fx = textRole(px, display);
  }
}

/** 要素ごとの「自分の箱からはみ出している量」（縦・横の大きい方、px）。0 以下は収まっている */
function spill(el: HTMLElement): number {
  return Math.max(el.scrollHeight - el.clientHeight, el.scrollWidth - el.clientWidth);
}

/**
 * inner かその子孫が、自分の箱からはみ出しているか（カードから文字があふれて隣と重なる場合も含む）。
 * base は「行の高さより大きい文字」など、倍率に関係なく常に出るはみ出し量。その分は無視する
 * （grow = 文字の下限で文字が大きくなる比率の上限。常に出るはみ出しも同じ比率で増える）。
 */
function overflows(inner: HTMLElement, base: Map<HTMLElement, number> | null, grow = 1): boolean {
  if (spill(inner) > 1) return true;
  const all = inner.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!(el instanceof HTMLElement) || el.clientHeight === 0) continue;
    // 3px までは行の高さと文字の高さの差（見出しが 2 行になったときなど）なので、はみ出しとみなさない
    const d = spill(el);
    // data-fit-free の中（グラフの値ラベルなど、箱より広くてよい文字）は判定しない
    if (d > 3 && d > (base?.get(el) ?? 0) * grow + 3 && !el.closest('[data-fit-free]')) return true;
  }
  return false;
}

/** z = 余白・図を含む全体の倍率、floor = 本文の文字の下限（px・スライド上の大きさ。0 なら下限なし） */
function applyScale(inner: HTMLElement, outerH: number, z: number, floor: number, slack: number) {
  inner.style.width = `${100 / z}%`;
  inner.style.height = `${(outerH - slack) / z}px`;
  inner.style.transform = z === 1 ? 'none' : `scale(${z})`;
  inner.style.setProperty('--z', String(z));
  inner.style.setProperty('--fb', `${floor}px`);
}

/**
 * 本文を表示領域いっぱいに使う。
 *  1. 本文の文字を 14pt（28px）以上に保ったまま、余白・図だけを伸び縮みさせて収まる倍率を探す
 *  2. 収まらなければ文字の下限を 13pt、12pt … と下げて探す
 *  3. それでも収まらなければ、全体を同じ倍率で縮める（ライブデータで行数が増えても崩れないようにするため）
 */
function fitContent(outer: HTMLElement, inner: HTMLElement) {
  const h = outer.clientHeight;
  if (!h) return; // レイアウトの無い環境（テストの jsdom）では何もしない
  tagText(inner);
  // 最小倍率（いちばん余裕がある状態）でのはみ出し量を基準にする
  const min = FIT_SCALES[FIT_SCALES.length - 1];
  applyScale(inner, h, min, 0, FIT_SLACK);
  const base = new Map<HTMLElement, number>();
  const all = inner.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!(el instanceof HTMLElement) || el.clientHeight === 0) continue;
    const d = spill(el);
    if (d > 1) base.set(el, d);
  }
  const fits = (z: number, floor: number) => {
    applyScale(inner, h, z, floor, FIT_SLACK);
    // 下限で文字が大きくなる比率の上限（補足 10px が 0.72 × floor ÷ z になる場合）
    return !overflows(inner, base, Math.max(1, (0.072 * floor) / z));
  };
  let chosen: { z: number; floor: number } | null = null;
  for (const floor of BODY_FLOORS) {
    // 余白をいちばん詰めた状態で収まらなければ、この下限は無理
    if (!fits(FLOOR_MIN_SCALE, floor)) continue;
    chosen = { z: FLOOR_MIN_SCALE, floor };
    for (const z of FIT_SCALES) {
      if (z <= FLOOR_MIN_SCALE) break;
      if (fits(z, floor)) {
        chosen = { z, floor };
        break;
      }
    }
    break;
  }
  if (!chosen) {
    chosen = { z: min, floor: 0 };
    for (const z of FIT_SCALES) {
      if (z === min) break;
      if (fits(z, 0)) {
        chosen = { z, floor: 0 };
        break;
      }
    }
  }
  // 語の途中で折り返している箇所（列が細くて文節が 1 行に入らない）があれば、余白を少し詰めて解消できる倍率を探す。
  // data-strict の間は語の途中で折り返さないので、入らない語は箱からはみ出して overflows() に引っかかる
  if (chosen.floor > 0) {
    inner.dataset.strict = '1';
    if (!fits(chosen.z, chosen.floor)) {
      const lowest = Math.max(FLOOR_MIN_SCALE, chosen.z * STRICT_MIN_RATIO);
      for (const z of FIT_SCALES) {
        if (z >= chosen.z) continue;
        if (z < lowest) break;
        if (fits(z, chosen.floor)) {
          chosen = { z, floor: chosen.floor };
          break;
        }
      }
    }
    delete inner.dataset.strict;
  }
  applyScale(inner, h, chosen.z, chosen.floor, 0);
  inner.dataset.fit = String(chosen.z);
  inner.dataset.floor = String(chosen.floor);
  FIT_SIG.set(inner, textSig(inner));
}

/** 最後に文字の大きさを決めたときの、文字の幅の合計（フォントが切り替わって幅が変わったかを、軽く見分けるのに使う） */
const FIT_SIG = new WeakMap<HTMLElement, number>();
function textSig(inner: HTMLElement): number {
  const range = inner.ownerDocument.createRange();
  const walker = inner.ownerDocument.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
  let sum = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    sum += r.width + r.height;
  }
  return Math.round(sum * 10);
}

/**
 * 文字列に、フォントの unicode-range（例: "U+4E00-4EFF, U+3000-303F, U+26"）の文字が入っているか。
 * 読み取れない書き方（"U+4??" など）や範囲の指定が無いときは、入っているものとして扱う（測り直す側に倒す）
 */
export function usesRange(text: string, unicodeRange: string | undefined): boolean {
  if (!text) return false;
  const spec = (unicodeRange ?? '').trim();
  if (!spec) return true;
  const ranges: [number, number][] = [];
  for (const part of spec.split(',')) {
    const m = /^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(part.trim());
    if (!m) return true;
    const lo = parseInt(m[1], 16);
    ranges.push([lo, m[2] ? parseInt(m[2], 16) : lo]);
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function FitContent({ enabled, style, children }: { enabled: boolean; style?: CSSProperties; children?: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // 描画のたびに測り直す（文字を直すと行数が変わるため）。DOM の style を直接書き換えるだけで再描画は起こさない
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || !enabled) return;
    fitContent(outer, inner);
  });
  // Web フォントの読み込みで文字幅が変わるので、読み込み完了後にもう一度測る（日本語フォントは文字の範囲ごとに小分けで読み込まれる）
  useLayoutEffect(() => {
    if (!enabled || typeof document === 'undefined' || !document.fonts?.ready) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refit = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!alive || !outer || !inner) return;
      // 文字の幅が前に測ったときと同じなら、収まり方も同じなので測り直さない
      if (FIT_SIG.get(inner) === textSig(inner)) return;
      fitContent(outer, inner);
    };
    void document.fonts.ready.then(refit);
    const onDone = (e: Event) => {
      const loaded = (e as Event & { fontfaces?: FontFace[] }).fontfaces ?? [];
      if (!loaded.length) return;
      const text = outerRef.current?.textContent ?? '';
      if (!loaded.some((f) => usesRange(text, f.unicodeRange))) return;
      clearTimeout(timer);
      timer = setTimeout(refit, 60);
    };
    document.fonts.addEventListener?.('loadingdone', onDone);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.fonts.removeEventListener?.('loadingdone', onDone);
    };
  }, [enabled]);
  return (
    <div className="content" ref={outerRef}>
      <div className="content-fit" ref={innerRef} style={style}>
        {children}
      </div>
    </div>
  );
}

/**
 * 1920×1080 のスライド枠。左端の帯・章名・ロゴ・スライドタイトル・リード文・イエローのバー・出典の注記・フッターを含む。
 * layout ごとの部品（layouts.tsx）はこれを合成し、本文（children）だけを描く。
 */
export function SlideFrame(p: SlideFrameProps) {
  const plain = p.variant === 'cover';
  const heading = p.kicker || p.title;
  // タイトルと同じ文なら、リード文は出さない
  const lead = p.kicker && p.kicker !== p.title ? p.title : null;
  return (
    <>
      {plain && <img className="chrome-dotmap" src="/world-dotmap-light.png" alt="" />}
      <div className="chrome-accent">
        <div className="navy" />
        <div className="gold" />
      </div>
      {!plain && (
        <div className="topbar">
          <div className="section">{p.sectionLabel}</div>
        </div>
      )}
      <img className="chrome-logo" src={plain ? '/daijob-logo-on-navy.png' : '/daijob-logo-transparent.png'} alt="Daijob.com" />
      <div className="frame">
        {!plain && <h1 className="slide-title">{heading}</h1>}
        {!plain && lead && <p className="slide-lead">{lead}</p>}
        {!plain && <div className="title-rule" />}
        <FitContent enabled={!plain && p.fit !== false} style={p.contentStyle}>
          {p.children}
        </FitContent>
        {(p.source || p.sample) && (
          <div className="source body-note">
            {p.source && <span data-testid="citation">出典：{p.source}</span>}
            {p.sample && (
              <span data-testid="sample-mark">
                {p.source ? '　' : ''}
                {SAMPLE_MARK}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="chrome-footer">
        <span className="confidential">{FOOTER_TEXT}</span>
        <span className="page">{p.page}</span>
      </div>
    </>
  );
}
