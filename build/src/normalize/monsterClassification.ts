const BETA_WORLD_BOSS_IDS = new Set([454, 461]);
const BETA_ECHO_WORLD_BOSS_IDS = new Set([3563, 3564, 3570, 3572]);
const RETROBUTION_WORLD_BOSS_IDS = new Set([
  151, // Rage Roadkiller
  454, // Don Doom
  461, // Bad Max
  3169, // Mini Fusion Echo Echo
  3172, // Mega Fusion Echo Echo
  3173, // Dark Horntail
  3185, // Shipwrecker
  3369, // The Weeper
]);

export function isWorldBoss(build: string, id: number): boolean {
  if (build === 'retrobution') return RETROBUTION_WORLD_BOSS_IDS.has(id);
  const beta = /^beta-(\d{8})(?:-fixed)?$/.exec(build);
  if (!beta) return false;
  return BETA_WORLD_BOSS_IDS.has(id)
    || (beta[1] >= '20101123' && BETA_ECHO_WORLD_BOSS_IDS.has(id))
    || (beta[1] >= '20110912' && id === 3763);
}

export function monsterMapIcon(build: string, id: number, name: string): string {
  return isWorldBoss(build, id) || (name.includes('Fusion') && !name.includes('Fusion Spawn'))
    ? '/minimap/mapicons/lair_fusion_boss_monster.png'
    : '/minimap/mapicons/other_monster.png';
}
