// 複製元: sales_dashboard_IS-FS_ver2 の src/worker/access.ts。変更点: Cloudflare Access の JWT 検証（verifyAccessJwt / certsUrl）を削除し、許可リストだけを残した。
/**
 * アプリ側の許可リスト（Google ログインで確かめたメールに適用する）。
 *   - emails  … 個別に許可するメールアドレス（ALLOWED_EMAILS。カンマ・空白区切り）
 *   - domains … 許可するメールドメイン（ALLOWED_EMAIL_DOMAINS。`daijob.com` または `@daijob.com`。ALLOWED_EMAILS に `@daijob.com` と書いても同じ）
 * どちらも空なら制限なし。
 */
export interface AllowList {
  emails: Set<string>;
  domains: Set<string>;
  /** 何か 1 つでも設定されている */
  restricted: boolean;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function parseAllowList(emailsRaw: string | undefined, domainsRaw: string | undefined = undefined): AllowList {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const e of splitList(emailsRaw)) {
    if (e.startsWith('@')) domains.add(e.slice(1));
    else emails.add(e);
  }
  for (const d of splitList(domainsRaw)) domains.add(d.replace(/^@/, ''));
  domains.delete('');
  return { emails, domains, restricted: emails.size > 0 || domains.size > 0 };
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/** 許可リストが空なら全員許可。個別メールか、メールのドメイン（@ の後ろ。大文字小文字は無視）が一致すれば許可 */
export function isEmailAllowed(email: string, allow: AllowList): boolean {
  if (!allow.restricted) return true;
  const e = email.trim().toLowerCase();
  return allow.emails.has(e) || allow.domains.has(emailDomain(e));
}

/** 403 の文言。どのドメインなら入れるかは外部へのヒントになるので書かない（許可ドメインはログイン後の /api/health でだけ見える） */
export function notAllowedMessage(): string {
  return 'このアカウントではこのアプリを閲覧できません。会社のアカウントでログインし直すか、管理者に連絡してください';
}
