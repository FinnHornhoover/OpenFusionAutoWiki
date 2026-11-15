export type Gender = 'm' | 'f';
export type PreviewType = 'monsters' | 'nanos' | 'npcs' | 'items' | 'item-sets';
export type Color = [number, number, number, number];
export type Mount = 'hat' | 'glasses' | 'back' | 'left-hand' | 'right-hand' | 'vehicle';
export type PartSlot = 'face' | 'hair' | 'shirt' | 'pants' | 'shoes' | 'hat' | 'glasses' | 'back' | 'weapon' | 'vehicle';
export type WeaponAnimationStyle = 'unarmed' | 'plain' | 'stick' | 'pistol' | 'rifle' | 'rocket' | 'bomb';
export type VehicleAnimationStyle = 'board' | 'scooter';
export interface AnimationContext {
  kind: 'avatar' | 'creature' | 'npc' | 'nano';
  weapon?: WeaponAnimationStyle;
  vehicle?: VehicleAnimationStyle;
}
export interface AnimationChoice {
  name: string;
  label: string;
  group: 'Idle' | 'Movement' | 'Combat' | 'Reactions' | 'Emotes' | 'Other';
  duration: number;
}

export interface ModelPart {
  model: string;
  primary?: string;
  secondary?: string;
  mode: 'prefab' | 'worn' | 'attached';
  mount?: Mount;
  renderers?: number[];
  slot?: PartSlot;
  autoAnimation?: string | null;
}

export interface WeaponShot {
  sounds?: { key: string; weight: number }[];
  impactSound?: string;
  label: string;
  bullet: number;
  targetMode: number;
  equipType: number;
  cooldown: number;
  link: string;
  fire?: { model: string; duration: number };
  projectile?: { model: string; duration: number };
  impact?: { model: string; duration: number };
  flight: { kind: 'ordinary'; delay: number; duration: number; range: number }
    | { kind: 'rocket'; duration: number; speed: number; retrobution: boolean }
    | { kind: 'grenade'; duration: number; speed: number; verticalSpeed: number; retrobution: boolean; weaponModel: boolean };
}

export interface MeleeTrail {
  texture: string;
  color: Color;
  uv: [number, number, number, number];
  filter: number;
  wrap: number;
}

export interface WeaponAttack {
  full?: string;
  upper?: string;
  ready?: string;
}

export interface PreviewVariant {
  label: string;
  model: ModelPart;
  gender?: Gender;
  parts?: ModelPart[];
  skin?: Color;
  hair?: Color;
  height?: number;
  shape?: number;
  idle?: string;
  scale?: number;
  hiddenSlots?: PartSlot[];
  animationContext?: AnimationContext;
  animations?: AnimationChoice[];
  outfitSlot?: PartSlot;
  weaponShots?: WeaponShot[];
  weaponAttack?: WeaponAttack;
  weaponTrail?: MeleeTrail;
  shaderNames?: Record<string, string>;
  vehicleEffects?: { model: string; mount: string }[];
}

export interface ModelPreview {
  id: number | string;
  variants: PreviewVariant[];
  outfit?: { selected: string[]; byGender?: Partial<Record<Gender, string[]>> };
}

export interface OutfitCatalog {
  defaults: PreviewVariant[];
  items: OutfitItem[];
}

export interface OutfitItem {
  id: string;
  name: string;
  slot: PartSlot;
  genders: Gender[];
  icon: string;
  level: number;
  rarity: string;
  gender: string;
  type: string;
  obtainable: boolean;
}

export interface PreviewMeta {
  audio?: string;
  baseUrl: string;
  shared?: Record<string, string>;
  types: PreviewType[];
  release: string;
  format: number;
  areas?: boolean;
}

export interface SoundEvent { time: number; functionName: string; data?: string; audio?: string | null }
export interface AudioSettings { sound: boolean; ambience: boolean; music: boolean; volume: number }
export interface AudioRegion { points: [number, number][]; instance: boolean; delay: number; sound?: string }
export interface AudioEmitter { id: string; position: [number, number, number]; sound: string; volume: number; pitch: number; near: number; far: number }
export interface AudioBank { sounds: Record<string, string[]>; music: AudioRegion[]; ambience: AudioRegion[]; emitters: AudioEmitter[] }

export interface AreaPreviewRecipe {
  id: string;
  bounds: [number, number, number, number];
  tiles: string[];
  missing: string[];
}

export interface WorldTile {
  id: string;
  bounds: AreaPreviewRecipe['bounds'];
  terrain: string;
  detail: string;
}

export interface WorldPreviewRecipe {
  bounds: AreaPreviewRecipe['bounds'];
  tiles: WorldTile[];
  areas: { id: string; name: string; bounds: AreaPreviewRecipe['bounds'] }[];
}

export type PopulationKind = 'npcs' | 'monsters' | 'eggs';
export interface AreaPlacement {
  id: string;
  kind: PopulationKind;
  model: string;
  name: string;
  entity: number;
  position: [number, number, number];
  yaw: number;
}
export interface AreaPopulation {
  models: Record<string, PreviewVariant>;
  placements: AreaPlacement[];
}
