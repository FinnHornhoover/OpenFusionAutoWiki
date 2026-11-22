import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PlayerProse, { type PlayerProseSlots } from '../content/PlayerProse';
import EntityAmbiguityList from '../components/EntityAmbiguityList';
import EntityPageSkeleton from '../components/EntityPageSkeleton';
import ErrorState from '../components/ErrorState';
import NpcAmbiguityIdentity from '../components/NpcAmbiguityIdentity';
import { ENTITY_TITLES } from '../data/entityTitles';
import type { RouteAmbiguityMatch } from '../data/routeMap';
import type { Area, Code, InfectedZone, Instance, Item, ItemSet, Mission, Mob, Nano, Npc, NpcAmbiguity } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useDelayedFlag } from '../data/useDelayedFlag';
import { TITLE_SEPARATOR, useDocumentTitle } from '../data/useDocumentTitle';
import { useEntity } from '../data/useEntity';
import AreaTemplate from '../templates/Area.mdx';
import CodeTemplate from '../templates/Code.mdx';
import InfectedZoneTemplate from '../templates/InfectedZone.mdx';
import InstanceTemplate from '../templates/Instance.mdx';
import ItemTemplate from '../templates/Item.mdx';
import ItemSetTemplate from '../templates/ItemSet.mdx';
import MissionTemplate from '../templates/Mission.mdx';
import MonsterTemplate from '../templates/Monster.mdx';
import NanoTemplate from '../templates/Nano.mdx';
import NPCTemplate from '../templates/NPC.mdx';
import NPCAmbiguityTemplate from '../templates/NPCAmbiguity.mdx';

function RouteAmbiguityPage({ build, buildLabel, type, title, matches, prose, proseAction }: PlayerProseSlots & {
  build: string;
  buildLabel: string;
  type: string;
  title: string;
  matches: RouteAmbiguityMatch[];
}) {
  return (
    <section className="entity-page ambiguity-page">
      <Breadcrumb build={build} buildLabel={buildLabel} type={type} label={ENTITY_TITLES[type] ?? type} />
      <h1>{title}</h1>
      {proseAction}
      {prose}
      <p className="muted">Multiple {type.replace(/-/g, ' ')} match this name.</p>
      <div className="entity-index-list">
        {type === 'npcs' ? matches.map(({ npc, detail, id, routeId, name, icon }) => {
          const inGame = npc?.inGame ?? !/(^| - )out of game$/i.test(detail);
          return (
            <div key={id} className={inGame ? 'entity-index-row' : 'entity-index-row entity-index-row-muted'}>
              <NpcAmbiguityIdentity build={build} routeId={routeId} id={id} name={name} icon={icon}
                mapIcon={npc?.mapIcon} location={npc?.firstLocation} inGame={inGame} />
            </div>
          );
        }) : <EntityAmbiguityList build={build} type={type} matches={matches} />}
      </div>
    </section>
  );
}

function Breadcrumb({ build, buildLabel, type, label }: { build?: string; buildLabel?: string; type: string; label: string }) {
  return (
    <p className="breadcrumb muted">
      <Link to={`/${build}`}>{buildLabel}</Link>
      {' › '}
      <Link to={`/${build}/${type}`}>{label}</Link>
    </p>
  );
}

export default function EntityPage() {
  const { build, type, id } = useParams();
  const navigate = useNavigate();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes(type ?? '') ?? false;

  const { entity, ambiguity, canonical, loading, notFound, error } = useEntity<Mission | Npc | NpcAmbiguity | Item | ItemSet | Mob | Area | Code | Instance | InfectedZone | Nano>(
    supported ? build : undefined,
    supported ? type : undefined,
    supported ? id : undefined,
  );
  const showSkeleton = useDelayedFlag(loading);

  const buildLabel = entry ? entry.displayName : build;
  const entityName = (entity as { name?: string } | null)?.name;
  const typeLabel = ENTITY_TITLES[type ?? ''] ?? type ?? '';
  useDocumentTitle(
    entityName ? [entityName, typeLabel, buildLabel].filter(Boolean).join(TITLE_SEPARATOR) : ambiguity ? [ambiguity.title, typeLabel, buildLabel].filter(Boolean).join(TITLE_SEPARATOR) : null,
  );

  useEffect(() => {
    if (build && type && id && canonical && id !== canonical) {
      navigate(`/${build}/${type}/${canonical}`, { replace: true });
    }
  }, [build, canonical, id, navigate, type]);

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
    return showSkeleton ? <EntityPageSkeleton /> : null;
  }
  if ((notFound || !entity) && !ambiguity) {
    return (
      <section>
        <h1>Not found</h1>
        <p>No {type?.replace(/s$/, '') ?? 'entity'} #{id} in <Link to={`/${build}`}>{buildLabel}</Link>.</p>
      </section>
    );
  }

  const proseRoute = canonical ?? id;
  const proseName = entityName ?? ambiguity?.title ?? proseRoute;
  const proseId = entity && 'id' in entity ? String(entity.id) : proseRoute;

  const renderPage = ({ prose, proseAction }: PlayerProseSlots) => {
    if (ambiguity && build && type) {
      return <RouteAmbiguityPage build={build} buildLabel={buildLabel ?? build} type={type} title={ambiguity.title}
        matches={ambiguity.matches} prose={prose} proseAction={proseAction} />;
    }
    if (!entity) return null;

    if (type === 'missions') {
      return <section className="entity-page mission-page"><Breadcrumb build={build} buildLabel={buildLabel} type="missions" label="Missions" /><MissionTemplate data={entity as Mission} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'npcs') {
      return (
        <section className="entity-page npc-page">
          <Breadcrumb build={build} buildLabel={buildLabel} type="npcs" label="NPCs" />
          {'kind' in (entity as object) && (entity as NpcAmbiguity).kind === 'npc-ambiguity'
            ? <NPCAmbiguityTemplate data={entity as NpcAmbiguity} build={build} prose={prose} proseAction={proseAction} />
            : <NPCTemplate data={entity as Npc} build={build} prose={prose} proseAction={proseAction} />}
        </section>
      );
    }
    if (type === 'items') {
      return <section className="entity-page item-page"><Breadcrumb build={build} buildLabel={buildLabel} type="items" label="Items" /><ItemTemplate data={entity as Item} build={build} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'item-sets') {
      return <section className="entity-page item-set-page"><Breadcrumb build={build} buildLabel={buildLabel} type="item-sets" label="Item Sets" /><ItemSetTemplate data={entity as ItemSet} build={build} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'codes') {
      return <section className="entity-page code-page"><Breadcrumb build={build} buildLabel={buildLabel} type="codes" label="Codes" /><CodeTemplate data={entity as Code} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'monsters') {
      return <section className="entity-page monster-page"><Breadcrumb build={build} buildLabel={buildLabel} type="monsters" label="Monsters" /><MonsterTemplate data={entity as Mob} build={build} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'areas') {
      return <section className="entity-page area-page"><Breadcrumb build={build} buildLabel={buildLabel} type="areas" label="Areas" /><AreaTemplate data={entity as Area} build={build} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'instances') {
      return <section className="entity-page instance-page"><Breadcrumb build={build} buildLabel={buildLabel} type="instances" label="Instances" /><InstanceTemplate data={entity as Instance} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'infected-zones') {
      return <section className="entity-page infected-zone-page"><Breadcrumb build={build} buildLabel={buildLabel} type="infected-zones" label="Infected Zones" /><InfectedZoneTemplate data={entity as InfectedZone} prose={prose} proseAction={proseAction} /></section>;
    }
    if (type === 'nanos') {
      return <section className="entity-page nano-page"><Breadcrumb build={build} buildLabel={buildLabel} type="nanos" label="Nanos" /><NanoTemplate data={entity as Nano} build={build} prose={prose} proseAction={proseAction} /></section>;
    }

    return (
      <section>
        <h1>{type}/{id}</h1>
        <pre>{JSON.stringify(entity, null, 2).slice(0, 1000)}</pre>
      </section>
    );
  };

  return build && type && proseRoute && proseName ? (
    <PlayerProse build={build} type={type} route={proseRoute} name={proseName} entityId={proseId}>
      {renderPage}
    </PlayerProse>
  ) : renderPage({ prose: null, proseAction: null });
}
