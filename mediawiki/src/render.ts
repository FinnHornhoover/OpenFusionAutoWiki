import type { Config } from "./types.js";

export type Obj = Record<string, unknown>;
export type Linker = (value: unknown) => string;

const groups: Record<string, Array<[string, string[]]>> = {
  missions: [
    [
      "Mission data",
      [
        "id",
        "level",
        "difficulty",
        "type",
        "inGame",
        "startNPC",
        "journalNPC",
        "endNPC",
        "requiredGuide",
        "requiredGuideNpc",
        "requiredNano",
      ],
    ],
    ["Requirements", ["requiredMissions", "requiredByMissions"]],
    ["Rewards", ["rewards"]],
    ["Tasks", ["tasks"]],
    ["Dialogue", ["barkers"]],
  ],
  npcs: [
    ["NPC data", ["id", "category", "inGame", "height", "scale", "comment"]],
    ["Locations", ["locations"]],
    ["Missions", ["startedMissions", "journaledMissions", "endedMissions"]],
    ["Vendor inventory", ["vendorItems"]],
    ["Transportation", ["transportRoutes"]],
    ["Dialogue", ["missionBarkers", "idleBarkers"]],
  ],
  items: [
    [
      "Item data",
      [
        "id",
        "typeId",
        "itemId",
        "type",
        "displayType",
        "description",
        "rarity",
        "contentLevel",
        "requiredLevel",
        "gender",
        "obtainable",
        "tradeable",
        "sellable",
      ],
    ],
    ["Economy", ["buyPrice", "sellPrice", "maxStack"]],
    [
      "Combat statistics",
      [
        "singleDamage",
        "multiDamage",
        "numberOfTargets",
        "range",
        "rangeValue",
        "coneAngle",
        "fireDelayTime",
        "fireDeliverTime",
        "fireDurationTime",
        "fireInitialTime",
        "rateOfFire",
        "defense",
        "vehicleClass",
        "weaponType",
      ],
    ],
    ["Sources", ["sources"]],
    ["Crates", ["crateDrops", "containingCrates"]],
  ],
  "item-sets": [
    ["Item set data", ["id", "description"]],
    ["Items", ["items"]],
  ],
  codes: [
    ["Code data", ["id", "code"]],
    ["Rewards", ["items"]],
  ],
  monsters: [
    [
      "Monster data",
      [
        "id",
        "category",
        "colorType",
        "level",
        "inGame",
        "comment",
        "height",
        "scale",
        "radius",
      ],
    ],
    [
      "Combat statistics",
      [
        "standardHP",
        "displayHP",
        "attackPower",
        "attackRange",
        "combatRange",
        "sightRange",
        "idleRange",
        "power",
        "protection",
        "accuracy",
        "walkSpeed",
        "runSpeed",
        "respawnTime",
      ],
    ],
    ["Skills", ["activeSkill", "passiveBuff", "supportSkill"]],
    ["Locations", ["locationGroups", "locations"]],
    ["Drops and rewards", ["drops", "miscRewards"]],
    ["Missions", ["missionsRequiring"]],
  ],
  areas: [
    ["Area data", ["id", "zoneName", "areaZone", "width", "height"]],
    ["Infected zone", ["infectedZone"]],
    ["Missions", ["missionsStarting"]],
    ["NPCs and vendors", ["npcs", "vendors"]],
    ["Monsters", ["mobs"]],
    ["Transportation", ["transport"]],
    ["Instances", ["instanceWarps"]],
    ["Pickups", ["eggs"]],
  ],
  instances: [
    ["Instance data", ["id", "areaZone", "areaId", "inGame", "infectedZone"]],
    ["Entry warps", ["entryWarps"]],
    ["Exit warps", ["exitWarps"]],
  ],
  "infected-zones": [
    [
      "Infected Zone data",
      [
        "id",
        "areaZone",
        "areaId",
        "inGame",
        "podCount",
        "timeLimit",
        "maxScore",
        "originalMaxScore",
        "scoreFunction",
        "fmRewardFunction",
      ],
    ],
    ["Warps", ["entryWarps", "exitWarps"]],
    ["Rank rewards", ["rankRewards"]],
  ],
  nanos: [
    ["Nano data", ["id", "nanoType", "comment"]],
    ["Powers", ["powers"]],
    ["Missions", ["missionsRewarding", "missionsRequiring"]],
  ],
};

const labels: Record<string, string> = {
  id: "ID",
  typeId: "Type ID",
  itemId: "Item ID",
  inGame: "In game",
  startNPC: "Start NPC",
  journalNPC: "Journal NPC",
  endNPC: "End NPC",
  requiredLevel: "Required level",
  contentLevel: "Content level",
  buyPrice: "Buy price",
  sellPrice: "Sell price",
  standardHP: "Standard HP",
  displayHP: "Displayed HP",
  areaZone: "Area",
  colorType: "Fusion type",
};

const label = (k: string) =>
  labels[k] ||
  k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());

export const escapeText = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("|", "&#124;");

const present = (v: unknown) =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  (!Array.isArray(v) || v.length > 0);

const scalar = (v: unknown) =>
  v == null || ["string", "number", "boolean"].includes(typeof v);

const isRef = (v: unknown): v is Obj =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  "type" in v &&
  "id" in v &&
  "name" in v;

function cell(v: unknown, link: Linker): string {
  if (isRef(v)) return link(v);
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (scalar(v)) {
    if (typeof v === "string" && v.startsWith("[[") && v.endsWith("]]"))
      return v;
    return v == null || v === "" ? "—" : escapeText(v);
  }

  if (Array.isArray(v)) return v.map((x) => cell(x, link)).join("<br />");
  return Object.entries(v as Obj)
    .filter(([, x]) => present(x))
    .map(([k, x]) => "'''" + label(k) + ":''' " + cell(x, link))
    .join("<br />");
}

function table(rows: Obj[], link: Linker) {
  const cols = [
    ...new Set(
      rows.flatMap((r) =>
        Object.keys(r).filter(
          (k) =>
            present(r[k]) &&
            !["icon", "mapIcon", "points", "routePoints"].includes(k),
        ),
      ),
    ),
  ];
  return (
    '{| class="wikitable sortable"\n! ' +
    cols.map(label).join(" !! ") +
    "\n" +
    rows
      .map((r) => "|-\n| " + cols.map((k) => cell(r[k], link)).join(" || "))
      .join("\n") +
    "\n|}"
  );
}

function defs(e: Obj, fields: string[], link: Linker) {
  return fields
    .filter((k) => present(e[k]))
    .map((k) => "; " + label(k) + "\n: " + cell(e[k], link))
    .join("\n");
}

function section(
  type: string,
  key: string,
  title: string,
  body: string,
  c: Config,
) {
  return (
    "== " +
    title +
    " ==\n<!-- OFAW:" +
    type +
    "-" +
    key +
    ":v" +
    c.schemaVersion +
    " -->\n" +
    body.trim() +
    "\n"
  );
}

const categoryText = (categories: string[]) =>
  categories.map((x) => "[[Category:" + escapeText(x) + "]]").join("\n");
function field(k: string, v: unknown, link: Linker) {
  if (Array.isArray(v)) {
    if (v.every(isRef) || v.every(scalar))
      return v.map((x) => "* " + cell(x, link)).join("\n");
    if (k === "tasks")
      return table(
        (v as Obj[]).map((x, i) => ({
          Order: i + 1,
          ID: x.id,
          Objective: x.objective,
          Type: x.type,
          "On success": x.nextTaskOnEnd,
          "On failure": x.nextTaskOnFail,
          "Time limit": x.timeLimitSeconds,
        })),
        link,
      );
    return table(v as Obj[], link);
  }
  if (v && typeof v === "object")
    return defs(v as Obj, Object.keys(v as Obj), link);
  return "; " + label(k) + "\n: " + cell(v, link);
}
export function renderEntity(
  type: string,
  e: Obj,
  link: Linker,
  c: Config,
  categories: string[],
) {
  const out: string[] = [];
  for (const [title, fields] of groups[type] || [
    ["Game data", Object.keys(e)],
  ]) {
    const found = fields.filter((k) => present(e[k]));
    if (!found.length) continue;
    let body = found.every((k) => scalar(e[k]) || isRef(e[k]))
      ? defs(e, found, link)
      : found
          .map(
            (k) =>
              (found.length > 1 ? "=== " + label(k) + " ===\n" : "") +
              field(k, e[k], link),
          )
          .join("\n\n");
    if (!out.length && e.icon)
      body =
        "[[File:OFAW-" +
        e.icon +
        "|thumb|right|160px|alt=" +
        escapeText(e.name) +
        "|" +
        escapeText(e.name) +
        "]]\n" +
        body;
    out.push(
      section(type, title.toLowerCase().replace(/\W+/g, "-"), title, body, c),
    );
  }
  if (out.length)
    out[out.length - 1] =
      out[out.length - 1].trimEnd() + "\n\n" + categoryText(categories) + "\n";
  return out.join("\n");
}
export function renderIndex(
  type: string,
  rows: Obj[],
  pageLink: (r: Obj) => string,
  c: Config,
  categories: string[],
) {
  const rs = rows.map((r) => {
    const x: Obj = { Name: pageLink(r) };
    for (const k of [
      "id",
      "level",
      "difficulty",
      "type",
      "category",
      "rarity",
      "requiredLevel",
      "areaZone",
      "inGame",
    ])
      if (present(r[k])) x[label(k)] = r[k];
    return x;
  });
  return section(
    "index",
    type,
    "Index",
    table(rs, (v) => String(v ?? "—")) + "\n\n" + categoryText(categories),
    c,
  );
}
export function renderAmbiguity(
  type: string,
  matches: Obj[],
  link: Linker,
  c: Config,
  categories: string[],
) {
  return section(
    type,
    "ambiguity",
    "Matches",
    table(
      matches.map((m) => ({
        Name: link({ type: type.replace(/s$/, ""), id: m.id, name: m.name }),
        Detail: m.detail,
      })),
      link,
    ) +
      "\n\n" +
      categoryText(categories),
    c,
  );
}
