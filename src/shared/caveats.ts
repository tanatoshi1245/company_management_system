import type { Caveat } from './schema/me';

/** 画面に出すデータの注記。id を指標・パネルから参照する（docs/指標定義.md と対応） */
export const CAVEATS: readonly Caveat[] = [
  { id: 'login_from', text: '企業ログイン（CT 画面）は 2026-05-15 以降のデータのみ。GA4 の到着は 1〜2 日遅れる', doc: '00_セマンティックレイヤー/既知の課題.md' },
  { id: 'status_current_only', text: '選考ステータスは現在値のみ（履歴なし）。過去月コホートの面接・採用数は今日時点の値', doc: '02_データエンジニアリング/dm_sales_company/README.md' },
  { id: 'hire_month', text: '採用月は応募月／興味あり返信月で代替している（採用日が存在しない）', doc: 'docs/指標定義.md' },
  { id: 'scout_quota_period', text: 'スカウト枠（resume_bank_scout_limit）は「月間枠」として扱う。企業設定で契約期間に切替可', doc: 'docs/指標定義.md' },
  { id: 'set_id_dedup', text: '求人数は set_id（日英セット）で重複排除した件数', doc: 'CLAUDE.md §4' },
  { id: 'contract_history', text: 'companies の契約期間は最新契約のみ。過去月の契約中判定は稼働開始日以降のスナップショットで補う', doc: '00_セマンティックレイヤー/既知の課題.md' },
  { id: 'scout_lag', text: 'スカウトは毎朝 05:00 更新のため当日分は含まない。予約中は含まれない', doc: '00_セマンティックレイヤー/既知の課題.md' },
  { id: 'sf_draft', text: 'Salesforce の契約は 49% がドラフト。契約中の判定は Daijob 側の契約期間を正とし、SF のシグナルは参考表示', doc: '00_セマンティックレイヤー/用語集.md' },
  { id: 'member_attr_current', text: 'スカウト対象の会員属性は送信時点ではなく現在のプロフィール', doc: '00_セマンティックレイヤー/既知の課題.md' },
  { id: 'industry_fallback', text: '業種は company_profiles.industry を優先し、無ければ Salesforce の業種（表記ゆれは alias で吸収）', doc: 'docs/指標定義.md' },
  { id: 'owner_source', text: 'CS 担当の既定は Salesforce 取引先の所有者。画面での上書きが優先する', doc: 'docs/指標定義.md' },
  { id: 'benchmark_small_n', text: '同業種・同種別の企業が 5 社未満のときは上位の群（業種全体／全体）の中央値で代替', doc: 'docs/指標定義.md' },
];
