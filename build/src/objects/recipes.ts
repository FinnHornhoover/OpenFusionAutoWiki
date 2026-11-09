import type { Color, Gender, ModelPart, ModelPreview, Mount, PartSlot, PreviewType, PreviewVariant } from '../../../shared/objects.js';
import { Pack } from './pack.js';
import { vehicleStyle, weaponStyle } from '../../../shared/animations.js';

type Row = Record<string, string | number>;
interface Table { [field: string]: Row[] }
export type Xdt = Record<string, Table>;
interface Palette { skin: { r: number; g: number; b: number; a: number }[]; hair: Palette['skin'] }
const ITEM_TABLES = [[0, 'Weapon'], [1, 'Shirts'], [2, 'Pants'], [3, 'Shoes'], [4, 'Hat'], [5, 'Glass'], [6, 'Back'], [10, 'Vehicle']] as const;
export const ITEM_SLOTS: Record<number, PartSlot> = { 0: 'weapon', 1: 'shirt', 2: 'pants', 3: 'shoes', 4: 'hat', 5: 'glasses', 6: 'back', 10: 'vehicle' };
const SLOTS = ['face', 'hair', 'shirt', 'pants', 'shoes'] as const;
type Slot = typeof SLOTS[number];
const SLOT_TABLE: Record<Slot, string> = { face: 'Face', hair: 'Head', shirt: 'Shirts', pants: 'Pants', shoes: 'Shoes' };
const valid = (value: unknown): value is string => typeof value === 'string' && !!value && value.toLowerCase() !== 'null';

export class Recipes {
  readonly missing = new Set<string>();
  private palettes: Palette[];
  private hnpcs: Row[];

  constructor(private pack: Pack, private xdt: Xdt) {
    this.palettes = Object.values(pack.msgpack<Record<string, Palette>>('models/appearances/palettes.msgpack'));
    this.hnpcs = Object.values(pack.msgpack<Record<string, { rows: Row[] }>>('models/appearances/hnpcs.msgpack'))[0]?.rows ?? [];
  }

  private texture(value: string | number | undefined, fallback = false, prefab?: string): string | undefined {
    if (!valid(value)) return undefined;
    const file = this.pack.texture(value, prefab) ?? (fallback ? this.pack.texture(`${value.replace(/\.dds$/i, '')}_a`, prefab) : undefined);
    if (!file) { this.missing.add(`texture:${value}`); return undefined; }
    return file;
  }

  private part(paths: string[], mode: ModelPart['mode'], primary?: string | number, secondary?: string | number, mount?: Mount): ModelPart | undefined {
    const model = this.pack.model(paths);
    if (!model?.prefab) { this.missing.add(`model:${paths[0]}`); return undefined; }
    const renderers = mode === 'worn' ? model.rigs.flatMap((id) => {
      const rig = this.pack.rigs[id];
      return rig?.script_type === 'ActorWearSkinTable' ? rig.data.skins?.map((skin) => skin.r) ?? [] : [];
    }) : undefined;
    return {
      model: model.prefab.file, mode,
      // NPCs and nanos only replace named main/sub materials. Pre-textured
      // human NPCs have neither; their table texture names are placeholders.
      primary: mode !== 'prefab' || this.pack.hasTextureSlot(model.prefab.file, 'main') ? this.texture(primary, true, model.prefab.file) : undefined,
      secondary: mode !== 'prefab' || this.pack.hasTextureSlot(model.prefab.file, 'sub') ? this.texture(secondary, false, model.prefab.file) : undefined, mount,
      renderers: renderers?.length ? renderers : undefined,
    };
  }

  private meshPart(mesh: Row | undefined, gender: Gender, mode: ModelPart['mode'], mount?: Mount, cut?: number): ModelPart | undefined {
    if (!mesh) return undefined;
    const prefix = gender.toUpperCase();
    const name = mesh[`m_pstr${prefix}MeshModelString`];
    if (!valid(name)) return undefined;
    const stem = name.replace(/\.nif$/i, '');
    const paths = cut ? [`wear/${stem}_type0${cut}.nif`] : [`wear/${stem}.nif`, `wear/${stem}_type01.nif`];
    let primary = mesh[`m_pstr${prefix}TextureString`];
    if (cut && valid(primary)) primary = `${primary}_a`;
    const secondary = mode === 'worn' ? `${gender}_skin` : mesh[`m_pstr${prefix}TextureString2`];
    return this.part(paths, mode, primary, secondary, mount);
  }

  private palette(kind: 'skin' | 'hair', index: number): Color | undefined {
    const color = this.palettes[0]?.[kind][index];
    return color ? [color.r, color.g, color.b, color.a] : undefined;
  }

  private actorColor(gender: Gender, kind: 'skin' | 'hair'): Color | undefined {
    const actor = this.pack.model([`actor/${gender === 'm' ? 'm' : 'w'}.kfm`]);
    for (const id of actor?.rigs ?? []) {
      const color = this.pack.rigs[id]?.data[kind === 'skin' ? 'skinColor' : 'hairColor'];
      if (color) return [color.r, color.g, color.b, color.a];
    }
    return undefined;
  }

  private avatar(gender: Gender, replacements: Partial<Record<Slot, ModelPart | null>> = {}): PreviewVariant | undefined {
    const model = this.part([`actor/${gender === 'm' ? 'm' : 'w'}.kfm`], 'prefab');
    if (!model) return undefined;
    const parts: ModelPart[] = [];
    for (const slot of SLOTS) {
      if (replacements[slot] === null) continue;
      const mesh = this.xdt[`m_p${SLOT_TABLE[slot]}ItemTable`]?.m_pItemMeshData?.[2];
      const part = replacements[slot] ?? this.meshPart(mesh, gender, 'worn', undefined, slot === 'face' || slot === 'hair' ? 1 : undefined);
      if (!part) return undefined;
      parts.push({ ...part, slot });
    }
    return { label: gender === 'm' ? 'Boy' : 'Girl', model, gender, parts, skin: this.palette('skin', 10), hair: this.palette('hair', 2), height: 0.5, shape: 0.5, idle: 'stand', animationContext: { kind: 'avatar', weapon: 'unarmed' } };
  }

  avatars(): PreviewVariant[] {
    return (['m', 'f'] as const).flatMap((gender) => this.avatar(gender) ?? []);
  }

  private hnpc(row: Row): PreviewVariant | undefined {
    // The client indexes TableElement; iType controls gender and is not unique.
    const look = this.hnpcs[Number(row.m_iHNpcNum)];
    if (!look) return undefined;
    const gender: Gender = Number(look.iType) % 2 ? 'm' : 'f';
    const actor = this.part([`actor/${gender === 'm' ? 'm' : 'w'}.kfm`], 'prefab');
    if (!actor) return undefined;
    const parts: ModelPart[] = [];
    for (const field of ['Hair', 'Face', 'Shirt', 'Pants', 'Shoes']) {
      if (!valid(look[`str${field}Mesh`])) continue;
      const part = this.part([`wear/${look[`str${field}Mesh`]}`], 'worn', look[`str${field}Texture`], ['Shirt', 'Pants', 'Shoes'].includes(field) ? `${gender}_skin` : undefined);
      if (!part) return undefined;
      parts.push(part);
    }
    const mounts: [string, Mount][] = [['Hat', 'hat'], ['Glass', 'glasses'], ['Back', 'back'], ['LHandWpn', 'left-hand'], ['RHandWpn', 'right-hand']];
    for (const [field, mount] of mounts) {
      if (!valid(look[`str${field}Mesh`])) continue;
      const secondary = valid(look[`str${field}TextureS`]) ? `${gender}_skin` : undefined;
      const part = this.part([`wear/${look[`str${field}Mesh`]}`], 'attached', look[`str${field}TextureM`], secondary, mount);
      if (!part) return undefined;
      parts.push(part);
    }
    const weapon = [look.strRHandWpnMesh, look.strLHandWpnMesh].find(valid);
    const meshIndex = valid(weapon) ? this.xdt.m_pWeaponItemTable?.m_pItemMeshData.findIndex((mesh) =>
      [mesh.m_pstrMMeshModelString, mesh.m_pstrFMeshModelString].some((name) => `${name}.nif`.toLowerCase() === weapon.toLowerCase())) : -1;
    const item = this.xdt.m_pWeaponItemTable?.m_pItemData.find((item) => item.m_iMesh === meshIndex);
    return { label: 'Character', model: actor, gender, parts, skin: this.palette('skin', Number(look.iSkinColor)) ?? this.actorColor(gender, 'skin'), hair: this.palette('hair', Number(look.iHairColor)) ?? this.actorColor(gender, 'hair'), height: 1 - Number(look.iHeight) / 4, shape: Number(look.iShape) / 2, idle: 'stand', scale: Number(row.m_fScale) || 1, animationContext: { kind: 'avatar', weapon: item ? weaponStyle(Number(item.m_iEquipType)) : 'unarmed' } };
  }

  egg(id: number): PreviewVariant | undefined {
    const table = this.xdt.m_pShinyTable;
    const row = table?.m_pShinyData.find((row) => Number(row.m_iShinyID) === id);
    const mesh = row && table.m_pShinyMeshData[Number(row.m_iMesh)];
    const name = mesh?.m_pstrMMeshModelString;
    if (!mesh || !valid(name)) return undefined;
    const model = this.part([`mob/${name}.kfm`], 'prefab', mesh.m_pstrMTextureString, mesh.m_pstrMTextureString2);
    return model ? { label: 'Egg', model, idle: 'stand', animationContext: { kind: 'creature' } } : undefined;
  }

  entities(): Record<PreviewType, ModelPreview[]> {
    const result: Record<PreviewType, ModelPreview[]> = { monsters: [], nanos: [], npcs: [], items: [], 'item-sets': [] };
    const npcs = this.xdt.m_pNpcTable;
    for (const row of npcs?.m_pNpcData ?? []) {
      if (!Number(row.m_iNpcNumber)) continue;
      let variant: PreviewVariant | undefined;
      if (row.m_iHNpc === 1) variant = this.hnpc(row);
      else {
        const mesh = npcs.m_pNpcMeshData[Number(row.m_iMesh)];
        const name = mesh?.m_pstrMMeshModelString;
        if (!valid(name)) continue;
        const swap = Number(row.m_iNpcType) < 100;
        const model = this.part([`mob/${name}.kfm`], 'prefab', swap ? mesh.m_pstrMTextureString : undefined, swap ? mesh.m_pstrMTextureString2 : undefined);
        if (model) variant = { label: 'Model', model, idle: 'stand1', scale: Number(row.m_fScale) || 1, animationContext: { kind: row.m_iNpcType === 0 ? 'creature' : 'npc' } };
      }
      if (variant) {
        const preview = { id: Number(row.m_iNpcNumber), variants: [variant] };
        result.monsters.push(preview);
        result.npcs.push(preview);
      }
    }

    const nanos = this.xdt.m_pNanoTable;
    for (const row of nanos?.m_pNanoData ?? []) {
      if (!Number(row.m_iNanoNumber)) continue;
      const mesh = nanos.m_pNanoMeshData[Number(row.m_iMesh)];
      const name = mesh?.m_pstrMMeshModelString;
      if (!valid(name)) continue;
      const model = this.part([`nano/${name}.kfm`], 'prefab', mesh.m_pstrMTextureString, mesh.m_pstrMTextureString2);
      if (model) result.nanos.push({ id: Number(row.m_iNanoNumber), variants: [{ label: 'Model', model, idle: 'stand', animationContext: { kind: 'nano' } }] });
    }

    ITEM_TABLES.forEach(([type, tableName]) => {
      const table = this.xdt[`m_p${tableName}ItemTable`];
      for (const row of table?.m_pItemData ?? []) {
        if (!Number(row.m_iItemNumber)) continue;
        const vehicle = type === 10 ? vehicleStyle(Number(row.m_iEquipType)) : undefined;
        if (type === 10 && !vehicle) { this.missing.add(`vehicle-style:${row.m_iEquipType}`); continue; }
        const variants: PreviewVariant[] = [];
        for (const gender of ['m', 'f'] as const) {
          if (Number(row.m_iReqSex) && Number(row.m_iReqSex) !== (gender === 'm' ? 1 : 2)) continue;
          const mesh = table.m_pItemMeshData[Number(row.m_iMesh)];
          const slot = ({ 1: 'shirt', 2: 'pants', 3: 'shoes' } as Record<number, Slot>)[type];
          const worn = !!slot || type === 6 && row.m_iEquipType === 1;
          const mount: Mount | undefined = ({ 0: 'right-hand', 4: 'hat', 5: 'glasses', 6: 'back', 10: 'vehicle' } as Record<number, Mount>)[type];
          // LoadVehicle uses the M fields for both rider genders.
          const vehicleName = mesh?.m_pstrMMeshModelString;
          const item = type === 10
            ? valid(vehicleName) ? this.part([`wear/${vehicleName}.nif`], 'attached', mesh.m_pstrMTextureString, undefined, 'vehicle') : undefined
            : this.meshPart(mesh, gender, worn ? 'worn' : 'attached', mount);
          if (!item) continue;
          item.slot = ITEM_SLOTS[type];
          const replacements: Partial<Record<Slot, ModelPart | null>> = slot ? { [slot]: item } : {};
          if (type === 4) {
            const equip = Number(row.m_iEquipType);
            if ([2, 3].includes(equip)) replacements.hair = null;
            else if ([1, 5].includes(equip)) replacements.hair = this.meshPart(this.xdt.m_pHeadItemTable?.m_pItemMeshData?.[2], gender, 'worn', undefined, 2);
            if ([2, 3].includes(equip)) replacements.face = this.meshPart(this.xdt.m_pFaceItemTable?.m_pItemMeshData?.[2], gender, 'worn', undefined, 2);
          }
          const avatar = this.avatar(gender, replacements);
          if (!avatar) continue;
          avatar.outfitSlot = ITEM_SLOTS[type];
          if (type === 0) avatar.animationContext = { kind: 'avatar', weapon: weaponStyle(Number(row.m_iEquipType)) };
          if (vehicle) { avatar.animationContext = { kind: 'avatar', vehicle }; avatar.idle = `${vehicle}_stand1`; }
          if (type === 4 && [3, 4, 5].includes(Number(row.m_iEquipType))) avatar.hiddenSlots = ['glasses'];
          if (!slot) avatar.parts!.push(item);
          variants.push(avatar);
        }
        const id = `${type}-${row.m_iItemNumber}`;
        if (variants.length) result.items.push({ id, variants, outfit: { selected: [id] } });
      }
    });
    return result;
  }
}
