---
tags: [domain/company-behavior, domain/scout, domain/job-posting, layer/application, type/app-spec]
related:
  - "[[docs/AI機能]]"
  - "[[features/ai/scout/README]]"
  - "[[features/ai/job/README]]"
status: active
---

# features/ai/common — AI 機能の 3 画面が共用する部品

## 役割
`/ai/report`・`/ai/scout`・`/ai/job` が共用する、API の呼び出し・入力の部品・状態と履歴の表示。設計は [docs/AI機能.md](../../../../../docs/AI機能.md)。

| ファイル | 内容 |
|---|---|
| `aiApi.ts` | API とポーリング（`useAiConfig`・`useAiCompanies`・`useAiCompanyDefaults`・`useAiHistory`・`useAiJob`・`createAiJob` ほか） |
| `Combobox.tsx` | テキストの予測変換 + プルダウン（WAI-ARIA の combobox）。`Combobox`（文字の一覧）と、その本体 `ComboboxCore`（キー・ラベル・小さな説明つき） |
| `TagCombobox.tsx` | 複数を選ぶ（チップ・× で外す・自由入力も可・上限つき） |
| `CompanyCombobox.tsx` | 既存企業の選択（一覧にある企業だけ。同名は業界・種別で見分ける） |
| `TargetConditionFields.tsx` | ②③ 共通の条件（業界・掲載職種・ポジション名・年齢層・国籍・言語力・勤務地・補足） |
| `useCompanyAutofill.ts` | 企業を選んだら業界と掲載職種（上位 3 つ）を入れる。入力者が直した項目は上書きしない。企業を選び直すと入れ直す |
| `useAiWorkspace.ts` | ②③ の画面の動き（設定・企業・ジョブ 1 件・実行・立ち上げ直し・直した版の保存・履歴からの削除） |
| `AiPageHeader.tsx`・`AiJobStatus.tsx`・`AiHistory.tsx` | 見出しと知らせ / 状態（作成中・未起動・失敗・見本）/ 履歴 |
| `PiiNotice.tsx`・`formModel.ts` | 社名・個人情報の知らせ（block = 赤・warn = 黄）/ 欄ごとの確認と、zod の誤りを項目ごとにする道具 |
| `ResultParts.tsx`・`DraftEditor.tsx`・`CopyButton.tsx`・`Field.tsx` | 結果の共通部分（母集団・特徴・指摘）/ 案の表示と手直し / コピー / 入力欄の枠 |

## 依存するデータ（画面要素 → API → 元）
| 画面要素 | API | 元 |
|---|---|---|
| 見本モード・閲覧のみ・設定なしの知らせ | `GET /api/ai/config` | Worker の設定（真偽値だけ） |
| 企業の選択肢 | `GET /api/ai/companies` | ボードに出ている企業（`cms_company_master`） |
| 業界・掲載職種の自動入力と候補、直近の掲載求人 | `GET /api/ai/companies/:id/defaults` | `cms_company_master`・`cms_company_job_monthly` |
| 履歴 / 1 件 | `GET /api/ai/jobs?company=&kind=`・`GET /api/ai/jobs/:jobId` | D1 `ai_jobs` |
| 実行・立ち上げ直し・直した版・削除 | `POST /api/companies/:id/ai/jobs`・`POST /api/ai/jobs/:jobId/fire`・`PUT / DELETE /api/ai/jobs/:jobId/edited`・`DELETE /api/ai/jobs/:jobId` | D1 `ai_jobs` + `audit_log` |

年齢層・国籍・言語力・勤務地・年収の候補と、画面の文言は `src/shared/ai/options.ts`。入力と結果の型は `src/shared/ai/{common,scout,job}.ts`、社名・個人情報の確認は `src/shared/ai/pii.ts`。

## 編集するときの入口
- 候補・文言を変える → `src/shared/ai/options.ts`
- プルダウンの動き（絞り込み・キー操作・出す件数）→ `Combobox.tsx` の `ComboboxCore`
- 見た目 → `src/app/styles/ai.css`（各部品が import する。色は `tokens.css` のトークンだけ）
- 見本（保存されないことがある）は URL に入れず、`useAiWorkspace` が手元に持つ

## テスト
`tests/app/aiCommon.test.tsx`（部品と自動入力）、`tests/shared/aiPii.test.ts`（`findPii`）。画面のテストが共用する見本と fetch のモックは `tests/app/aiFixtures.ts`。
