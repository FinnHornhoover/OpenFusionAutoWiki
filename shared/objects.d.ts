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
}

export interface ModelPreview {
  id: number | string;
  variants: PreviewVariant[];
  outfit?: { selected: string[] };
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
  baseUrl: string;
  types: PreviewType[];
  release: string;
  format: number;
  areas?: boolean;
}

export interface AreaPreviewRecipe {
  id: string;
  bounds: [number, number, number, number];
  tiles: string[];
  missing: string[];
}
