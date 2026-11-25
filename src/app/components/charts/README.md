---
tags: [domain/application, layer/application, type/guide]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# components/charts — チャート規約

## 役割
インライン SVG のチャート部品（Sparkline / DualLineChart / PieChart / Bullet / HeatCell / AttributeBars / TimelineBar。Bullet / AttributeBars / TimelineBar は 2026-10-27 から未使用で保管）。ライブラリは使わない。SmallMultiples / CumulativeChart / CohortMatrix は 2026-10-23 に廃止。

## 規約（dataviz スキル準拠。実装前に必ずロードする）
- 量は 1 色（`--seq-*`）、良し悪しはヒートマップ 5 段階（`--heat-*`）と状態色（必ずラベル併記）
- **2 軸は禁止**（例外なし）。企業ページの「閲覧と応募の推移」「スカウト送信と返信の推移」も `DualLineChart` の **1 軸**で描く: 2 本の線を同じ目盛に置き、線の縦の差がそのまま件数の差になるようにする（120 と 30 の差は 120 と 60 の差より広く見える。ユーザー指示 2026-11-11。2026-10-27〜11-10 の 2 軸（右軸 = 左軸 × 比率）は廃止）
- 2px の線、グリッドは `--grid`、目盛は 11px の等幅数字、3D・グラデーション・影なし。**線の上に各点の数値は出さない**（ホバーのツールチップだけ。ユーザー指示 2026-11-11）
- `role="img"` + `aria-label`、複数系列は「表で見る」の代替を用意
- パレット検証: `validate_palette.js` の結果を本ファイル末尾に記録する

## 依存するデータ
部品は props で受け取るだけ（マートに直接依存しない）。元テーブルは各 feature の README を参照。

## テスト
tests/app/*.test.tsx の描画テスト

## パレット検証の記録（dataviz スキル `scripts/validate_palette.js`、2026-10-23）

| パレット | 値（tokens.css） | 結果 |
|---|---|---|
| 順序（量）`--seq-1…6` | `#E8ECF7 #C9D2EE #A9B8E3 #7F94D2 #4B63BE #2B3AA4` | PASS（L 単調減少、隣接ステップの ΔE ≥ 8、面との対比 OK） |
| 発散（良し悪し）`--heat-n2 … --heat-p2` | `#B3261E #EFB3AE #ECE9E4 #AFBCEA #2B3AA4` | 両腕とも中点から外へ L が単調（赤腕 L 90→45、紺腕 L 80→34）。中点は無彩色に近い暖色グレー。両端は白文字で対比 ≥ 4.5:1（白文字は ±2 だけに使う）。検証器の「順序・カテゴリ」チェックは発散には適用しない |
| 状態色（ペース・ヘルス） | `good / warn / bad` | 必ずラベル併記（`.dot` + 文字）。色だけで意味を伝えない |
| 識別色（円グラフ 8 色）`PIE_COLORS` | `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6 #e34948`（dataviz スキルの参照パレット） | `node scripts/validate_palette.js "<8 色>" --mode light`: ALL CHECKS PASS（L 帯内、CVD 最悪 ΔE 9.1 (protan) / 5.8 (tritan)、通常視 19.6）。tritan が 6 未満の隣接ペアは構成比の直接ラベル + 2px の隙間 + 凡例で補う。9 件目以降は「その他」、(未入力) はグレー |
| 識別色（2 系列の折れ線）`--cat-1 / --cat-2` | `#414AB2 #B8860B` | `node scripts/validate_palette.js "#414AB2,#B8860B" --mode light`: ALL CHECKS PASS（L 帯 0.43–0.77 内、CVD ΔE 31.8 (protan) / 26.9 (tritan)、通常視 ΔE 34.9、面との対比 ≥ 3:1）。凡例 + 最終点の直接ラベルで色だけに頼らない。`#232C95`（--seq-5）は L 帯の外で FAIL したので使わない |

ダークモードは v1 では未対応（`[data-theme='dark']` のトークンだけ残してある。対応時はダーク面で再検証する）。

## スライド用のチャート（2026-11-25。AI 分析とレポート生成）

`src/app/features/ai/report/slides/charts.tsx` に、スライド（1920×1080）の中で使う折れ線（`TrendChart`）と横棒（`BarsChart`）を足した。このディレクトリの部品は画面用（11px の目盛・画面のトークン）なので、スライド用は別に書いている（文字の大きさと配色を、写した元の slide_creator のスライドにそろえるため）。規約は同じ（dataviz スキル）。

- **1 軸だけ**。系列は 3 本まで（`src/shared/ai/report.ts` の上限）で、色は決まった順（増やさない）
- 折れ線: 2 本以上は凡例 + 最後の点の値（各点には数値を出さない）。色だけに頼らないよう、点の形を系列ごとに変える（丸・四角・ひし形）。点は白い縁つき。目盛は 0 から、きりのよい数。月のラベルは入り切らないときに間引く
- 横棒: 主 = ネイビー、比べる相手 = 青みのグレーの細い棒（凡例 + 値の文字つき）。根元は角、先だけ丸める。目盛は 0 から
- 文字は文字の色（系列の色を文字に使わない）。SVG の 1 = スライドの 1px にして、目盛 11pt・値 12pt を保つ（本文の拡大・縮小に左右されない）
- 点・棒に `<title>`（ブラウザの標準のツールチップ）。スライドは PDF にもなるので、読み取りに必要な値は凡例と値の文字で出す。表での代わりは、同じレポートの「表」のスライド

| パレット | 値 | 結果（`node scripts/validate_palette.js "<値>" --mode light --surface "#ffffff"`、2026-11-25） |
|---|---|---|
| スライドの識別色（折れ線 3 系列）`SLIDE_SERIES_COLORS` | `#3f43b0 #c98600 #0b8a4d`（slide_creator の `--dj-navy-soft`・`--dj-gold` と `--dj-gold-deep` の間・`--dj-green`） | ALL CHECKS PASS（L 帯 0.43–0.78 内、彩度 ≥ 0.1、通常視の最悪 ΔE 21.4、面との対比はすべて 3:1 以上）。CVD の最悪は `#0b8a4d`↔`#c98600` の ΔE 7.1 (protan) で WARN（6〜8 は、色以外の手がかりがあるときだけ可）→ 凡例・最後の点の値・系列ごとの点の形で補う |
| 試して使わなかった色 | `#000066 #ffb81c #0b8a4d`（コーポレートカラーそのまま） | FAIL（`#000066` と `#ffb81c` が L 帯の外、`#ffb81c` は面との対比 1.73:1）。`#3f43b0 #d08c00 #0b8a4d` は CVD 8.6 で PASS だが `#d08c00` の対比が 2.83:1 で WARN |
| スライドの横棒 `SLIDE_BAR_MAIN / SLIDE_BAR_COMPARE` | `#000066 #c9cedf`（slide_creator の `.bar-main`・`.bar-muted`） | 識別色ではない（主 + 弱めた比較）。グレーは面との対比 1.57:1 なので、凡例と値の文字（「業界の中央値 5.1」）を必ず添える |
| スライドの良し悪しの札（`good / warn / bad`） | 緑 `#0b8a4d`・イエロー `#ffb81c`・赤 `#d0342c`（カードの縁）、札は淡い地 + 濃い字 | 必ず言葉つき（良好 / 注意 / 課題）。系列の色には使わない（折れ線の 3 本目の緑は、札と同じスライドには出ない） |
