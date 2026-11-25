/**
 * AI 機能のセッションが、結果（または失敗）を Worker へ返す。
 *   npm run ai:submit -- --kind <report|scout|job> --url <result の URL> --token <合言葉> --file <結果の JSON> [--dry]
 *   npm run ai:submit -- --kind <…> --url <…> --token <…> --fail "<理由>"
 * 送る前に、形（src/shared/ai/<kind>.ts の ResultSchema）と、メールアドレス・電話番号が入っていないか（findPii）を確かめる。
 * 形が違えば項目ごとの理由を出して送らない。--dry は検証だけ（--url・--token は要らない）。
 * 送る先は Worker の /hook/ai/jobs/<id>/result だけ。合言葉は出力しない。
 */
import { readFileSync } from 'node:fs';
import type { ZodTypeAny } from 'zod';
import { AI_KINDS, AI_RESULT_MAX_BYTES, AiFailureSchema, type AiKind } from '../../src/shared/ai/common';
import { JobResultSchema } from '../../src/shared/ai/job';
import { findPii } from '../../src/shared/ai/pii';
import { ReportResultSchema } from '../../src/shared/ai/report';
import { ScoutResultSchema } from '../../src/shared/ai/scout';
import { ensureProxyEnv } from './bq';
import { UsageError, checkHookUrl, checkToken, collectStrings, one, parseArgs } from './lib';

export const RESULT_SCHEMAS: Record<AiKind, ZodTypeAny> = { report: ReportResultSchema, scout: ScoutResultSchema, job: JobResultSchema };

export interface Checked {
  ok: boolean;
  /** 送る本文（ok のとき） */
  body: unknown;
  errors: string[];
  warnings: string[];
}

/** 結果の検証（形・大きさ・個人情報）。送信はしない */
export function checkResult(kind: AiKind, raw: unknown): Checked {
  const parsed = RESULT_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    return { ok: false, body: null, warnings: [], errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(全体)'}: ${i.message}`) };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data), 'utf8');
  if (bytes > AI_RESULT_MAX_BYTES) errors.push(`結果が大きすぎます（${bytes} バイト。上限 ${AI_RESULT_MAX_BYTES}）`);
  for (const { path, text } of collectStrings(parsed.data)) {
    for (const f of findPii(text)) (f.level === 'block' ? errors : warnings).push(`${path}: ${f.message}`);
  }
  return { ok: errors.length === 0, body: parsed.data, errors, warnings };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ['dry']);
  const kind = one(args, 'kind') as AiKind | undefined;
  if (!kind || !AI_KINDS.includes(kind)) throw new UsageError('--kind は report / scout / job のどれかです');
  const fail = one(args, 'fail');
  const file = one(args, 'file');
  const dry = args.flags.has('dry');
  if ((fail === undefined) === (file === undefined)) throw new UsageError('--file <結果の JSON> か --fail "<理由>" のどちらか 1 つを指定してください');

  let body: unknown;
  if (fail !== undefined) {
    const f = AiFailureSchema.safeParse({ ok: false, error: fail });
    if (!f.success) throw new UsageError('--fail の理由は 1〜500 文字です');
    if (findPii(f.data.error).some((x) => x.level === 'block')) throw new UsageError('--fail の理由に、メールアドレス・電話番号・企業名を書かないでください');
    body = f.data;
  } else {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file as string, 'utf8'));
    } catch (e) {
      throw new UsageError(`結果のファイルが JSON として読めません: ${e instanceof Error ? e.message : ''}`);
    }
    const c = checkResult(kind, raw);
    for (const w of c.warnings) console.error(`注意: ${w}`);
    if (!c.ok) {
      console.error('形が違うので送りません。直してからやり直してください:');
      for (const e of c.errors) console.error(`  - ${e}`);
      process.exit(4);
    }
    body = c.body;
    console.error(`検証 OK（${kind}。注意 ${c.warnings.length} 件）`);
  }
  if (dry) {
    console.error('--dry なので送っていません');
    return;
  }

  const urlRaw = one(args, 'url');
  if (!urlRaw) throw new UsageError('--url（result の URL）がありません');
  const url = checkHookUrl(urlRaw, 'result');
  const token = checkToken(one(args, 'token') ?? process.env.AI_HOOK_TOKEN);
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`受け取ってもらえませんでした（HTTP ${res.status}）: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  console.error(fail !== undefined ? '失敗を報告しました' : '結果を返しました');
}

// テストから checkResult だけを読むときは動かさない
if (process.argv[1] && /submit\.ts$/.test(process.argv[1])) {
  ensureProxyEnv();
  main().catch((e: unknown) => {
    console.error(e instanceof UsageError ? e.message : `失敗: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(e instanceof UsageError ? 2 : 1);
  });
}
