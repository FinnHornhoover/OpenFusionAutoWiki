import { Link, useParams } from 'react-router-dom';

import EntityLink from '../components/EntityLink';
import ErrorState from '../components/ErrorState';
import type { PlayerStatsRow, Ref } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useDocumentTitle } from '../data/useDocumentTitle';
import { useIndex } from '../data/useIndex';

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as { Name?: unknown; CurrentObjective?: unknown; name?: unknown };
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.Name === 'string') return obj.Name;
    if (typeof obj.CurrentObjective === 'string') return obj.CurrentObjective;
  }
  return '';
}

function cleanRef(ref: Ref | null): Ref | null {
  if (!ref) return null;
  const name = textValue(ref.name) || String(ref.id);
  return { ...ref, name };
}

function isAcademyLikeBuild(entry: { date: string } | null): boolean {
  return Boolean(entry?.date && entry.date >= '2011-02-13');
}

export default function PlayerStats() {
  const { build } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes('player-stats') ?? false;
  const { rows, loading, error } = useIndex<PlayerStatsRow>(supported ? build : undefined, supported ? 'player-stats' : undefined);
  const buildLabel = entry ? entry.displayName : build;
  const showNanoColumns = !isAcademyLikeBuild(entry);
  useDocumentTitle(('Player Stats · ' + (buildLabel ?? '')).trim());

  return (
    <section className="player-stats-page">
      <p className="breadcrumb muted"><Link to={'/' + build}>{buildLabel}</Link></p>
      <h1>Player Stats</h1>
      {!supported && <div className="placeholder">Player stats are not available for this build.</div>}
      {error && <ErrorState title="Couldn't load player stats" message="The index file failed to load." detail={error} />}
      {loading && <p className="muted">Loading...</p>}
      {supported && rows && (
        <div className="table-scroll">
          <table className="location-table source-table entity-index-table player-stats-table">
            <thead>
              <tr>
                <th>Level</th>
                <th>HP</th>
                <th>Defense</th>
                <th>Punch damage</th>
                <th>FM limit</th>
                <th>Next level FM</th>
                {showNanoColumns && <th>Nano unlock</th>}
                {showNanoColumns && <th>Nano mission</th>}
              </tr>
            </thead>
            <tbody>
              {rows.filter((row) => row.level <= 36).map((row) => {
                const nextNano = cleanRef(row.nextNano);
                const nanoMission = cleanRef(row.nanoMission);
                const nanoMissionTask = textValue(row.nanoMissionTask);
                return (
                  <tr key={row.level}>
                    <td><code>{row.level}</code></td>
                    <td>{row.hp.toLocaleString()}</td>
                    <td>{row.defense.toLocaleString()}</td>
                    <td>{row.punchDamage.toLocaleString()}</td>
                    <td>{row.fmLimit.toLocaleString()}</td>
                    <td>{row.nextLevelFMCost.toLocaleString()}</td>
                    {showNanoColumns && (
                      <td>
                        {nextNano ? (nextNano.id === 37 ? <span>{nextNano.name}</span> : <EntityLink entity={nextNano} />) : <span className="muted">-</span>}
                      </td>
                    )}
                    {showNanoColumns && (
                      <td>
                        {nanoMission ? <EntityLink entity={nanoMission} /> : <span className="muted">-</span>}
                        {nanoMissionTask && <div className="muted player-stats-task">{nanoMissionTask}</div>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
