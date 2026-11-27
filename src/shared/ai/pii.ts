/**
 * 入力に、社名・個人情報（氏名・メールアドレス・電話番号）が入っていないかの確認（②③ の貼り付け欄と補足）。
 * 画面（入力中の注意）と Worker（保存の前）で同じ関数を使う。
 *   block … 確実に入っている（メールアドレス・電話番号・選んだ企業の名前）。保存しない
 *   warn  … 入っていそう（「株式会社」「〜様」など）。画面で注意を出し、確かめてもらう（保存は止めない）
 * 目安の判定で、確実ではない。差し込み（{{候補者名}} {{企業名}} など）は対象外。
 */

export interface PiiFinding {
  level: 'block' | 'warn';
  /** 何が見つかったか（画面に出す文。見つかった文字そのものは長くても 20 文字まで） */
  message: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;
/** 電話番号（国内の固定・携帯・フリーダイヤル、+81）。年収や ID の数字の並びを拾わないよう、区切りのある形と 0 始まりの 10〜11 桁だけ */
const PHONE = /(\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})|(\(?0\d{1,4}\)?[-\s]\d{1,4}[-\s]\d{3,4})|(?<!\d)0[5789]0\d{8}(?!\d)/;
const COMPANY_WORD = /(株式会社|有限会社|合同会社|㈱|\(株\)|（株）)/;
const COMPANY_WORD_EN = /\b(Inc|Corp|Co\.,? ?Ltd|LLC|K\.K|GmbH)\b\.?/i;
/** 「〇〇様」「〇〇さま」（「お客様」「皆様」「同様」「仕様」などは外す） */
const HONORIFIC = /[一-龠ァ-ヶA-Za-z](?<![客皆同多仕模各])(様|さま)(?![々子式相])/;
const PLACEHOLDER = /\{\{[^{}]{1,20}\}\}/g;

const clip = (s: string) => (s.length > 20 ? `${s.slice(0, 20)}…` : s);

/** 企業名から、照合に使う言葉を作る（法人格・空白を落とした名前。2 文字未満は誤検知になるので使わない） */
export function companyNeedles(names: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    if (!raw) continue;
    const full = raw.trim();
    const core = full.replace(/(株式会社|有限会社|合同会社|㈱|\(株\)|（株）)/g, '').replace(/\b(Inc|Corp|Co\.,? ?Ltd|LLC|K\.K|GmbH)\b\.?/gi, '').replace(/[\s　,.]+/g, ' ').trim();
    for (const n of [full, core]) if (n.length >= 2 && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * text の中の社名・個人情報を探す。companyNames = 選んだ企業の名前（表示名・内部名）。
 * 同じ種類の指摘は 1 つにまとめる。
 */
export function findPii(text: string, companyNames: readonly (string | null | undefined)[] = []): PiiFinding[] {
  const body = text.replace(PLACEHOLDER, ' ');
  const out: PiiFinding[] = [];
  const email = EMAIL.exec(body);
  if (email) out.push({ level: 'block', message: `メールアドレスが入っています（${clip(email[0])}）` });
  const phone = PHONE.exec(body);
  if (phone) out.push({ level: 'block', message: `電話番号が入っています（${clip(phone[0])}）` });
  const lower = body.toLowerCase();
  const hit = companyNeedles(companyNames).find((n) => lower.includes(n.toLowerCase()));
  if (hit) out.push({ level: 'block', message: `企業名が入っています（${clip(hit)}）。{{企業名}} に置き換えてください` });
  if (!hit && (COMPANY_WORD.test(body) || COMPANY_WORD_EN.test(body))) out.push({ level: 'warn', message: '社名らしい書き方があります（「株式会社」など）。{{企業名}} に置き換えてください' });
  if (HONORIFIC.test(body)) out.push({ level: 'warn', message: '個人名らしい書き方があります（「〇〇様」）。{{候補者名}} などに置き換えてください' });
  return out;
}

export const hasBlockingPii = (findings: readonly PiiFinding[]): boolean => findings.some((f) => f.level === 'block');
