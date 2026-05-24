/**
 * Mapping between FusionFall game-world coordinates and the OFDropEditor
 * minimap (2048×2048 px stitched from 16×16 tiles, each 128 px wide and
 * representing 51,200 game units).
 *
 * Per OFDropEditor's MapRegionInfo.java:
 *   tileRow  = TILE_COUNT - 1 - y / TILE_SIZE
 *   yPixel   = pxTileSize - 1 - (y % TILE_SIZE) * pxTileSize / TILE_SIZE
 * Worked out continuously, absolute pixel Y = MINIMAP_PX - y * px-per-game-unit.
 * Game world Y increases northward; minimap Y goes down, so we flip.
 */
export const MINIMAP_PX = 2048;
export const TILE_PX = 128;
export const TILE_COUNT = 16;
export const TILE_GAME_UNITS = 51200;
export const WORLD_GAME_UNITS = TILE_GAME_UNITS * TILE_COUNT; // 819,200
export const PX_PER_GAME_UNIT = MINIMAP_PX / WORLD_GAME_UNITS;

export interface MinimapPx { px: number; py: number; }

/** World (x, y) → minimap pixel coordinates (origin top-left). */
export function worldToPx(x: number, y: number): MinimapPx {
  return {
    px: x * PX_PER_GAME_UNIT,
    py: MINIMAP_PX - y * PX_PER_GAME_UNIT,
  };
}

/** Half-extent in minimap pixels for a given game-unit half-extent. */
export function gameToPxExtent(gameExtent: number): number {
  return gameExtent * PX_PER_GAME_UNIT;
}
