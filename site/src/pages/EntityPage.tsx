import { Link, useParams } from 'react-router-dom';
import EntityPageSkeleton from '../components/EntityPageSkeleton';
import ErrorState from '../components/ErrorState';
import type { Area, Code, InfectedZone, Instance, Item, Mission, Mob, Nano, Npc, NpcAmbiguity } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useDelayedFlag } from '../data/useDelayedFlag';
import { useDocumentTitle } from '../data/useDocumentTitle';
import { useEntity } from '../data/useEntity';
import AreaTemplate from '../templates/Area.mdx';
import CodeTemplate from '../templates/Code.mdx';
import InfectedZoneTemplate from '../templates/InfectedZone.mdx';
import InstanceTemplate from '../templates/Instance.mdx';
import ItemTemplate from '../templates/Item.mdx';
import MissionTemplate from '../templates/Mission.mdx';
import MonsterTemplate from '../templates/Monster.mdx';
import NanoTemplate from '../templates/Nano.mdx';
import NPCTemplate from '../templates/NPC.mdx';
import NPCAmbiguityTemplate from '../templates/NPCAmbiguity.mdx';

export default function EntityPage() {
  const { build, type, id } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes(type ?? '') ?? false;

  const { entity, loading, notFound, error } = useEntity<Mission | Npc | NpcAmbiguity | Item | Mob | Area | Code | Instance | InfectedZone | Nano>(
    supported ? build : undefined,
    supported ? type : undefined,
    supported ? id : undefined,
  );
  const showSkeleton = useDelayedFlag(loading);

  const buildLabel = entry ? entry.displayName : build;
  const entityName = (entity as { name?: string } | null)?.name;
  const typeLabel = type ? type.charAt(0).toUpperCase() + type.replace(/s$/, '').slice(1) : '';
  useDocumentTitle(
    entityName ? `${entityName} · ${typeLabel} · ${buildLabel ?? ''}`.trim() : null,
  );

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
  if (error) {
    return (
      <section>
        <ErrorState
          title={`Couldn't load this ${type?.replace(/s$/, '') ?? 'entity'}`}
          message="The data file failed to load. This may be a temporary network issue."
          detail={error}
        />
      </section>
    );
  }
  if (loading) {
    // Hide the skeleton entirely for fast/cache-hit loads — only show after
    // ~200ms so the user doesn't see a flash.
    return showSkeleton ? <EntityPageSkeleton /> : null;
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
        {'kind' in (entity as object) && (entity as NpcAmbiguity).kind === 'npc-ambiguity'
          ? <NPCAmbiguityTemplate data={entity as NpcAmbiguity} build={build} />
          : <NPCTemplate data={entity as Npc} />}
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

  if (type === 'codes') {
    return (
      <section className="entity-page code-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/codes`}>Codes</Link>
        </p>
        <CodeTemplate data={entity as Code} />
      </section>
    );
  }

  if (type === 'monsters') {
    return (
      <section className="entity-page monster-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/monsters`}>Monsters</Link>
        </p>
        <MonsterTemplate data={entity as Mob} />
      </section>
    );
  }

  if (type === 'areas') {
    return (
      <section className="entity-page area-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/areas`}>Areas</Link>
        </p>
        <AreaTemplate data={entity as Area} />
      </section>
    );
  }

  if (type === 'instances') {
    return (
      <section className="entity-page instance-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/instances`}>Instances</Link>
        </p>
        <InstanceTemplate data={entity as Instance} />
      </section>
    );
  }

  if (type === 'infected-zones') {
    return (
      <section className="entity-page infected-zone-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/infected-zones`}>Infected Zones</Link>
        </p>
        <InfectedZoneTemplate data={entity as InfectedZone} />
      </section>
    );
  }

  if (type === 'nanos') {
    return (
      <section className="entity-page nano-page">
        <p className="breadcrumb muted">
          <Link to={`/${build}`}>{buildLabel}</Link>
          {' · '}
          <Link to={`/${build}/nanos`}>Nanos</Link>
        </p>
        <NanoTemplate data={entity as Nano} />
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
