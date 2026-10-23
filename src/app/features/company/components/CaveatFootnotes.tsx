import { useSession } from '../../../lib/session';

export function CaveatFootnotes({ ids }: { ids: string[] }) {
  const { meta } = useSession();
  const items = (meta?.caveats ?? []).filter((c) => ids.includes(c.id));
  if (!items.length) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>この画面の注意点</h2>
      </div>
      <ul className="caveat-list">
        {items.map((c) => (
          <li key={c.id}>{c.text}</li>
        ))}
      </ul>
    </section>
  );
}
