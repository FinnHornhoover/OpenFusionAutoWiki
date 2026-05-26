/** Reference to another wiki entity. */
export interface Ref {
  type: 'mission' | 'npc' | 'item' | 'monster' | 'nano' | 'instance';
  /**
   * Stable URL id. Items use "typeId-itemId" because ItemID is reused by type.
   */
  id: number | string;
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
  requiredGuideNpc: Ref | null;
  requiredNano: Ref | null;
  requiredMissions: Ref[];
  /** Missions that require this mission. Filled after the first pass. */
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
  /** Spawn point for the waypoint NPC, used by the task map. */
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

/** Guide message shown during a task. senderRef is set only for unambiguous NPC names. */
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
  displayNPC?: { name: string; icon: string } | null;
}

/** Where an NPC is spawned in the world. */
export interface NpcLocation {
  areaZone: string;
  areaId: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
  instanceName: string;
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

  /** Other NPC type-IDs that share this (category, name) and have been merged here. */
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

// ---- Items ------------------------------------------------------------------

/**
 * Probability of this specific item dropping per attempt, accounting for the
 * full crate-rarity-gender chain. Boy and girl differ when items are
 * gender-restricted (one is 0, the other gets the full share).
 */
export interface DropChance {
  boyProbability: number;
  boyOdds: string;
  girlProbability: number;
  girlOdds: string;
}

/** One place an item can be obtained — discriminated by `kind`. */
export type ItemSource =
  | ({
      kind: 'mob';
      mob: Ref;
      areaZone: string;
    } & DropChance)
  | {
      kind: 'mission';
      mission: Ref;
      npc: Ref | null;
      areaZone: string;
      selectionNeeded: boolean;
    }
  | ({
      kind: 'mission-crate';
      mission: Ref;
      npc: Ref | null;
      areaZone: string;
      selectionNeeded: boolean;
    } & DropChance)
  | {
      kind: 'vendor';
      npc: Ref;
      price: number;
      areaZone: string;
    }
  | ({
      kind: 'egg';
      eggId: string;
      eggName: string;
      eggComment: string;
      areaZone: string;
      areaId: string;
      instanceID: number;
      instanceName: string;
      x: number;
      y: number;
      z: number;
    } & DropChance)
  | ({
      kind: 'racing';
      npc: Ref | null;
      instanceName: string;
      areaZone: string;
      requiredScore: number;
      requiredStars: number;
    } & DropChance)
  | {
      kind: 'code';
      code: string;
    }
  | ({
      kind: 'event';
      eventId: number;
      eventName: string;
    } & DropChance);

export interface CrateDrop extends DropChance {
  ref: Ref;
}

export interface Item {
  /** Compound URL id: "typeId-itemId". */
  id: string;
  /** Numeric raw IDs, kept for chunking + cross-referencing. */
  typeId: number;
  itemId: number;
  name: string;
  icon: string;

  type: string;             // human-readable: "Weapon", "Body", …
  displayType: string;      // sub-type label: "Thrown", "Pistol", "Hat", …
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

  // Combat / mechanics (zeros are fine when irrelevant)
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

// ---- Monsters ---------------------------------------------------------------

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

export interface Mob {
  id: number;
  name: string;
  icon: string;
  category: string;       // typically "Monster"
  colorType: string;      // "Adaptium" | "Blastons" | "Cosmix"
  level: number;
  inGame: boolean;
  comment: string;
  height: number;
  scale: number;
  radius: number;

  // Combat
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

  // Skills (optional flavor)
  activeSkill: string;
  activeSkillIcon: string;
  passiveBuff: string;
  passiveBuffIcon: string;
  supportSkill: string;
  supportSkillIcon: string;

  // Cross-refs computed at build time
  missionsRequiring: Ref[];
  drops: MobDrop[];

  // Spawns
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

// ---- Areas ------------------------------------------------------------------

/** An NPC type appearing in an area, with how many instances of it live there. */
export interface AreaNpcEntry {
  ref: Ref;
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

/** A mob type appearing in an area, with how many instances and (when uniform) level/HP. */
export interface AreaMobEntry {
  ref: Ref;
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

/** A single egg/crate location in the area. */
export interface AreaEggEntry {
  typeName: string;          // e.g., "14Lv Item shiny"
  typeComment: string;        // "Item", "Nano", …
  crateItem: Ref | null;      // item dispensed (when known)
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

/** A transportation route that has at least one stop in this area. */
export interface AreaTransport {
  routeId: number;
  routeName: string;          // human label
  moveType: string;           // "Slider", "MonkeySkyway", "SCAMPER", …
  startNpc: Ref | null;
  /** Visible route points in order; non-Slider routes are indexed only by their first point. */
  stops: Array<{ areaZone: string; areaId: string; x: number; y: number; z: number; isHere: boolean; isStopPoint: boolean }>;
}

/** A warp door in the area leading to an instance. */
export interface AreaInstanceWarp {
  instanceID: number;
  instanceName: string;
  npc: Ref | null;
  requiredItem: Ref | null;
  requiredMinLevel: number;
}

/** When the area is part of an Infected Zone, a compact summary. */
export interface AreaInfectedZoneSummary {
  iznId: number;
  name: string;
  icon: string;
  description: string;
  difficultyLabel: string;
  recommendedLevel: number;
  maxScore: number;
}

export interface Area {
  /** URL slug derived from "AreaName - ZoneName". */
  id: string;
  /** Display name (the area, not the zone). */
  name: string;
  /** Parent zone, e.g. "The Suburbs". */
  zoneName: string;
  /** "AreaName - ZoneName". */
  fullName: string;

  // Map rectangle (game-space, denormalized for display)
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

  /** Missions whose start NPC lives in this area. */
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

// ---- Nanos ------------------------------------------------------------------

export interface NanoPower {
  id: number;
  name: string;            // power's display name (UPPER CASE in source — keep as is)
  comment: string;
  icon: string;            // md5 hash for the power's icon
  typeName: string;        // "UNSTABLE POWER" etc.
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
  nanoType: string;        // "Adaptium" | "Blastons" | "Cosmix"
  nanoTypeId: number;
  /** Lowest level among missions that reward this nano (0 when unawarded). */
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
