import type { Obj } from "./render.js";

const WORLD_SIZE = 51200 * 16;
const BASE_MAP = "/minimap/all.png";

interface Point {
  x: number;
  y: number;
  icon: string;
  title?: string;
  link?: string;
}

interface Line {
  points: Array<{ x: number; y: number }>;
  title?: string;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WikiMap {
  caption: string;
  wikitext: string;
  media: string[];
}

const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function coordinate(x: number, y: number) {
  const latitude = (y / WORLD_SIZE) * 100;
  const longitude = (x / WORLD_SIZE) * 100;
  return latitude.toFixed(7) + ", " + longitude.toFixed(7);
}

function mapText(value: unknown) {
  return String(value ?? "")
    .replace(/[~;\n\r]/g, " ")
    .replace(/\|/g, "&#124;")
    .trim();
}

function markerPoints(entry: Obj) {
  if (Array.isArray(entry.points) && entry.points.length) {
    return (entry.points as Obj[])
      .map((point) => ({ x: finite(point.x), y: finite(point.y) }))
      .filter(
        (point): point is { x: number; y: number } =>
          point.x !== null && point.y !== null,
      );
  }
  const x = finite(entry.x);
  const y = finite(entry.y);
  return x === null || y === null ? [] : [{ x, y }];
}

function transportIcon(moveType: unknown) {
  const value = String(moveType ?? "").toLowerCase();
  if (value.includes("scamper")) return "/minimap/mapicons/scamper_npc.png";
  if (value.includes("monkey"))
    return "/minimap/mapicons/monkey_skyway_npc.png";
  if (value.includes("slider")) return "/minimap/mapicons/world_icon.png";
  if (value.includes("woosh")) return "/minimap/mapicons/warp_npc.png";
  return "/minimap/mapicons/location_npc.png";
}

function validPoint(point: Point) {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= WORLD_SIZE &&
    point.y <= WORLD_SIZE &&
    point.icon !== ""
  );
}

export const mediaName = (path: string) =>
  "OFAW-" + path.replace(/^\/+/, "").replaceAll("/", "-");

function renderMap(
  caption: string,
  points: Point[],
  lines: Line[] = [],
  bounds?: Bounds,
): WikiMap | null {
  const unique = [
    ...new Map(
      points
        .filter(validPoint)
        .map((point) => [
          [point.x, point.y, point.icon, point.title, point.link].join(":"),
          point,
        ]),
    ).values(),
  ];
  const validLines = lines.filter((line) => line.points.length >= 2);
  if (!unique.length && !validLines.length) return null;

  const markerText = unique
    .map((point) => {
      const link = point.link ? "[[" + point.link + "|View article]]" : "";
      return (
        coordinate(point.x, point.y) +
        "~" +
        mapText(point.title) +
        "~" +
        link +
        "~File:" +
        mediaName(point.icon)
      );
    })
    .join(";\n");
  const lineText = validLines
    .map(
      (line) =>
        line.points.map((point) => coordinate(point.x, point.y)).join(":") +
        "~" +
        mapText(line.title) +
        "~~#4b83b8~0.8~3",
    )
    .join(";\n");

  let center = "";
  let zoom = "";
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    center = coordinate(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    const extent = Math.max(bounds.width, bounds.height);
    zoom = String(
      Math.max(1, Math.min(8, Math.floor(Math.log2(WORLD_SIZE / extent)))),
    );
  }

  const parameters = [
    markerText,
    "|service=leaflet",
    "|image layer=File:" + mediaName(BASE_MAP),
    "|width=100%",
    "|height=620px",
    "|fullscreen=yes",
    "|scrollwheelzoom=yes",
    "|cluster=no",
    center ? "|centre=" + center : "",
    zoom ? "|zoom=" + zoom : "",
    lineText ? "|lines=" + lineText : "",
  ].filter(Boolean);

  return {
    caption,
    wikitext: "{{#display_map:\n" + parameters.join("\n") + "\n}}",
    media: [
      BASE_MAP,
      ...new Set(unique.map((point) => point.icon).filter(Boolean)),
    ],
  };
}

function entries(entity: Obj, key: string) {
  return (entity[key] as Obj[] | undefined) ?? [];
}

function pointFor(entry: Obj, defaultIcon: string): Point[] {
  const ref = entry.ref as Obj | undefined;
  return markerPoints(entry).map((point) => ({
    ...point,
    icon: String(entry.mapIcon ?? entry.icon ?? defaultIcon),
    title: String(ref?.name ?? entry.name ?? "Location"),
  }));
}

function areaOverview(entity: Obj) {
  const points: Point[] = [];
  for (const key of ["npcs", "vendors"]) {
    for (const entry of entries(entity, key)) {
      if (entry.showOnMap !== false)
        points.push(...pointFor(entry, "/minimap/mapicons/location_npc.png"));
    }
  }
  for (const egg of entries(entity, "eggs"))
    points.push(...pointFor(egg, "/minimap/mapicons/world_egg_shiny_npc.png"));
  for (const route of entries(entity, "transportation")) {
    for (const stop of entries(route, "stops")) {
      if (stop.isHere)
        points.push(...pointFor(stop, transportIcon(route.moveType)));
    }
  }
  for (const warp of entries(entity, "instanceWarps")) {
    const location = warp.entryLocation as Obj | undefined;
    if (location)
      points.push(...pointFor(location, "/minimap/mapicons/warp_npc.png"));
  }
  return points;
}

function areaLines(entity: Obj) {
  const lines: Line[] = [];
  for (const route of entries(entity, "transportation")) {
    const points = ((route.routePoints as Obj[] | undefined) ?? [])
      .map((point) => ({ x: finite(point.x), y: finite(point.y) }))
      .filter(
        (point): point is { x: number; y: number } =>
          point.x !== null && point.y !== null,
      );
    if (points.length >= 2)
      lines.push({
        points,
        title: String(route.name ?? route.moveType ?? "Route"),
      });
  }
  return lines;
}

function warpPoints(entity: Obj) {
  const points: Point[] = [];
  for (const key of ["entryWarps", "exitWarps"]) {
    for (const warp of entries(entity, key)) {
      for (const locationKey of ["entryLocation", "exitLocation"]) {
        const location = warp[locationKey] as Obj | undefined;
        if (location)
          points.push(...pointFor(location, "/minimap/mapicons/warp_npc.png"));
      }
    }
  }
  return points;
}

function locationPoints(entity: Obj) {
  const points: Point[] = [];
  const fallback = String(
    entity.mapIcon ?? entity.icon ?? "/minimap/mapicons/location_npc.png",
  );
  for (const location of entries(entity, "locations"))
    points.push(...pointFor(location, fallback));
  for (const group of entries(entity, "locationGroups")) {
    const icon = String(group.mapIcon ?? fallback);
    points.push(...pointFor(group, icon));
    for (const location of entries(group, "locations"))
      points.push(...pointFor(location, icon));
  }
  return points;
}

export function buildWikiMaps(type: string, entity: Obj) {
  const maps: WikiMap[] = [];
  if (type === "areas") {
    const bounds = {
      x: Number(entity.x),
      y: Number(entity.y),
      width: Number(entity.width),
      height: Number(entity.height),
    };
    const overview = renderMap(
      String(entity.name) + " locations",
      areaOverview(entity),
      areaLines(entity),
      bounds,
    );
    const monsters = renderMap(
      String(entity.name) + " monsters",
      entries(entity, "mobs").flatMap((entry) =>
        pointFor(entry, "/minimap/mapicons/mob_npc.png"),
      ),
      [],
      bounds,
    );
    if (overview) maps.push(overview);
    if (monsters) maps.push(monsters);
  } else if (type === "instances" || type === "infected-zones") {
    const map = renderMap(
      String(entity.name) + " entrances and exits",
      warpPoints(entity),
    );
    if (map) maps.push(map);
  } else if (type === "npcs" || type === "monsters") {
    const map = renderMap(
      String(entity.name) + " locations",
      locationPoints(entity),
    );
    if (map) maps.push(map);
  }
  return maps;
}

export function buildWorldMapFromAreas(
  areas: Obj[],
  link: (ref: Obj) => string,
) {
  const points: Point[] = [];
  const lines: Line[] = [];
  for (const area of areas) {
    const x = finite(area.x);
    const y = finite(area.y);
    const width = finite(area.width);
    const height = finite(area.height);
    if (x !== null && y !== null && width !== null && height !== null) {
      const name = String(area.name ?? area.fullName ?? "Area");
      points.push({
        x: x + width / 2,
        y: y + height / 2,
        icon: "/minimap/mapicons/world_icon.png",
        title: name,
        link: link({ type: "area", id: area.id, name }),
      });
    }
    points.push(...areaOverview(area));
    points.push(
      ...entries(area, "mobs").flatMap((entry) =>
        pointFor(entry, "/minimap/mapicons/mob_npc.png"),
      ),
    );
    lines.push(...areaLines(area));
  }
  return renderMap("FusionFall world map", points, lines);
}
