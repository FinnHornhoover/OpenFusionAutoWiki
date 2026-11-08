import AdmZip from 'adm-zip';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaPopulation, PopulationKind, PreviewVariant } from '../../../shared/objects.js';
import { preferredAnimation, animationChoices } from '../../../shared/animations.js';
import { DATA_OUT } from '../paths.js';
import type { Recipes, Xdt } from './recipes.js';
import type { Pack } from './pack.js';

interface Spawn { ID: string | number; TypeID: number; TypeName: string; InstanceID?: number; X: number; Y: number; Z: number; Angle?: number }
interface Area { id: string; x: number; y: number; width: number; height: number }

export function buildPopulation(slug: string, zip: AdmZip, xdt: Xdt, recipes: Recipes, pack: Pack, stage: (variant: PreviewVariant) => void): void {
  const areas = Object.values(JSON.parse(readFileSync(join(DATA_OUT, slug, 'areas/0.json'), 'utf8')) as Record<string, Area>);
  const variants = new Map(recipes.entities().npcs.map((row) => [Number(row.id), row.variants[0]]));
  const npcRows = new Map(xdt.m_pNpcTable.m_pNpcData.map((row) => [Number(row.m_iNpcNumber), row]));
  const sources: [PopulationKind, string][] = [['npcs', 'npc'], ['monsters', 'mob'], ['eggs', 'egg']];
  const models = new Map<string, PreviewVariant>();
  const spawns = sources.flatMap(([kind, file]) => {
    const entry = zip.getEntries().find((e) => e.entryName.endsWith(`info/${file}_info.json`));
    if (!entry) throw new Error(`Missing ${file} placements`);
    return Object.values(JSON.parse(entry.getData().toString('utf8')) as Record<string, Record<string, Spawn>>).flatMap((group) => Object.values(group).map((spawn) => ({ kind, spawn })));
  }).filter(({ kind, spawn }) => (spawn.InstanceID ?? 0) === 0 && [spawn.X, spawn.Y, spawn.Z].every(Number.isFinite) && (kind === 'eggs' || Number(npcRows.get(spawn.TypeID)?.m_iNpcType) < 100));
  const directory = join(DATA_OUT, slug, 'previews/population');
  mkdirSync(directory, { recursive: true });
  const missing = new Map<string, string>();
  for (const area of areas) {
    const output: AreaPopulation = { models: {}, placements: [] };
    for (const { kind, spawn } of spawns) {
      if (spawn.X < area.x || spawn.X >= area.x + area.width || spawn.Y < area.y || spawn.Y >= area.y + area.height) continue;
      const key = `${kind}:${spawn.TypeID}`;
      let variant = models.get(key);
      if (!variant) {
        const source = kind === 'eggs' ? recipes.egg(spawn.TypeID) : variants.get(spawn.TypeID);
        if (source) {
          variant = structuredClone(source);
          stage(variant);
          const context = variant.animationContext ?? { kind: 'creature' };
          const choices = variant.animations ?? animationChoices(pack.animationClips(variant.model.model), context);
          const idle = preferredAnimation(choices.filter((c) => c.group === 'Idle'), context, variant.idle);
          variant.animations = choices.filter((c) => c.name === idle);
          variant.idle = idle;
          models.set(key, variant);
        }
      }
      if (variant) output.models[key] = variant;
      else missing.set(key, spawn.TypeName);
      output.placements.push({ id: `${kind}:${spawn.ID}`, kind, model: key, name: spawn.TypeName, entity: spawn.TypeID, position: [-spawn.X / 100, spawn.Z / 100, spawn.Y / 100], yaw: kind === 'eggs' ? 0 : -(Number(spawn.Angle ?? 0) + 180) * Math.PI / 180 });
    }
    writeFileSync(join(directory, `${area.id}.json`), JSON.stringify(output));
  }
  writeFileSync(join(directory, 'coverage.json'), JSON.stringify({ missing: Object.fromEntries(missing) }));
}
