import type { PageProps } from '../../router';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';

/** 企業別の月別目標フォーム。M3 で実装する */
export default function TargetFormPage({ params }: PageProps) {
  return (
    <>
      <PageHeader title={`目標の編集: 企業 ${params.id}`} breadcrumb={[{ label: '目標', to: '/targets' }]} />
      <Skeleton variant="row" rows={6} />
    </>
  );
}
