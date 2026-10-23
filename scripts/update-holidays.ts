/**
 * 祝日マスタ（src/shared/calendar/jp-holidays.json）の更新補助。
 * 内閣府の CSV（https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv、Shift_JIS）を手元にダウンロードして渡す:
 *   npx tsx scripts/update-holidays.ts /path/to/syukujitsu.csv
 * 当年 ± の祝日を JSON に書き戻し、version を今日の年月にする。年末年始（companyClosed）は変えない。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('使い方: npx tsx scripts/update-holidays.ts <syukujitsu.csv>');
  process.exit(2);
}
const text = new TextDecoder('shift_jis').decode(readFileSync(file));
const byYear: Record<string, string[]> = {};
for (const line of text.split(/\r?\n/).slice(1)) {
  const [raw] = line.split(',');
  const m = raw?.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) continue;
  (byYear[m[1]] ??= []).push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
}
const path = resolve(process.cwd(), 'src/shared/calendar/jp-holidays.json');
const json = JSON.parse(readFileSync(path, 'utf8')) as { version: string; holidays: Record<string, string[]>; companyClosed: string[]; source: string };
const thisYear = new Date().getFullYear();
for (const y of [thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map(String)) if (byYear[y]) json.holidays[y] = byYear[y].sort();
json.version = new Date().toISOString().slice(0, 7);
writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
console.log(`更新: version ${json.version}、年: ${Object.keys(json.holidays).join(', ')}`);
