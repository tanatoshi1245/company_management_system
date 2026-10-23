import type { PageProps } from '../../router';
import { useSession } from '../../lib/session';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { fmtMonthJa } from '../../../shared/calendar/periods';

/** ホーム（ポートフォリオボード）。M1 で KPI・注目レーン・マトリクスを実装する */
export default function HomePage(_props: PageProps) {
  const { meta } = useSession();
  return (
    <>
      <PageHeader title="契約企業ボード" context={meta ? `${fmtMonthJa(meta.month)}（営業日 ${meta.bizDays.elapsed}/${meta.bizDays.total} 経過・${Math.round(meta.bizDays.rate * 100)}%）` : null} />
      <Skeleton variant="row" rows={8} />
    </>
  );
}
