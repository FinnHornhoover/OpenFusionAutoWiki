import { Link, useParams } from 'react-router-dom';
import type { Item, Mission, Npc } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useEntity } from '../data/useEntity';
import ItemTemplate from '../templates/Item.mdx';
import MissionTemplate from '../templates/Mission.mdx';
import NPCTemplate from '../templates/NPC.mdx';

export default function EntityPage() {
  const { build, type, id } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes(type ?? '') ?? false;

  const { entity, loading, notFound } = useEntity<Mission | Npc | Item>(
    supported ? build : undefined,
    supported ? type : undefined,
    supported ? id : undefined,
  );

  const buildLabel = entry ? entry.displayName : build;

  if (!supported) {
    return (
      <section>
        <h1>{type}/{id}</h1>
        <p className="muted">Build: {buildLabel}</p>
        <div className="placeholder">
          {type} aren't normalized yet for this build. Coming in a later phase.
        </div>
      </section>
    );
  }
  if (loading) {
    return <section><p className="muted">Loading…</p></section>;
  }
  if (notFound || !entity) {
    return (
      <section>
        <h1>Not found</h1>
        <p>No {type?.replace(/s$/, '')} #{id} in <Link to={`/${build}/${type}`}>{buildLabel}</Link>.</p>
      </section>
    );
  }

  if (type === 'missions') {
    return (
      <section className="entity-page mission-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/missions`}>Missions</Link>
        </p>
        <MissionTemplate data={entity as Mission} />
      </section>
    );
  }

  if (type === 'npcs') {
    return (
      <section className="entity-page npc-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/npcs`}>NPCs</Link>
        </p>
        <NPCTemplate data={entity as Npc} />
      </section>
    );
  }

  if (type === 'items') {
    return (
      <section className="entity-page item-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/items`}>Items</Link>
        </p>
        <ItemTemplate data={entity as Item} />
      </section>
    );
  }

  // Shouldn't happen given `supported` gate, but keep a fallback.
  return (
    <section>
      <h1>{type}/{id}</h1>
      <pre>{JSON.stringify(entity, null, 2).slice(0, 1000)}</pre>
    </section>
  );
}
