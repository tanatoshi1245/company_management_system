import type { Ctx } from '../types';

const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** ログイン系の簡単な HTML ページ（エラー表示とやり直しのリンク）。構成のヒントになる名前（Secret 名・許可ドメイン）は出さない */
export function authPage(c: Ctx, status: 400 | 401 | 403 | 503, title: string, message: string, retry = true): Response {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | 契約企業マネジメント</title>
<style>body{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;background:#F6F3F2;color:#1B1C1C;margin:0;padding:48px 16px}main{max-width:560px;margin:0 auto;background:#fff;border:1px solid #E0E0E0;padding:28px 32px}h1{font-size:18px;margin:0 0 12px;color:#000066}p{line-height:1.6;margin:0 0 12px}a.btn{display:inline-block;margin-top:8px;padding:8px 16px;border:1px solid #000066;color:#000066;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${retry ? '<a class="btn" href="/auth/login">Google でログインし直す</a>' : ''}</main></body></html>`;
  return c.html(html, status);
}
