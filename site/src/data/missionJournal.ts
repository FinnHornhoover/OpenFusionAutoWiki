import type { MissionTask, TaskJournal } from './types';

/** Older generated chunks stored journal fields on start messages. Never use
 * end/fail journals: those references were not consumed by the client. */
export function taskJournal(task: MissionTask | undefined): TaskJournal | null {
  if (!task) return null;
  if (task.journal !== undefined) return task.journal;
  const legacy = task.messages.start?.journal;
  return legacy ? { ...legacy, detailedMissionComplete: '' } : null;
}

/** Keep the raw task journals intact; choose the records used at each mission
 * boundary instead of taking a majority value or merging distinct entries. */
export function missionJournal(tasks: MissionTask[]) {
  const progression = tasks.filter((task) => !task.state || task.state === 'SuccessTask');
  const first = taskJournal(progression[0]);
  const last = taskJournal(progression[progression.length - 1]);
  return {
    summary: first?.missionSummary ?? '',
    offer: first?.detailedMission ?? '',
    completedListSummary: last?.missionSummary ?? '',
    turnIn: last?.detailedMissionComplete ?? '',
    completed: last?.missionCompleteSummary ?? '',
  };
}
