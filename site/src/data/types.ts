/**
 * Shared types between the build pipeline output and the site.
 * Kept in sync with build/src/normalize/types.ts.
 */

export type EntityType = 'mission' | 'npc' | 'item' | 'monster' | 'nano' | 'instance' | 'infected-zone' | 'code';

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
  requiredGuideNpc: Ref | null;
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

export type MissionTaskState = 'SuccessTask' | 'FailRepeatTask' | 'UnreachableTask' | string;

export interface MissionTask {
  id: number;
  type: string;
  state: MissionTaskState;
  objective: string;
  onEndObjective: string;
  onFailObjective: string;
  nextTaskOnEnd: number;
  nextTaskOnFail: number;
  timeLimitSeconds: number;
  waypointNPC: Ref | null;
  waypointPoint: {
    x: number;
    y: number;
    z: number;
    areaZone: string;
    areaId: string;
    instanceID: number;
    instanceName: string;
  } | null;
  escortNPC: Ref | null;
  requiredInstance: Ref | null;
  monsterRequirements: Array<{
    ref: Ref;
    killCount: number;
    questItem: string;
    questItemId: number;
    questItemNeededCount: number;
    questItemDropPercent: number;
    mapIcon: string;
    location: {
      areaZone: string;
      areaId: string;
      x: number;
      y: number;
      z: number;
      instanceID: number;
      instanceName: string;
      points: Array<{ x: number; y: number }>;
    } | null;
  }>;
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
  displayNPC?: { name: string; icon: string } | null;
  requiredMissions?: Ref[];
  requiredByMissions?: Ref[];
}

export interface NpcLocation {
  areaZone: string;
  areaId: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
  instanceName: string;
}

export interface NpcVendorItem {
  ref: Ref;
  buyPrice: number;
  sellPrice: number;
  rarity: string;
  requiredLevel: number;
  itemKind: string;
}

export interface NpcTransportSpot {
  areaZone: string;
  areaId: string;
  x: number;
  y: number;
  z: number;
}

export interface NpcTransportRoute {
  routeId: number;
  routeName: string;
  moveType: string;
  start: NpcTransportSpot | null;
  landing: NpcTransportSpot | null;
}

export interface Npc {
  id: number;
  name: string;
  icon: string;
  mapIcon: string;
  category: string;
  comment: string;
  inGame: boolean;
  height: number;
  scale: number;

  idleBarkers: string[];
  missionBarkers: Array<{ mission: Ref; text: string }>;

  vendorItems: NpcVendorItem[];
  transportRoutes: NpcTransportRoute[];

  startedMissions: Ref[];
  journaledMissions: Ref[];
  endedMissions: Ref[];

  locations: NpcLocation[];

}

export interface NpcAmbiguityMember {
  id: number;
  name: string;
  icon: string;
  mapIcon: string;
  category: string;
  inGame: boolean;
  transportRouteCount: number;
  startedMissionCount: number;
  spawnCount: number;
  firstLocation: NpcLocation | null;
}

export interface NpcAmbiguity {
  kind: 'npc-ambiguity';
  id: string;
  name: string;
  icon: string;
  category: string;
  inGame: boolean;
  status: 'in-game' | 'out-of-game' | 'mixed';
  members: NpcAmbiguityMember[];
}

export interface NpcIndexMember {
  id: number;
  category: string;
  inGame: boolean;
}

export interface NpcIndexEntry {
  id: number | string;
  name: string;
  icon: string;
  category: string;
  categories: string[];
  instanceCount: number;
  inGame: boolean;
  status: 'in-game' | 'out-of-game' | 'mixed';
  idCount: number;
  transportRouteCount: number;
  startedMissionCount: number;
  members: NpcIndexMember[];
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
  | ({ kind: 'egg'; eggId: string; eggName: string; eggComment: string; areaZone: string; areaId: string; instanceID: number; instanceName: string; x: number; y: number; z: number } & DropChance)
  | ({ kind: 'racing'; npc: Ref | null; instanceName: string; areaZone: string; requiredScore: number; requiredStars: number } & DropChance)
  | { kind: 'code'; code: string; ref: Ref }
  | ({ kind: 'event'; eventId: number; eventName: string } & DropChance);

export interface CrateDrop extends DropChance {
  ref: Ref;
}

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
  crateDrops: CrateDrop[];
  containingCrates: CrateDrop[];
}


export interface CodeItemEntry {
  ref: Ref;
  typeId: number;
  itemId: number;
  type: string;
  rarity: string;
  gender: string;
  contentLevel: number;
  requiredLevel: number;
  obtainable: boolean;
}

export interface Code {
  id: string;
  code: string;
  name: string;
  ref: Ref;
  items: CodeItemEntry[];
}

export interface CodeIndexEntry {
  id: string;
  code: string;
  name: string;
  icon: string;
  items: Ref[];
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
  areaId: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
  instanceName: string;
  hp: number;
  groupId: string;
}

export interface MobLocationGroup {
  areaZone: string;
  areaId: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
  instanceName: string;
  hp: number;
  spawnCount: number;
  points: Array<{ x: number; y: number }>;
}

export interface MobDrop extends DropChance {
  item: Ref;
  areaZone: string;
}

export interface MobMiscReward {
  amount: number;
  probability: number;
  odds: string;
}

export interface MobMiscRewards {
  taros: MobMiscReward;
  fm: MobMiscReward;
  potions: MobMiscReward;
  boosts: MobMiscReward;
}

export interface Mob {
  id: number;
  name: string;
  icon: string;
  mapIcon: string;
  category: string;
  colorType: string;
  level: number;
  inGame: boolean;
  comment: string;
  height: number;
  scale: number;
  radius: number;

  standardHP: number;
  displayHP: number;
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
  miscRewards: MobMiscRewards;

  locations: MobLocation[];
  locationGroups: MobLocationGroup[];
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


// ---- Instances --------------------------------------------------------------

export interface InstanceWarpLocation {
  areaZone: string;
  areaId: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
  instanceName: string;
}

export interface InstanceWarpExitLocation {
  areaZone: string;
  areaId: string;
  x: number;
  y: number;
  z: number;
}

export interface InstanceWarp {
  id: number;
  npc: Ref | null;
  entryLocation: InstanceWarpLocation | null;
  exitLocation: InstanceWarpExitLocation | null;
  requiredItem: Ref | null;
  requiredMission: Ref | null;
  requiredTaskId: number;
  requiredTaskObjective: string;
  requiredMinLevel: number;
  warpPrice: number;
}

export interface Instance {
  id: number;
  name: string;
  areaZone: string;
  areaId: string;
  inGame: boolean;
  infectedZoneId: number;
  infectedZoneName: string;
  infectedZone: Ref | null;
  epMaxScore: number;
  entryWarps: InstanceWarp[];
  exitWarps: InstanceWarp[];
}

export interface InstanceIndexEntry {
  id: number;
  name: string;
  inGame: boolean;
  infectedZoneId: number;
  infectedZoneName: string;
  infectedZone: Ref | null;
  entryWarpCount: number;
  exitWarpCount: number;
}


// ---- Infected Zones ---------------------------------------------------------

export interface InfectedZoneRankReward {
  stars: number;
  rank: number;
  label: string;
  requiredScore: number;
  item: Ref | null;
  crateDrops: CrateDrop[];
}

export interface InfectedZone {
  id: number;
  name: string;
  icon: string;
  areaZone: string;
  areaId: string;
  inGame: boolean;
  podCount: number;
  timeLimit: string;
  timeLimitSeconds: number;
  maxScore: number;
  originalMaxScore: number;
  podFactor: number;
  timeFactor: number;
  scaleFactor: number;
  scoreFunction: string;
  fmRewardFunction: string;
  firstEntryLocation: InstanceWarpLocation | null;
  entryWarps: InstanceWarp[];
  exitWarps: InstanceWarp[];
  rankRewards: InfectedZoneRankReward[];
}

export interface InfectedZoneIndexEntry {
  id: number;
  name: string;
  icon: string;
  areaZone: string;
  areaId: string;
  firstEntryX: number;
  firstEntryY: number;
  firstEntryZ: number;
  inGame: boolean;
  podCount: number;
  timeLimit: string;
  timeLimitSeconds: number;
  maxScore: number;
  entryWarpCount: number;
  exitWarpCount: number;
}

export interface AreaNpcEntry {
  ref: Ref;
  category: string;
  mapIcon: string;
  showOnMap: boolean;
  instanceCount: number;
  x: number;
  y: number;
  z: number;
  areaId: string;
  areaZone: string;
  instanceID: number;
  instanceName: string;
  points: Array<{ x: number; y: number }>;
}

export interface AreaMobEntry {
  ref: Ref;
  mapIcon: string;
  instanceCount: number;
  level: number;
  hp: number;
  x: number;
  y: number;
  z: number;
  areaId: string;
  areaZone: string;
  instanceID: number;
  instanceName: string;
  points: Array<{ x: number; y: number }>;
}

export interface AreaVendorEntry {
  ref: Ref;
  category: string;
  mapIcon: string;
  showOnMap: boolean;
  instanceCount: number;
  x: number;
  y: number;
  z: number;
  areaId: string;
  areaZone: string;
  instanceID: number;
  instanceName: string;
  points: Array<{ x: number; y: number }>;
}

export interface AreaMissionStartEntry {
  mission: Ref;
  npc: Ref;
  x: number;
  y: number;
  z: number;
  areaId: string;
  areaZone: string;
  instanceID: number;
  instanceName: string;
}

export interface AreaEggEntry {
  typeName: string;
  typeComment: string;
  crateItem: Ref | null;
  effectName: string;
  effectIcon: string;
  effectDuration: number;
  x: number;
  y: number;
  z: number;
  areaId: string;
  areaZone: string;
  instanceID: number;
  instanceName: string;
}

export interface AreaTransport {
  routeId: number;
  routeName: string;
  moveType: string;
  startNpc: Ref | null;
  stops: Array<{ areaZone: string; areaId: string; x: number; y: number; z: number; isHere: boolean; isStopPoint: boolean }>;
  routePoints?: Array<{ areaZone: string; areaId: string; x: number; y: number; z: number; isStopPoint: boolean }>;
}

export interface AreaInstanceWarp {
  id: number;
  instance: Ref;
  instanceID: number;
  instanceName: string;
  npc: Ref | null;
  entryLocation: {
    areaZone: string;
    areaId: string;
    x: number;
    y: number;
    z: number;
    instanceID: number;
    instanceName: string;
  } | null;
  requiredItem: Ref | null;
  requiredMission: Ref | null;
  requiredTaskId: number;
  requiredTaskObjective: string;
  requiredMinLevel: number;
}

export interface AreaInfectedZoneSummary {
  iznId: number;
  name: string;
  icon: string;
  ref: Ref;
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
  vendors: AreaVendorEntry[];
  eggs: AreaEggEntry[];
  transportation: AreaTransport[];
  instanceWarps: AreaInstanceWarp[];
  infectedZone: AreaInfectedZoneSummary | null;
  missionStarts: AreaMissionStartEntry[];

  missionsStarting: Ref[];
}

export interface AreaIndexEntry {
  id: string;
  name: string;
  zoneName: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

export interface PlayerStatsRow {
  level: number;
  hp: number;
  defense: number;
  dodge: number;
  punchDamage: number;
  fmLimit: number;
  nextLevelFMCost: number;
  nanoPowerChangeFMCost: number;
  nanosUnlocked?: Ref[];
  /** Compatibility with stale generated player-stats indexes before build:data is rerun. */
  nextNano?: Ref | null;
  nanoMission: Ref | null;
  nanoMissionTaskId: number;
  nanoMissionTask: string;
}

export interface BuildMeta {
  builtTypes: string[];
}
