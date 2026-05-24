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
  waypointPoint: { x: number; y: number; areaZone: string } | null;
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

export interface DropChance {
  boyProbability: number;
  boyOdds: string;
  girlProbability: number;
  girlOdds: string;
}

export type ItemSource =
  | ({ kind: 'mob'; mob: Ref; areaZone: string } & DropChance)
  | { kind: 'mission'; mission: Ref; npc: Ref | null; areaZone: string; selectionNeeded: boolean }
  | ({ kind: 'mission-crate'; mission: Ref; npc: Ref | null; areaZone: string; selectionNeeded: boolean } & DropChance)
  | { kind: 'vendor'; npc: Ref; price: number; areaZone: string }
  | ({ kind: 'egg'; eggName: string; eggComment: string; areaZone: string } & DropChance)
  | ({ kind: 'racing'; npc: Ref | null; instanceName: string; areaZone: string; requiredScore: number; requiredStars: number } & DropChance)
  | { kind: 'code'; code: string }
  | ({ kind: 'event'; eventId: number; eventName: string } & DropChance);

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

export interface MobLocation {
  areaZone: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
  hp: number;
  groupId: string;
}

export interface MobDrop extends DropChance {
  item: Ref;
  areaZone: string;
}

export interface Mob {
  id: number;
  name: string;
  icon: string;
  category: string;
  colorType: string;
  level: number;
  inGame: boolean;
  comment: string;
  height: number;
  scale: number;
  radius: number;

  standardHP: number;
  attackPower: number;
  attackRange: number;
  combatRange: number;
  sightRange: number;
  idleRange: number;
  power: number;
  protection: number;
  accuracy: number;
  walkSpeed: number;
  runSpeed: number;
  respawnSeconds: number;
  respawnTime: string;

  activeSkill: string;
  activeSkillIcon: string;
  passiveBuff: string;
  passiveBuffIcon: string;
  supportSkill: string;
  supportSkillIcon: string;

  missionsRequiring: Ref[];
  drops: MobDrop[];

  locations: MobLocation[];
}

export interface MobIndexEntry {
  id: number;
  name: string;
  icon: string;
  level: number;
  standardHP: number;
  colorType: string;
  category: string;
  instanceCount: number;
  inGame: boolean;
}

export interface AreaNpcEntry {
  ref: Ref;
  instanceCount: number;
}

export interface AreaMobEntry {
  ref: Ref;
  instanceCount: number;
  level: number;
  hp: number;
}

export interface AreaEggEntry {
  typeName: string;
  typeComment: string;
  crateItem: Ref | null;
  x: number;
  y: number;
  z: number;
  instanceID: number;
}

export interface AreaTransport {
  routeId: number;
  routeName: string;
  moveType: string;
  startNpc: Ref | null;
  stops: Array<{ areaZone: string; x: number; y: number; z: number; isHere: boolean }>;
}

export interface AreaInstanceWarp {
  instanceID: number;
  instanceName: string;
  npc: Ref | null;
  requiredItem: Ref | null;
  requiredMinLevel: number;
}

export interface AreaInfectedZoneSummary {
  iznId: number;
  description: string;
  difficultyLabel: string;
  recommendedLevel: number;
  maxScore: number;
}

export interface Area {
  id: string;
  name: string;
  zoneName: string;
  fullName: string;

  x: number;
  y: number;
  width: number;
  height: number;

  npcs: AreaNpcEntry[];
  mobs: AreaMobEntry[];
  vendors: Ref[];
  eggs: AreaEggEntry[];
  transportation: AreaTransport[];
  instanceWarps: AreaInstanceWarp[];
  infectedZone: AreaInfectedZoneSummary | null;

  missionsStarting: Ref[];
}

export interface AreaIndexEntry {
  id: string;
  name: string;
  zoneName: string;
  npcCount: number;
  mobCount: number;
  missionCount: number;
}

export interface NanoPower {
  id: number;
  name: string;
  comment: string;
  icon: string;
  typeName: string;
  skillName: string;
  skillId: number;
  skillIcon: string;
  skillCoolTime: number;
  skillRange: number;
  skillAngle: number;
  skillArea: number;
  skillTargetNumber: number;
  powerItem: Ref | null;
  powerItemCount: number;
}

export interface Nano {
  id: number;
  name: string;
  comment: string;
  icon: string;
  nanoType: string;
  nanoTypeId: number;
  awardLevel: number;
  powers: NanoPower[];

  missionsRewarding: Ref[];
  missionsRequiring: Ref[];
}

export interface NanoIndexEntry {
  id: number;
  name: string;
  icon: string;
  nanoType: string;
  awardLevel: number;
}

export interface BuildMeta {
  builtTypes: string[];
}
