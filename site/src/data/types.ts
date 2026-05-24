/**
 * Shared types between the build pipeline output and the site.
 * Kept in sync with build/src/normalize/types.ts.
 */

export type EntityType = 'mission' | 'npc' | 'item' | 'monster' | 'nano' | 'instance';

export interface Ref {
  type: EntityType;
  /** Numeric for most types; compound string "typeId-itemId" for items. */
  id: number | string;
  name: string;
  icon?: string;
}

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
  requiredByMissions: Ref[];

  rewards: {
    fm: number;
    taros: number;
    itemSelectionNeeded: boolean;
    items: Array<{ ref: Ref; rarity: string; requiredLevel: number; itemKind: string }>;
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
  bubble: { sender: Ref | null; text: string } | null;
  journal: {
    detailedMission: string;
    detailedTask: string;
    missionSummary: string;
    missionCompleteSummary: string;
  };
}

export interface GuideEmail {
  sender: string;
  senderRef: Ref | null;
  body: string;
}

export interface MissionIndexEntry {
  id: number;
  name: string;
  level: number;
  difficulty: string;
  type: string;
  startNPC: { name: string; icon: string } | null;
}

export interface NpcLocation {
  areaZone: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
}

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

  aliasIds: number[];
}

export interface NpcIndexEntry {
  id: number;
  name: string;
  icon: string;
  category: string;
  instanceCount: number;
  inGame: boolean;
}

export type ItemSource =
  | { kind: 'mob'; mob: Ref; areaZone: string; probability: number; oddsText: string }
  | { kind: 'mission'; mission: Ref; npc: Ref | null; areaZone: string; selectionNeeded: boolean }
  | { kind: 'mission-crate'; mission: Ref; npc: Ref | null; areaZone: string; selectionNeeded: boolean }
  | { kind: 'vendor'; npc: Ref; price: number; areaZone: string }
  | { kind: 'egg'; eggName: string; eggComment: string; areaZone: string }
  | { kind: 'racing'; npc: Ref | null; instanceName: string; areaZone: string; requiredScore: number; requiredStars: number }
  | { kind: 'code'; code: string }
  | { kind: 'event'; eventId: number; eventName: string; probability: number; oddsText: string };

export interface Item {
  id: string;
  typeId: number;
  itemId: number;
  name: string;
  icon: string;

  type: string;
  displayType: string;
  description: string;
  rarity: string;
  contentLevel: number;
  requiredLevel: number;
  gender: string;

  buyPrice: number;
  sellPrice: number;
  maxStack: number;

  tradeable: boolean;
  sellable: boolean;
  obtainable: boolean;

  singleDamage: number;
  multiDamage: number;
  numberOfTargets: number;
  range: string;
  rangeValue: number;
  coneAngle: number;
  fireDelayTime: number;
  fireDeliverTime: number;
  fireDurationTime: number;
  fireInitialTime: number;
  rateOfFire: number;
  defense: number;
  vehicleClass: number;
  weaponType: string;

  sources: ItemSource[];
}

export interface ItemIndexEntry {
  id: string;
  typeId: number;
  itemId: number;
  name: string;
  icon: string;
  type: string;
  rarity: string;
  gender: string;
  contentLevel: number;
  requiredLevel: number;
  obtainable: boolean;
}

export interface BuildMeta {
  builtTypes: string[];
}
