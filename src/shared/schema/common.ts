import { z } from 'zod';
import { isYmd } from '../calendar/periods';

/**
 * 応答のデータ版数。Worker の Cache API のキーに入れ、データの形や判定ルールを変えたデプロイで旧版の応答が返らないようにする。
 * 応答の形・指標の式・ヒートマップの閾値を変えたら必ず +1 する。
 *   1: 初版（M0）
 *   2: 企業種別に 派遣 を追加（紹介（派遣含む）→ 紹介 / 派遣）、ボードの列を実数表示に変更（2026-10-23）
 *   3: companies.publishing_sites に WAWW を含む企業をマートから除外（2026-10-23）
 *   22: CT ログインから社内メンバー（company_users.email が @daijob.com）のログインを除外（最終ログイン・ログイン日数が変わる。2026-10-31）
 */
export const DATA_VERSION = 22;

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM で指定してください');
export const YmdSchema = z.string().refine((s) => isYmd(s), 'YYYY-MM-DD で指定してください');
/** 企業 ID（companies.id）。数字だけ・12 桁まで。文字列のまま扱い、SQL には INT64 パラメータで渡す */
export const CompanyIdSchema = z.string().regex(/^\d{1,12}$/);

export const AuthModeSchema = z.enum(['google', 'mock', 'none']);
export type AuthMode = z.infer<typeof AuthModeSchema>;

export interface ErrorBody {
  error: string;
  code: string;
  details?: { path: string; message: string }[];
  /** 401 のとき: ログイン画面 */
  login?: string;
}
