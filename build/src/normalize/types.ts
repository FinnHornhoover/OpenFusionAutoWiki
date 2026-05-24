/** Reference to another wiki entity. The site decides whether it can link to it. */
export interface Ref {
  type: 'mission' | 'npc' | 'item' | 'monster' | 'nano' | 'instance';
  id: number;
  name: string;
  /** md5-hashed icon filename (with extension), or empty when unknown. */
  icon?: string;
}

/** What we keep per mission for the wiki. */
export interface Mission {
  id: number;
  name: string;
  level: number;
  difficulty: string;
  type: string;
  inGame: boolean;

  startNPC: Ref | null;
  journalNPC: Ref | null;
  endNPC: Ref | null;

  requiredGuide: string;
  requiredNano: Ref | null;
  requiredMissions: Ref[];

  rewards: {
    fm: number;
    taros: number;
    itemSelectionNeeded: boolean;
    items: Array<{
      ref: Ref;
      rarity: string;
      requiredLevel: number;
      itemKind: string;
    }>;
    nano: Ref | null;
  };

  tasks: MissionTask[];
  barkers: Array<{ npc: Ref; text: string }>;
}

export interface MissionTask {
  id: number;
  type: string;
  objective: string;
  onEndObjective: string;
  nextTaskOnEnd: number;
  timeLimitSeconds: number;
  waypointNPC: Ref | null;
  escortNPC: Ref | null;
  requiredInstance: Ref | null;
  monsterRequirements: Array<{ ref: Ref; killCount: number }>;
  messages: {
    start: TaskMessage | null;
    end: TaskMessage | null;
    fail: TaskMessage | null;
  };
}

export interface TaskMessage {
  sender: Ref | null;
  text: string;
  journal: {
    detailedMission: string;
    detailedTask: string;
    missionSummary: string;
    missionCompleteSummary: string;
  };
}

/** Summary record emitted to /data/<slug>/index/<type>.json. */
export interface MissionIndexEntry {
  id: number;
  name: string;
  level: number;
  difficulty: string;
  type: string;
  startNPC: { name: string; icon: string } | null;
}
