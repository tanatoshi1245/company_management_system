---
tags: [domain/application, layer/application, type/guide]
related:
  - "[[README]]"
  - "[[docs/指標定義]]"
status: active
---

# components/charts — チャート規約

## 役割
インライン SVG のチャート部品（Sparkline / Bullet / SmallMultiples / HeatCell / CohortMatrix / AttributeBars / TimelineBar）。ライブラリは使わない。

## 規約（dataviz スキル準拠。実装前に必ずロードする）
- 量は 1 色（`--seq-*`）、良し悪しはヒートマップ 5 段階（`--heat-*`）と状態色（必ずラベル併記）
- 2px の線、グリッドは `--grid`、目盛は 11px の等幅数字、最終点を直接ラベル、3D・グラデーション・影なし
- `role="img"` + `aria-label`、複数系列は「表で見る」の代替を用意
- パレット検証: `validate_palette.js` の結果を本ファイル末尾に記録する（M1）

## 依存するデータ
部品は props で受け取るだけ（マートに直接依存しない）。元テーブルは各 feature の README を参照。

## テスト
tests/app/*.test.tsx の描画テスト
