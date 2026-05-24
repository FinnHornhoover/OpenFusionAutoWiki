import { useParams } from 'react-router-dom';

import type { AreaIndexEntry, ItemIndexEntry, MissionIndexEntry, MobIndexEntry, NpcIndexEntry } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useIndex } from '../data/useIndex';
import AreaIndex from './index/AreaIndex';
import ItemIndex from './index/ItemIndex';
import MissionIndex from './index/MissionIndex';
import MobIndex from './index/MobIndex';
import NpcIndex from './index/NpcIndex';

const TYPE_TITLES: Record<string, string> = {
  missions: 'Missions',
  npcs: 'NPCs',
  monsters: 'Monsters',
  items: 'Items',
  areas: 'Areas',
  nanos: 'Nanos',
};

export default function EntityIndex() {
  const { build, type } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes(type ?? '') ?? false;
  const { rows, loading } = useIndex<MissionIndexEntry | NpcIndexEntry | ItemIndexEntry | MobIndexEntry | AreaIndexEntry>(
    supported ? build : undefined,
    supported ? type : undefined,
  );

  const buildLabel = entry ? entry.displayName : build;
  const heading = TYPE_TITLES[type ?? ''] ?? type ?? '';

  if (!supported) {
    return (
      <section>
        <h1>{heading}</h1>
        <p className="muted">Build: {buildLabel}</p>
        <div className="placeholder">
          {heading} aren't normalized yet for this build. Coming in a later phase.
        </div>
      </section>
    );
  }

  const body = (() => {
    if (!build) return null;
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
    return <div className="placeholder">Index renderer for {heading} isn't built yet.</div>;
  })();

  return (
    <section>
      <h1>{heading}</h1>
      <p className="muted">Build: {buildLabel}</p>
      {body}
    </section>
  );
}
