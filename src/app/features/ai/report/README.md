---
tags: [domain/company-behavior, domain/scout, domain/job-posting, layer/application, type/app-spec, table/cms_company_monthly]
related:
  - "[[docs/AI機能]]"
  - "[[features/company/README]]"
  - "[[features/ai/report/slides/README]]"
  - "[[components/charts/README]]"
status: active
---

# features/ai/report — ① AI 分析とレポート生成（`/ai/report`）

## 役割
企業ページで表示している企業・期間・アカウント種別の利用状況を、セッションが分析してスライド（表紙 → 要約 → 数値 → 推移 → 比較 → 分かったこと → ご提案 → 次の一歩）にまとめる。
画面は **企業・期間・アカウント種別・補足（任意）だけ**を送る。数値は Worker がマートから集め直してセッションへ渡す（画面から数値を送らない）。
結果（スライドの並び）が返ったら、直せるスライドとして表示し、アプリの中で PDF をダウンロードできる。結果は企業単位で残り、履歴から開ける。

| ファイル | 内容 |
|---|---|
| `ReportPage.tsx` | ページ（default export）。入力（企業・期間・アカウント種別・補足）、実行、状態の表示、履歴、結果 |
| `ReportViewer.tsx` | スライドの表示（左 = サムネイル、中央 = 1 枚、右 = その 1 枚の文字の入力欄）、保存・元に戻す・PDF |
| `reportModel.ts` | 画面を持たない部分: 結果の読み取り（直した版を優先）、文字の差し替え・削除・並べ替え、保存できる形かの確認、期間の決め方、ファイル名 |
| `slides/` | スライドの枠と layout ごとの部品（slide_creator から写したもの）→ [README](./slides/README.md) |
| `pdf/` | PDF の作成（slide_creator から写したもの）→ [README](./pdf/README.md) |

## URL 状態
`/ai/report?company=<企業 ID>&from=YYYY-MM&to=YYYY-MM&account=直接|紹介|派遣&job=<ジョブ ID>`

- `company`・`from`・`to`・`account` は企業ページから引き継ぐ。`from` / `to` が無い・窓の外のときは「当月までの 3 か月」（`resolveReportPeriod`）。選べる月は直近 13 か月 + 当月（企業ページの窓と同じ）。`account` が空 = 全体。
- `job` は開いている結果。履歴から開くと入り、そのジョブの企業・期間・アカウント種別・補足が欄に戻る。サンプルデータの見本（保存されないことがある）は URL に入れない（`common/useAiWorkspace`）。

## 依存するデータ（画面要素 → API → 元）
| 画面要素 | API | 元 |
|---|---|---|
| 企業の選択肢 | `GET /api/ai/companies` | ボードに出ている企業（`cms_company_master`） |
| 期間の選択肢 | `GET /api/meta` の `month` | 当月（直近 13 か月 + 当月を画面で作る） |
| 実行 | `POST /api/companies/:id/ai/jobs`（`{kind: 'report', input: {from, to, account, note}}`） | D1 `ai_jobs`。数値は Worker が `cms_company_monthly` などから集め直す（`src/worker/ai/report/`） |
| 状態・結果 | `GET /api/ai/jobs/:jobId`（作成中は数秒おき） | D1 `ai_jobs`（`result_json`・`edited_json`） |
| 履歴 | `GET /api/ai/jobs?company=&kind=report` | D1 `ai_jobs` |
| 直した版の保存 / 取り消し | `PUT / DELETE /api/ai/jobs/:jobId/edited` | D1 `ai_jobs.edited_json` + `audit_log` |
| 表紙の企業名・期間・作成日 | ジョブの `companyName`・`input`・`createdAt` | 画面が差し込む（セッションは企業名を書かない） |

入力と結果の形は `src/shared/ai/report.ts`（スライドの layout ごとの形・文字数の上限）。

## 編集（スライドの手直し）
- 直せるのは文字だけ（タイトル・リード文・カードや表の文字・系列や項目の名前）。**推移・比較の数値は集計した値なので直せない。**
- スライドは外せる（下限 4 枚）・並べ替えられる（上へ / 下へ）。足すことはできない。
- 直した内容は結果と同じ形（`ReportResult`）で持ち、上限（zod）を超えた欄・空の必須の欄があると保存できない（どの欄かを欄の下と、サムネイルの赤い枠で示す）。
- 「保存」= ジョブの「直した版」になる（元の結果は残る）。「元に戻す」= 保存前なら変更を捨てる / 直した版があればそれを捨てて元の結果に戻す。
- PDF は、いま画面に出ている内容（保存していない変更を含む）で作る。

## 編集するときの入口
- 入力の項目を足す: `src/shared/ai/report.ts`（`ReportInputSchema`）→ `ReportPage.tsx` → Worker `src/worker/ai/report/`
- スライドの形（layout）を足す・変える: `src/shared/ai/report.ts` → `slides/layouts.tsx`（描く）→ `reportModel.ts` の `slideFields`（直せる欄）→ `ai/report/`（セッションの手順）→ `tests/app/aiReport.test.tsx`
- 見た目: `src/app/styles/ai-slide.css`（スライドの中）・`src/app/styles/ai-report.css`（画面）
- ルートと左のメニューは `src/app/router.tsx`・`components/ui/LeftRail.tsx`

## テスト
`tests/app/aiReport.test.tsx`（reportModel の関数、全 layout の描画、URL の引き継ぎ、実行の本文、文字を直して保存・元に戻す、スライドを外す）
