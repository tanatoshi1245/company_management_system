import type { PageProps } from '../../router';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';

/** 企業詳細。M2 で実装する */
export default function CompanyPage({ params }: PageProps) {
  return (
    <>
      <PageHeader title={`企業 ${params.id}`} breadcrumb={[{ label: 'ボード', to: '/' }]} />
      <Skeleton variant="tile" rows={2} />
    </>
  );
}
