/**
 * 企業ページでいま表示している内容（企業・期間・アカウント種別）。
 * 左のレールの AI メニューが、表示中の内容を引き継ぐために読む（docs/AI機能.md。URL に無い既定の期間も引き継ぐため、解決済みの値を置く）。
 * 企業ページを離れたら null に戻す。
 */
export interface CompanyView {
  companyId: string;
  from: string;
  to: string;
  /** '' = 全体 */
  account: string;
}

let current: CompanyView | null = null;

export function setCompanyView(v: CompanyView | null): void {
  current = v;
}

export function getCompanyView(): CompanyView | null {
  return current;
}
