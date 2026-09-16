import AdmZip from 'adm-zip';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeIndex } from '../chunk.js';
import { DATA_OUT } from '../paths.js';
import type { Item, ItemSource } from './types.js';

interface RawRule {
  LevelGap: number;
  LooksItemPriceMultiplier: number;
  StatsItemPriceMultiplier: number;
  SameRarity: number;
  OneRarityDiff: number;
  TwoRarityDiff: number;
  ThreeRarityDiff: number;
}

export function acquisitionPrice(item: Pick<Item, 'sources' | 'playerPrice' | 'rarity'>, slug: string) {
  const vendors = item.sources.filter((source): source is Extract<ItemSource, { kind: 'vendor' }> =>
    source.kind === 'vendor' && Number.isFinite(source.price) && source.price >= 0).sort((a, b) => a.price - b.price);
  if (slug === 'retrobution' && item.playerPrice > 0) return { obtainCost: item.playerPrice, priceSource: 'player', vendor: vendors[0]?.npc ?? null };
  if (vendors[0]) return { obtainCost: vendors[0].price, priceSource: 'vendor', vendor: vendors[0].npc };
  return { obtainCost: item.rarity === 'Ultra Rare' ? 30000 : item.rarity === 'Rare' ? 5000 : 2000, priceSource: 'estimate', vendor: null };
}

export function combinationRules(matrix: Record<string, RawRule>, rawTable: { m_iLevelGap: number; m_fLevelGapStandard: number }[]) {
  const bases = new Map<number, number>();
  for (const row of rawTable.slice(1)) bases.set(row.m_iLevelGap, row.m_fLevelGapStandard);
  return Object.values(matrix)
    .filter(row => Number.isFinite(bases.get(row.LevelGap)))
    .map(row => ({
      gap: row.LevelGap,
      looksMultiplier: row.LooksItemPriceMultiplier,
      statsMultiplier: row.StatsItemPriceMultiplier,
      probabilities: [row.SameRarity, row.OneRarityDiff, row.TwoRarityDiff, row.ThreeRarityDiff]
        .map(chance => chance * bases.get(row.LevelGap)! / 10000),
    }));
}

interface GuideItemRow { m_iItemNumber: number; m_iMentor?: number }

/** Item IDs are scoped by equipment category, not globally unique. */
export function guideItemIds(xdt: Record<string, { m_pItemData?: GuideItemRow[] | Record<string, GuideItemRow> }>): Set<string> {
  const tables = ['m_pWeaponItemTable', 'm_pShirtsItemTable', 'm_pPantsItemTable', 'm_pShoesItemTable'];
  const ids = new Set<string>();
  tables.forEach((table, typeId) => {
    for (const row of Object.values(xdt[table]?.m_pItemData ?? {})) {
      if ((row.m_iMentor ?? 0) > 0) ids.add(typeId + '-' + row.m_iItemNumber);
    }
  });
  return ids;
}

/** Run after items: reuse their resolved prices, vendor references and icons. */
export async function normalizeCombinations(zipPath: string, slug: string): Promise<boolean> {
  const zip = new AdmZip(zipPath);
  const matrix = zip.getEntry('info/combination_info.json');
  const xdt = zip.getEntry('xdt.json');
  if (!matrix || !xdt) {
    await writeIndex(slug, 'combinations', []);
    return false;
  }
  // The derived matrix omits this multiplier. Never silently assume 100%.
  const rawXdt = JSON.parse(xdt.getData().toString('utf8'));
  const guides = guideItemIds(rawXdt);
  const rawTable = rawXdt.m_pCombiningTable?.m_pCombiningData ?? [];
  const rules = combinationRules(JSON.parse(matrix.getData().toString('utf8')), rawTable);
  const dir = join(DATA_OUT, slug, 'items');
  const chunks = await Promise.all((await readdir(dir)).filter(name => /^\d+\.json$/.test(name))
    .map(async name => Object.values(JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, Item>)));
  const rarities = ['Common', 'Uncommon', 'Rare', 'Ultra Rare'];
  const items = chunks.flat().filter(item => item.typeId >= 0 && item.typeId <= 3 && rarities.includes(item.rarity))
    .map(item => {
      return {
        id: item.id, name: item.name, icon: item.icon, typeId: item.typeId,
        weaponType: item.weaponType, level: item.requiredLevel, rarity: item.rarity,
        rarityId: rarities.indexOf(item.rarity) + 1, obtainable: item.obtainable,
        buyPrice: item.buyPrice, gender: item.gender, guideItem: guides.has(item.id),
        singleDamage: item.singleDamage, multiDamage: item.multiDamage, defense: item.defense,
        ...acquisitionPrice(item, slug),
      };
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  await writeIndex(slug, 'combinations', [{ rules, items }]);
  return rules.length > 0 && items.length > 0;
}
