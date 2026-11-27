import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiJobDetail } from '../../../../shared/ai/common';
import { REPORT_LAYOUT_LABEL, type ReportResult } from '../../../../shared/ai/report';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Notice } from '../../../components/ui/Notice';
import { canRemoveSlide, moveSlide, pdfFilename, removeSlide, sameReport, setSlideText, slideContext, slideFields, validateReport } from './reportModel';
import { ScaledSlide } from './slides/ReportSlideView';
import './slides/fonts';
import '../../../styles/ai-slide.css';
import '../../../styles/ai-report.css';

/**
 * スライドの表示・編集・PDF のダウンロード。左 = サムネイルの列、中央 = 選んだ 1 枚、右 = その 1 枚の文字の入力欄。
 * 直した内容は結果と同じ形（ReportResult）で持ち、「保存」でジョブの「直した版」になる。数値（推移・比較の値）は直さない。
 */
export function ReportViewer({ job, result, edited, canEdit, onSave, onClearEdited }: { job: AiJobDetail; result: ReportResult; edited: boolean; canEdit: boolean; onSave: (result: unknown) => Promise<void>; onClearEdited: () => Promise<void> }) {
  const [draft, setDraft] = useState<ReportResult>(result);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [pdf, setPdf] = useState<{ done: number; total: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // 保存・元に戻す・別のジョブで、元の結果が変わったら、手元の内容を合わせる
  useEffect(() => {
    setDraft(result);
  }, [result]);
  useEffect(() => {
    setIndex(0);
    setMessage(null);
  }, [job.id]);

  const total = draft.slides.length;
  const cur = Math.min(index, total - 1);
  const slide = draft.slides[cur];
  const ctx = useMemo(() => slideContext(job), [job]);
  const dirty = !sameReport(draft, result);
  const check = useMemo(() => validateReport(draft), [draft]);
  const issues = check.ok ? [] : check.issues;
  const fields = useMemo(() => slideFields(slide), [slide]);
  const issueOf = (key: string) => issues.find((i) => i.slide === cur && i.key === key)?.message ?? null;
  const badSlides = Array.from(new Set(issues.filter((i) => i.slide !== null).map((i) => (i.slide as number) + 1))).sort((a, b) => a - b);

  const save = async () => {
    if (!check.ok) return;
    setSaving(true);
    setMessage(null);
    try {
      await onSave(check.result);
      setMessage({ tone: 'info', text: '保存しました' });
    } catch (e) {
      setMessage({ tone: 'error', text: `保存できませんでした（${e instanceof Error ? e.message : String(e)}）` });
    } finally {
      setSaving(false);
    }
  };
  const revert = async () => {
    setMessage(null);
    if (!edited) {
      setDraft(result);
      return;
    }
    setSaving(true);
    try {
      await onClearEdited();
      setMessage({ tone: 'info', text: '元の結果に戻しました' });
    } catch (e) {
      setMessage({ tone: 'error', text: `元に戻せませんでした（${e instanceof Error ? e.message : String(e)}）` });
    } finally {
      setSaving(false);
    }
  };
  const download = async () => {
    const host = hostRef.current;
    if (!host || pdf) return;
    setMessage(null);
    setPdf({ done: 0, total });
    try {
      // html-to-image・jspdf は、PDF を作るときにだけ読み込む
      const { downloadReportPdf } = await import('./pdf/exportPdf');
      const { pages } = await downloadReportPdf({ slides: draft.slides, ctx, host, filename: pdfFilename(job.companyName, ctx.from, ctx.to), onProgress: (done, t) => setPdf({ done, total: t }) });
      setMessage({ tone: 'info', text: `PDF を作成しました（${pages} ページ）` });
    } catch (e) {
      setMessage({ tone: 'error', text: `PDF を作成できませんでした（${e instanceof Error ? e.message : String(e)}）` });
    } finally {
      setPdf(null);
    }
  };
  const go = (i: number) => setIndex(Math.max(0, Math.min(total - 1, i)));

  return (
    <section className="card air-viewer" aria-label="スライド">
      <div className="card-head">
        <h2 className="card-title">
          スライド <span className="num muted">{total} 枚</span>
          {edited ? <Badge tone="navy">直した版</Badge> : null}
          {dirty ? <Badge tone="warn">未保存の変更あり</Badge> : null}
        </h2>
        <div className="air-actions">
          <Button variant="primary" size="sm" onClick={() => void save()} loading={saving} disabled={!canEdit || !dirty || !check.ok} title={!canEdit ? '保存には Google ログインが必要です' : !check.ok ? '上限を超えた欄・空の欄を直すと保存できます' : undefined}>
            保存
          </Button>
          <Button size="sm" onClick={() => void revert()} disabled={saving || (!dirty && !(edited && canEdit))} title={edited ? '直した版を捨てて、セッションが作った結果に戻します' : '保存していない変更を捨てます'}>
            元に戻す
          </Button>
          <Button size="sm" onClick={() => void download()} disabled={pdf !== null}>
            {pdf ? `PDF を作成中… ${pdf.done} / ${pdf.total}` : 'PDF をダウンロード'}
          </Button>
        </div>
      </div>
      {pdf ? <progress className="air-progress" max={pdf.total} value={pdf.done} aria-label="PDF の作成の進み具合" /> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {badSlides.length ? (
        <Notice tone="warn">
          {badSlides.join('・')} 枚目に、上限を超えた欄か空の欄があります。直すと保存できます
        </Notice>
      ) : !check.ok ? (
        <Notice tone="warn">{issues[0]?.message ?? '保存できない形です'}</Notice>
      ) : null}
      <div className="air-grid">
        <ol className="air-thumbs" aria-label="スライドの一覧">
          {draft.slides.map((s, i) => (
            <li key={i}>
              <button type="button" className={`air-thumb${i === cur ? ' on' : ''}${badSlides.includes(i + 1) ? ' bad' : ''}`} aria-current={i === cur ? 'true' : undefined} aria-label={`${i + 1} 枚目 ${REPORT_LAYOUT_LABEL[s.layout]}`} onClick={() => go(i)}>
                <ScaledSlide slide={s} page={i + 1} total={total} ctx={ctx} />
                <span className="air-thumb-label">
                  <span className="num">{i + 1}</span> {REPORT_LAYOUT_LABEL[s.layout]}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="air-main">
          <div className="air-main-slide" data-testid="main-slide">
            <ScaledSlide slide={slide} page={cur + 1} total={total} ctx={ctx} />
          </div>
          <div className="air-nav">
            <Button size="sm" onClick={() => go(cur - 1)} disabled={cur === 0} aria-label="前のスライド">
              ← 前へ
            </Button>
            <span className="num" aria-live="polite">
              {cur + 1} / {total}（{REPORT_LAYOUT_LABEL[slide.layout]}）
            </span>
            <Button size="sm" onClick={() => go(cur + 1)} disabled={cur >= total - 1} aria-label="次のスライド">
              次へ →
            </Button>
            <span className="air-nav-ops">
              <Button
                size="sm"
                variant="ghost"
                disabled={cur === 0}
                onClick={() => {
                  setDraft((d) => moveSlide(d, cur, -1));
                  go(cur - 1);
                }}
              >
                上へ
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={cur >= total - 1}
                onClick={() => {
                  setDraft((d) => moveSlide(d, cur, 1));
                  go(cur + 1);
                }}
              >
                下へ
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!canRemoveSlide(draft)}
                title={canRemoveSlide(draft) ? 'このスライドを外します（保存するまでは「元に戻す」で戻せます）' : 'これ以上は外せません（4 枚まで）'}
                onClick={() => {
                  setDraft((d) => removeSlide(d, cur));
                  go(Math.min(cur, total - 2));
                }}
              >
                このスライドを外す
              </Button>
            </span>
          </div>
        </div>
        <form className="air-edit" aria-label={`${cur + 1} 枚目の文字`} onSubmit={(e) => e.preventDefault()}>
          <h3>{cur + 1} 枚目の文字を直す</h3>
          {slide.layout === 'cover' ? <p className="air-hint">企業名・期間・作成日は、画面が自動で入れます。</p> : null}
          {slide.layout === 'trend' || slide.layout === 'bars' ? <p className="air-hint">グラフの数値は集計した値なので、ここでは直せません。</p> : null}
          {fields.map((fd) => {
            const err = issueOf(fd.key);
            const id = `air-f-${cur}-${fd.key}`;
            const over = fd.value.trim().length > fd.max;
            const common = { id, value: fd.value, 'aria-invalid': err ? true : undefined, onChange: (e: { target: { value: string } }) => setDraft((d) => setSlideText(d, cur, fd.path, e.target.value)) } as const;
            return (
              <div key={fd.key} className={`air-field${err ? ' has-error' : ''}`}>
                <label htmlFor={id}>
                  <span>{fd.label}</span>
                  <span className={`num air-count${over ? ' over' : ''}`}>
                    {fd.value.trim().length} / {fd.max}
                  </span>
                </label>
                {fd.multiline ? <textarea className="ctl" rows={fd.max > 100 ? 4 : fd.max > 60 ? 3 : 2} {...common} /> : <input className="ctl" type="text" {...common} />}
                {err ? (
                  <div className="air-err" role="alert">
                    {err}
                  </div>
                ) : null}
              </div>
            );
          })}
        </form>
      </div>
      {/* PDF 用に、画面の外でスライドを 1 枚ずつ実寸で描く場所 */}
      <div className="air-offscreen" aria-hidden="true">
        <div ref={hostRef} />
      </div>
    </section>
  );
}
