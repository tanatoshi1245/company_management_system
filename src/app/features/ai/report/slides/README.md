---
tags: [domain/application, layer/application, type/guide]
related:
  - "[[features/ai/report/README]]"
  - "[[components/charts/README]]"
  - "[[docs/AI機能]]"
status: active
---

# features/ai/report/slides — スライドの枠と layout ごとの部品

## 役割
レポートの結果（`src/shared/ai/report.ts` の `ReportSlide`）を、1920×1080 のスライドとして描く。
**スライドの箱とデザインは slide_creator で構築済みのものを写した**（ユーザー指示。slide_creator のファイルは変えない）。見た目（色・余白・書体・ロゴの位置・文字の大きさの役割）を変えるときは、slide_creator と食い違わないようにする。

| ファイル | 内容 |
|---|---|
| `SlideFrame.tsx` | 枠（左端の帯・章名・ロゴ・スライドタイトル・リード文・イエローのバー・本文・出典 / サンプルの注記・フッター・ページ番号）と、本文の文字の大きさの自動調整 |
| `ReportSlideView.tsx` | 1 枚のスライド（実寸）と、置かれた幅に合わせて縮めて出す `ScaledSlide` |
| `layouts.tsx` | layout ごとの本文: cover / summary / kpi / trend / bars / table / findings / proposal / next。表紙の企業名・期間・作成日は `SlideContext` で画面が差し込む |
| `charts.tsx` | スライド用のチャート（折れ線・横棒。インライン SVG）。規約と配色の検証は [components/charts/README](../../../../components/charts/README.md) |
| `fonts.ts` | 書体の読み込み（本体が読み込んでいない太さだけ）と、PDF の前に読み込みを終える一覧 |

## slide_creator から写したもの（元 → 写した先）
| 元（slide_creator） | 写した先 | 変えたところ |
|---|---|---|
| `src/app/slides/_shared/SlideFrame.tsx` | `SlideFrame.tsx` | 日本語だけ（i18n を外した）。文字の手直し（`edits.ts` の `applyEdits`）は使わない（結果そのものを書き換えるため）。サービス名のラベル・右側の写真・章扉を外した。**文字の大きさの決め方（`fitContent` 以下）はそのまま** |
| `src/app/slides/SlideCanvas.tsx` | `ReportSlideView.tsx` | テンプレートの切り替えを layout の切り替えに |
| `src/app/slides/01_intro/cover/Slide.tsx`・`_shared/KpiCard.tsx`・`_shared/ConsultTable.tsx`・`11_proposal/next_steps/Slide.tsx` | `layouts.tsx` | 同じクラス（`cover-title`・`cover-sub`・`cover-meta`・`kpi-card`・`kpi-big`・`consult-table`・`step-flow` / `step-box`）で組み直した |
| `src/app/styles/slide.css`（1380 行のうち使う部分）・`tokens.css`（`--dj-*`・書体・影） | `src/app/styles/ai-slide.css` | すべての規則を `.dj-slide` の中に閉じた（このアプリの画面のクラス名とぶつからないように）。色のトークンも `.dj-slide` に置いた（このアプリの `tokens.css` の `--dj-*`・`--accent` は値が違う）。末尾の「このアプリで足したもの」（`rs-*`）だけが新規 |
| `src/shared/slides/typefaces.ts`・`src/app/styles/global.ts` | `fonts.ts` | 書体は同じ 3 つ（日本語 = Noto Sans JP、英語の本文 = Inter、大きな数字 = Hanken Grotesk）・同じ太さ |
| `public/design-system/daijob-logo-on-navy.png`・`world-dotmap-light.png` | `public/` の直下 | 表紙のロゴと地図。本文のロゴは既存の `public/daijob-logo-transparent.png`（同じ画像） |

## 文字の大きさ（slide_creator の `docs/スライドの文字ルール.md` と同じ）
1920×1080 の 1px = 0.5pt。スライドタイトル 26pt・リード文 19pt・中見出し 17〜18pt・本文 14〜16pt・補足 10〜12pt。
本文（`.content` の中）は、拡大前の値で書く（13px 以下 = 補足、14〜19px = 本文、20〜27px = 中見出し、28px〜 = 大きな数字）。スライド上の大きさは `SlideFrame` が決める:
本文 14pt を保ったまま余白だけを伸び縮みさせ、入らないときだけ下限を 13pt、12pt … と下げ、それでも入らなければ全体を縮める。
表が上限いっぱい（6 列 × 8 行 × 40 文字）のように文字が多いと小さくなるので、そのときは画面で文字を削る。

`.dj-slide` は文字の基本の設定（16px・行間は標準）を自分で持つ。スライドの外側の要素（`.rs-stage` など）にスタイルを足すときは、スライドへ引き継がれないか確かめる。

## 依存するデータ
部品は props（`ReportSlide`・`SlideContext`）で受け取るだけ（マート・API に直接依存しない）。数値の元は [features/ai/report/README](../README.md)。

## 編集するときの入口
layout の中身 = `layouts.tsx`、色・余白 = `src/app/styles/ai-slide.css` の末尾、グラフ = `charts.tsx`（書く前に `dataviz` スキルをロードし、色を変えたら `validate_palette.js` の結果を components/charts/README.md に記録する）。

## テスト
`tests/app/aiReport.test.tsx`「スライド」（全 layout の描画）。見た目は、実寸のスライドを画像にして確かめる（文字のはみ出し・重なり）。jsdom ではレイアウトが無いので、文字の自動調整は動かない。
