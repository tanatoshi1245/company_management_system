import type { PageProps } from '../../router';
import { useSession } from '../../lib/session';
import { PageHeader } from '../../components/ui/PageHeader';
import { DefinitionsList } from './components/DefinitionsList';

/** 指標の定義と注意事項。指標レジストリ（src/shared/metrics/definitions.ts）から生成 */
export default function HelpPage(_props: PageProps) {
  const { meta } = useSession();
  return (
    <>
      <PageHeader title="指標の定義と注意事項" context="画面の数字の式と、元データの注意点" />
      <DefinitionsList />
      <section className="card" id="caveats">
        <div className="card-head">
          <h2>データの注意点</h2>
        </div>
        <ul className="caveat-list">
          {(meta?.caveats ?? []).map((c) => (
            <li key={c.id} id={`caveat-${c.id}`}>
              {c.text} <span className="muted">（{c.doc}）</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
