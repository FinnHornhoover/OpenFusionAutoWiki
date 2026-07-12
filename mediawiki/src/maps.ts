import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import type { Obj } from "./render.js";
import type { ExportManifest } from "./types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baseMapPath = join(root, "site/public/minimap/all.png");
const mediaDir = join(root, "mediawiki/output/media");

const MINIMAP_SIZE = 2048;
const WORLD_SIZE = 51200 * 16;
const PX_PER_GAME_UNIT = MINIMAP_SIZE / WORLD_SIZE;
const OUTPUT_SIZE = 768;
const MARKER_SIZE = 28;

interface Point {
  x: number;
  y: number;
  icon: string;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeneratedMap {
  name: string;
  caption: string;
  media: ExportManifest["media"][number];
}

const generated = new Map<string, GeneratedMap>();
const iconBuffers = new Map<string, Buffer>();

function worldToPx(x: number, y: number) {
  return { x: x * PX_PER_GAME_UNIT, y: MINIMAP_SIZE - y * PX_PER_GAME_UNIT };
}

function iconPath(icon: string) {
  return icon.startsWith("/")
    ? join(root, "site/public", icon.slice(1))
    : join(root, "site/public/icons", icon);
}

async function markerBuffer(icon: string) {
  const existing = iconBuffers.get(icon);
  if (existing) return existing;

  const buffer = await sharp(iconPath(icon))
    .resize(MARKER_SIZE, MARKER_SIZE, { fit: "contain" })
    .png()
    .toBuffer();
  iconBuffers.set(icon, buffer);
  return buffer;
}

function transportIcon(moveType: string) {
  const value = moveType.toLowerCase();
  if (value.includes("scamper")) return "/minimap/mapicons/scamper_npc.png";
  if (value.includes("monkey"))
    return "/minimap/mapicons/monkey_skyway_npc.png";
  if (value.includes("slider")) return "/minimap/mapicons/world_icon.png";
  if (value.includes("woosh")) return "/minimap/mapicons/warp_npc.png";
  return "/minimap/mapicons/location_npc.png";
}

function markerPoints(entry: Obj): Array<{ x: number; y: number }> {
  if (Array.isArray(entry.points) && entry.points.length) {
    return (entry.points as Obj[]).map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
    }));
  }
  return [{ x: Number(entry.x), y: Number(entry.y) }];
}

function validPoint(point: Point) {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= WORLD_SIZE &&
    point.y <= WORLD_SIZE &&
    point.icon !== ""
  );
}

function cropFor(bounds: Bounds | undefined, points: Point[]) {
  let minX: number;
  let maxX: number;
  let minY: number;
  let maxY: number;

  if (bounds && bounds.width > 0 && bounds.height > 0) {
    minX = bounds.x;
    maxX = bounds.x + bounds.width;
    minY = bounds.y;
    maxY = bounds.y + bounds.height;
  } else {
    minX = Math.min(...points.map((point) => point.x));
    maxX = Math.max(...points.map((point) => point.x));
    minY = Math.min(...points.map((point) => point.y));
    maxY = Math.max(...points.map((point) => point.y));
  }

  const center = worldToPx((minX + maxX) / 2, (minY + maxY) / 2);
  const widthPx = Math.max((maxX - minX) * PX_PER_GAME_UNIT, 96);
  const heightPx = Math.max((maxY - minY) * PX_PER_GAME_UNIT, 96);
  const size = Math.min(
    MINIMAP_SIZE,
    Math.ceil(Math.max(widthPx, heightPx) * 1.25),
  );
  const left = Math.max(
    0,
    Math.min(MINIMAP_SIZE - size, Math.round(center.x - size / 2)),
  );
  const top = Math.max(
    0,
    Math.min(MINIMAP_SIZE - size, Math.round(center.y - size / 2)),
  );

  return { left, top, width: size, height: size };
}

async function renderMap(
  kind: string,
  caption: string,
  points: Point[],
  bounds?: Bounds,
): Promise<GeneratedMap | null> {
  const filtered = points.filter(validPoint);
  if (!filtered.length) return null;

  const uniquePoints = [
    ...new Map(
      filtered.map((point) => [
        [point.x, point.y, point.icon].join(":"),
        point,
      ]),
    ).values(),
  ];
  const crop = cropFor(bounds, uniquePoints);
  const spec = JSON.stringify({ kind, crop, points: uniquePoints });
  const hash = createHash("sha256").update(spec).digest("hex");
  const cached = generated.get(hash);
  if (cached) return { ...cached, caption };

  const name = "OFAW-map-" + hash.slice(0, 24) + ".png";
  const outputPath = join(mediaDir, name);
  const scale = OUTPUT_SIZE / crop.width;
  const composites = [];

  for (const point of uniquePoints) {
    try {
      const position = worldToPx(point.x, point.y);
      const left = Math.round(
        (position.x - crop.left) * scale - MARKER_SIZE / 2,
      );
      const top = Math.round((position.y - crop.top) * scale - MARKER_SIZE / 2);
      if (
        left < -MARKER_SIZE ||
        top < -MARKER_SIZE ||
        left > OUTPUT_SIZE ||
        top > OUTPUT_SIZE
      ) {
        continue;
      }
      composites.push({ input: await markerBuffer(point.icon), left, top });
    } catch {
      // Ignore source-pack marker paths that do not exist.
    }
  }

  await mkdir(mediaDir, { recursive: true });
  const bytes = await sharp(baseMapPath)
    .extract(crop)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE)
    .composite(composites)
    .png({ compressionLevel: 9, palette: true })
    .toFile(outputPath);

  const result: GeneratedMap = {
    name,
    caption,
    media: {
      source: relative(root, outputPath),
      name,
      hash:
        bytes.size > 0
          ? createHash("sha256")
              .update(await readFile(outputPath))
              .digest("hex")
          : hash,
    },
  };
  generated.set(hash, result);
  return result;
}

function areaOverview(entity: Obj) {
  const points: Point[] = [];

  for (const key of ["npcs", "vendors"]) {
    for (const entry of (entity[key] as Obj[] | undefined) ?? []) {
      if (entry.showOnMap === false) continue;
      for (const point of markerPoints(entry)) {
        points.push({ ...point, icon: String(entry.mapIcon ?? "") });
      }
    }
  }

  for (const egg of (entity.eggs as Obj[] | undefined) ?? []) {
    points.push({
      x: Number(egg.x),
      y: Number(egg.y),
      icon: "/minimap/mapicons/world_egg_shiny_npc.png",
    });
  }

  for (const route of (entity.transportation as Obj[] | undefined) ?? []) {
    for (const stop of (route.stops as Obj[] | undefined) ?? []) {
      if (!stop.isHere) continue;
      points.push({
        x: Number(stop.x),
        y: Number(stop.y),
        icon: transportIcon(String(route.moveType ?? "")),
      });
    }
  }

  for (const warp of (entity.instanceWarps as Obj[] | undefined) ?? []) {
    const location = warp.entryLocation as Obj | undefined;
    if (!location) continue;
    points.push({
      x: Number(location.x),
      y: Number(location.y),
      icon: "/minimap/mapicons/warp_npc.png",
    });
  }

  return points;
}

function areaMonsters(entity: Obj) {
  const points: Point[] = [];
  for (const entry of (entity.mobs as Obj[] | undefined) ?? []) {
    for (const point of markerPoints(entry)) {
      points.push({ ...point, icon: String(entry.mapIcon ?? "") });
    }
  }
  return points;
}

function warpPoints(entity: Obj) {
  const points: Point[] = [];
  for (const key of ["entryWarps", "exitWarps"]) {
    for (const warp of (entity[key] as Obj[] | undefined) ?? []) {
      for (const locationKey of ["entryLocation", "exitLocation"]) {
        const location = warp[locationKey] as Obj | undefined;
        if (!location) continue;
        points.push({
          x: Number(location.x),
          y: Number(location.y),
          icon: "/minimap/mapicons/warp_npc.png",
        });
      }
    }
  }
  return points;
}

export async function buildPhaseOneMaps(type: string, entity: Obj) {
  const maps: GeneratedMap[] = [];

  if (type === "areas") {
    const bounds = {
      x: Number(entity.x),
      y: Number(entity.y),
      width: Number(entity.width),
      height: Number(entity.height),
    };
    const overview = await renderMap(
      "area-overview",
      String(entity.name) + " locations",
      areaOverview(entity),
      bounds,
    );
    const monsters = await renderMap(
      "area-monsters",
      String(entity.name) + " monsters",
      areaMonsters(entity),
      bounds,
    );
    if (overview) maps.push(overview);
    if (monsters) maps.push(monsters);
  }

  if (type === "instances" || type === "infected-zones") {
    const caption =
      String(entity.name) +
      (type === "instances" ? " entrances and exits" : " warps");
    const map = await renderMap(type + "-warps", caption, warpPoints(entity));
    if (map) maps.push(map);
  }

  return maps;
}
