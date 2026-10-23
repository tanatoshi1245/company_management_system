import type { PageProps } from '../../router';
import { useSession } from '../../lib/session';
import { useResource } from '../../lib/useResource';
import { PageHeader } from '../../components/ui/PageHeader';
import { isoToJstDisplay } from '../../../shared/calendar/periods';
import { fmtYmd } from '../../lib/format';
import type { HealthResponse } from '../../../shared/schema/me';

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge ${ok ? 'good' : 'bad'}`} style={{ marginRight: 6 }}>
      {label}: {ok ? '設定済み' : '未設定'}
    </span>
  );
}

/** 設定: データの鮮度・認証情報の有無（値は出ない）。担当上書き一覧・プラン既定値は M3 で追加 */
export default function SettingsPage(_props: PageProps) {
  const { meta } = useSession();
  const health = useResource<HealthResponse>('/api/health');
  return (
    <>
      <PageHeader title="設定" context="データの鮮度と、この Worker に届いている設定" />
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>データの鮮度</h2>
          </div>
          {meta ? (
            <dl className="defs">
              <dt>マート更新（版）</dt>
              <dd>
                <code>{meta.dataVersion}</code> {isoToJstDisplay(meta.refreshedAt) ?? ''}{' '}
                {meta.refreshStatus === 'ok' ? <span className="badge good">成功</span> : meta.refreshStatus === 'error' ? <span className="badge bad">失敗</span> : <span className="badge neutral">記録なし</span>}
              </dd>
              <dt>イベントデータの最終日</dt>
              <dd>{fmtYmd(meta.dataDate)}</dd>
              <dt>当月の営業日</dt>
              <dd>
                {meta.bizDays.elapsed} / {meta.bizDays.total} 日経過（営業日消化率 {Math.round(meta.bizDays.rate * 100)}%）。祝日データ版 {meta.holidaysVersion}
              </dd>
              <dt>CS 担当の出所</dt>
              <dd>
                <code>{meta.ownerSource}</code>（画面での上書きが優先）
              </dd>
              <dt>スカウト枠の期間</dt>
              <dd>既定は月間枠。企業設定で契約期間に切替可</dd>
              <dt>応答の版数</dt>
              <dd>{meta.dataSchemaVersion}</dd>
            </dl>
          ) : null}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>この Worker の設定</h2>
            <span className="lead">値は表示しない（有無だけ）</span>
          </div>
          {health.data ? (
            <div>
              <Flag ok={health.data.googleLoginConfigured} label="Google ログイン" />
              <Flag ok={health.data.bqKeyConfigured} label="BigQuery 鍵" />
              <Flag ok={health.data.d1Configured} label="D1" />
              <p className="small muted" style={{ marginTop: 10 }}>
                認証方式: {health.data.authMode} / 許可ドメイン: {health.data.allowedDomains.join(', ') || '（制限なし）'} / 個別許可 {health.data.allowedEmailsCount} 件
                {health.data.mock ? ' / サンプルデータで動作中' : ''}
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
