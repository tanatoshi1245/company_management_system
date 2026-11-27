import { AI_KIND_LABEL, type AiConfigResponse, type AiKind } from '../../../../shared/ai/common';
import { AI_KIND_DESCRIPTION, AI_TEXT } from '../../../../shared/ai/options';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Notice } from '../../../components/ui/Notice';
import '../../../styles/ai.css';

/** AI 機能の 3 画面で共通の見出し（機能の名前・短い説明・見本モード / 閲覧のみ / 設定なし の知らせ） */
export function AiPageHeader({ kind, config }: { kind: AiKind; config: AiConfigResponse | null }) {
  return (
    <>
      <PageHeader title={AI_KIND_LABEL[kind]} context={AI_KIND_DESCRIPTION[kind]} />
      {config?.sampleMode ? <Notice tone="info">{AI_TEXT.sampleMode}</Notice> : null}
      {config && !config.canWrite && !config.sampleMode ? <Notice tone="warn">{AI_TEXT.readOnly}</Notice> : null}
      {config && !config.fireConfigured && !config.sampleMode ? <Notice tone="warn">{AI_TEXT.fireMissing}</Notice> : null}
    </>
  );
}
