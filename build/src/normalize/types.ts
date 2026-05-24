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
  /** Inverted: missions that name THIS mission as a prerequisite. Filled after first pass. */
  requiredByMissions: Ref[];

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
  guideEmails: GuideEmail[];
}

export interface TaskMessage {
  sender: Ref | null;
  text: string;
  /** Optional in-world dialog bubble (separate NPC + line from the popup text). */
  bubble: { sender: Ref | null; text: string } | null;
  journal: {
    detailedMission: string;
    detailedTask: string;
    missionSummary: string;
    missionCompleteSummary: string;
  };
}

/** Email-style guidance shown to the player during a task. Sender is a name (no ID);
 *  senderRef is filled when the name matches exactly one NPC in this build. */
export interface GuideEmail {
  sender: string;
  senderRef: Ref | null;
  body: string;
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

/** Where an NPC is spawned in the world. */
export interface NpcLocation {
  areaZone: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
}

/** Vendor item entry on an NPC page. */
export interface NpcVendorItem {
  ref: Ref;
  buyPrice: number;
  sellPrice: number;
  rarity: string;
  requiredLevel: number;
  itemKind: string;
}

export interface Npc {
  id: number;
  name: string;
  icon: string;
  category: string;
  comment: string;
  inGame: boolean;
  height: number;
  scale: number;

  idleBarkers: string[];
  missionBarkers: Array<{ mission: Ref; text: string }>;

  vendorItems: NpcVendorItem[];

  startedMissions: Ref[];
  journaledMissions: Ref[];
  endedMissions: Ref[];

  locations: NpcLocation[];
}

export interface NpcIndexEntry {
  id: number;
  name: string;
  icon: string;
  category: string;
  instanceCount: number;
  inGame: boolean;
}
