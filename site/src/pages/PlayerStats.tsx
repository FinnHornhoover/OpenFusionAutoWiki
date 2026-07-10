import { Link, useParams } from 'react-router-dom';

import EntityLink from '../components/EntityLink';
import ErrorState from '../components/ErrorState';
import type { PlayerStatsRow, Ref } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { TITLE_SEPARATOR, useDocumentTitle } from '../data/useDocumentTitle';
import { useIndex } from '../data/useIndex';

function isAcademyLikeBuild(entry: { date: string } | null): boolean {
  return Boolean(entry?.date && entry.date >= '2011-02-13');
}

function unlockedNanos(row: PlayerStatsRow): Ref[] {
  return row.nanosUnlocked ?? (row.nextNano ? [row.nextNano] : []);
}

export default function PlayerStats() {
  const { build } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes('player-stats') ?? false;
  const { rows, loading, error } = useIndex<PlayerStatsRow>(supported ? build : undefined, supported ? 'player-stats' : undefined);
  const buildLabel = entry ? entry.displayName : build;
  const showAssignedMissionColumn = !isAcademyLikeBuild(entry);
  useDocumentTitle(`Player Stats${TITLE_SEPARATOR}${buildLabel ?? ''}`.trim());

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
                <th>ATK<br />DEF</th>
                <th>FM<br />limit</th>
                <th>Level<br />up FM</th>
                <th>Power<br />change<br />FM</th>
                <th>Nanos unlocked</th>
                {showAssignedMissionColumn && <th>Assigned mission</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const nanosUnlocked = unlockedNanos(row);
                return (
                <tr key={row.level}>
                  <td><code>{row.level}</code></td>
                  <td>{row.hp.toLocaleString()}</td>
                  <td>{row.defense.toLocaleString()}</td>
                  <td>{row.fmLimit.toLocaleString()}</td>
                  <td>{row.nextLevelFMCost.toLocaleString()}</td>
                  <td>{row.nanoPowerChangeFMCost.toLocaleString()}</td>
                  <td>
                      {nanosUnlocked.length > 0 ? (
                        <ul className="player-stats-nano-list">
                          {nanosUnlocked.map((nano) => (
                            <li key={nano.id}>
                              <EntityLink entity={nano} />
                            </li>
                          ))}
                        </ul>
                      ) : <span className="muted">-</span>}
                    </td>
                  {showAssignedMissionColumn && (
                      <td>
                        {row.nanoMission ? <EntityLink entity={row.nanoMission} /> : <span className="muted">-</span>}
                        {row.nanoMissionTask && <div className="muted player-stats-task">{row.nanoMissionTask}</div>}
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
