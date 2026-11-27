import type { z } from 'zod';
import { findPii, type PiiFinding } from '../../../../shared/ai/pii';

/** ②③ のフォームで共通の小さな道具（zod の誤りを項目ごとに / 社名・個人情報の確認を欄ごとに） */

/** zod の誤りを「項目名 → 最初の文」にする（欄の下に出す） */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (key in out) continue;
    out[key] = issue.code === 'too_big' ? `${String(issue.maximum)} ${issue.type === 'array' ? '個' : '文字'}までです` : issue.message;
  }
  return out;
}

/**
 * 欄ごとに社名・個人情報を探し、どの欄かを頭に付けて 1 つの一覧にする（同じ文は 1 つにまとめる）。
 * companyNames = 選んだ企業の名前。
 */
export function piiByField(fields: readonly { label: string; text: string }[], companyNames: readonly (string | null | undefined)[]): PiiFinding[] {
  const out: PiiFinding[] = [];
  for (const f of fields) {
    if (!f.text.trim()) continue;
    for (const hit of findPii(f.text, companyNames)) {
      const message = `${f.label}: ${hit.message}`;
      if (!out.some((x) => x.message === message)) out.push({ level: hit.level, message });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1));
}
