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
- **2 軸は原則禁止**。例外は企業ページの「閲覧と応募の推移」「スカウト送信と返信の推移」（ユーザー指示 2026-10-27。桁が違う）。`DualLineChart` の `dualAxis` で左 = 系列 0、右 = 系列 1 にし、目盛の数字を系列の色で塗って凡例に左軸 / 右軸を書く
- 2px の線、グリッドは `--grid`、目盛は 11px の等幅数字、最終点を直接ラベル、3D・グラデーション・影なし
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
