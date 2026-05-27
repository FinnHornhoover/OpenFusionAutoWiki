import { Link, useParams } from 'react-router-dom';

import ErrorState from '../components/ErrorState';
import type { AreaIndexEntry, InfectedZoneIndexEntry, InstanceIndexEntry, ItemIndexEntry, MissionIndexEntry, MobIndexEntry, NanoIndexEntry, NpcIndexEntry } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useDocumentTitle } from '../data/useDocumentTitle';
import { useIndex } from '../data/useIndex';
import AreaIndex from './index/AreaIndex';
import InfectedZoneIndex from './index/InfectedZoneIndex';
import InstanceIndex from './index/InstanceIndex';
import ItemIndex from './index/ItemIndex';
import MissionIndex from './index/MissionIndex';
import MobIndex from './index/MobIndex';
import NanoIndex from './index/NanoIndex';
import NpcIndex from './index/NpcIndex';

const TYPE_TITLES: Record<string, string> = {
  missions: 'Missions',
  npcs: 'NPCs',
  monsters: 'Monsters',
  items: 'Items',
  areas: 'Areas',
  instances: 'Instances',
  'infected-zones': 'Infected Zones',
  nanos: 'Nanos',
};

export default function EntityIndex() {
  const { build, type } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes(type ?? '') ?? false;
  const { rows, loading, error } = useIndex<MissionIndexEntry | NpcIndexEntry | ItemIndexEntry | MobIndexEntry | AreaIndexEntry | InstanceIndexEntry | InfectedZoneIndexEntry | NanoIndexEntry>(
    supported ? build : undefined,
    supported ? type : undefined,
  );

  const buildLabel = entry ? entry.displayName : build;
  const heading = TYPE_TITLES[type ?? ''] ?? type ?? '';
  const buildLink = build ? <Link to={`/${build}`}>{buildLabel}</Link> : buildLabel;
  useDocumentTitle(`${heading} · ${buildLabel ?? ''}`.trim());

  if (!supported) {
    return (
      <section>
        <h1>{heading}</h1>
        <p className="muted">Build: {buildLink}</p>
        <div className="placeholder">
          {heading} aren't normalized yet for this build. Coming in a later phase.
        </div>
      </section>
    );
  }

  const body = (() => {
    if (!build) return null;
    if (error) {
      return (
        <ErrorState
          title={`Couldn't load ${heading}`}
          message="The index file failed to load."
          detail={error}
        />
      );
    }
    if (type === 'missions') {
      return <MissionIndex build={build} rows={(rows ?? []) as MissionIndexEntry[]} loading={loading} />;
    }
    if (type === 'npcs') {
      return <NpcIndex build={build} rows={(rows ?? []) as NpcIndexEntry[]} loading={loading} />;
    }
    if (type === 'items') {
      return <ItemIndex build={build} rows={(rows ?? []) as ItemIndexEntry[]} loading={loading} />;
    }
    if (type === 'monsters') {
      return <MobIndex build={build} rows={(rows ?? []) as MobIndexEntry[]} loading={loading} />;
    }
    if (type === 'areas') {
      return <AreaIndex build={build} rows={(rows ?? []) as AreaIndexEntry[]} loading={loading} />;
    }
    if (type === 'instances') {
      return <InstanceIndex build={build} rows={(rows ?? []) as InstanceIndexEntry[]} loading={loading} />;
    }
    if (type === 'infected-zones') {
      return <InfectedZoneIndex build={build} rows={(rows ?? []) as InfectedZoneIndexEntry[]} loading={loading} />;
    }
    if (type === 'nanos') {
      return <NanoIndex build={build} rows={(rows ?? []) as NanoIndexEntry[]} loading={loading} />;
    }
    return <div className="placeholder">Index renderer for {heading} isn't built yet.</div>;
  })();

  return (
    <section>
      <h1>{heading}</h1>
      <p className="muted">Build: {buildLink}</p>
      {body}
    </section>
  );
}
