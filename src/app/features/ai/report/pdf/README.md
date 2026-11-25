---
tags: [domain/application, layer/application, type/guide]
related:
  - "[[features/ai/report/README]]"
  - "[[features/ai/report/slides/README]]"
status: active
---

# features/ai/report/pdf — レポートの PDF

## 役割
全スライドを 1 枚ずつ画像にして、1 つの PDF（1 スライド = 1 ページ・1920×1080）にまとめる。ブラウザの中で作る（サーバーへ送らない）。
ファイル名は `利用実績レポート_<企業名>_<from>-<to>.pdf`（`reportModel.ts` の `pdfFilename`）。

**slide_creator の `src/app/export/` を写したもの**（slide_creator のファイルは変えない）。

| 元（slide_creator） | 写した先 | 変えたところ |
|---|---|---|
| `export/renderQueue.ts` | `renderQueue.ts` | なし |
| `export/pdf.ts` | `pdf.ts` | なし |
| `export/fontSubset.ts` | `fontSubset.ts` | なし |
| `export/blob.ts` | `blob.ts` | なし |
| `export/fonts.ts` | `fonts.ts` | 書体と太さの一覧を `slides/fonts.ts` から受け取る |
| `export/usePdfExport.tsx` | `exportPdf.tsx` | フックではなく関数（`downloadReportPdf`）。画像は JPEG・1.5 倍。1 枚ごとに、フォントの追加の読み込みと文字の大きさの測り直しを待ってから撮る |

## 読み込み
`html-to-image`・`jspdf` は重いので、`ReportViewer.tsx` が「PDF をダウンロード」を押したときに `import('./pdf/exportPdf')` で読み込む（初期の JS にも、ページのチャンクにも入れない）。
フォントは、スライドの文字を含む部分（unicode-range）だけを画像に埋め込む（`fontSubset.ts`）。

## 依存するデータ
画面に出ているスライド（`ReportSlide` の並び。保存していない変更を含む）と、表紙に差し込む内容（`SlideContext`）だけ。API・マートには依存しない。

## テスト
jsdom では画像にできないので、単体テストは無い。確かめるときは、ブラウザで 1 回作って、ページ数と見た目（グラフの文字の大きさ・日本語の書体）を見る。
