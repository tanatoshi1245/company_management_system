import type { PageProps } from '../../router';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';

/** 目標一覧。M3 で実装する */
export default function TargetsListPage(_props: PageProps) {
  return (
    <>
      <PageHeader title="契約時の目標" />
      <Skeleton variant="row" rows={6} />
    </>
  );
}
