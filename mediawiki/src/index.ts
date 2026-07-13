import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderAmbiguity,
  renderEntity,
  renderIndex,
  escapeText,
  mediaFileName,
  type Obj,
} from "./render.js";
import { buildPhaseOneMaps } from "./maps.js";
import type {
  Config,
  BuildEntry,
  ManifestPage,
  ExportManifest,
} from "./types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = join(root, "site/public/data");
const outRoot = join(root, "mediawiki/output");
const config = JSON.parse(
  await readFile(join(root, "mediawiki/config.json"), "utf8"),
) as Config;

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const typeNames: Record<string, string> = {
  missions: "Missions",
  npcs: "NPCs",
  items: "Items",
  "item-sets": "Item sets",
  codes: "Codes",
  monsters: "Monsters",
  areas: "Areas",
  instances: "Instances",
  "infected-zones": "Infected zones",
  nanos: "Nanos",
  "player-stats": "Player stats",
};

const refTypes: Record<string, string> = {
  mission: "missions",
  npc: "npcs",
  item: "items",
  "item-set": "item-sets",
  code: "codes",
  monster: "monsters",
  area: "areas",
  instance: "instances",
  "infected-zone": "infected-zones",
  nano: "nanos",
};

const clean = (v: unknown) =>
  String(v ?? "Unnamed")
    .replace(/[#[\\\]{}|<>\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Unnamed";
const readJson = async <T>(path: string) =>
  JSON.parse(await readFile(path, "utf8")) as T;

type MediaRecord = ExportManifest["media"][number];
const media = new Map<string, MediaRecord>();

function mediaSource(value: string) {
  return value.startsWith("/")
    ? join(root, "site/public", value.slice(1))
    : join(root, "site/public/icons", value);
}

async function collectMedia(
  value: unknown,
  key = "",
  found = new Set<string>(),
) {
  if (Array.isArray(value)) {
    for (const entry of value) await collectMedia(entry, key, found);
    return found;
  }

  if (!value || typeof value !== "object") {
    if (!/icon$/i.test(key) || typeof value !== "string" || !value)
      return found;

    const name = mediaFileName(value);
    const source = mediaSource(value);
    try {
      const bytes = await readFile(source);
      media.set(name, {
        source: relative(root, source),
        name,
        hash: createHash("sha256").update(bytes).digest("hex"),
      });
      found.add(name);
    } catch {
      // Some source packs reference icons that are not shipped.
    }
    return found;
  }

  for (const [childKey, entry] of Object.entries(value)) {
    await collectMedia(entry, childKey, found);
  }
  return found;
}

const chunkCache = new Map<string, Record<string, Obj>>();
async function chunk(path: string) {
  const old = chunkCache.get(path);
  if (old) return old;
  const loaded = await readJson<Record<string, Obj>>(path);
  if (chunkCache.size >= 24) chunkCache.clear();
  chunkCache.set(path, loaded);
  return loaded;
}

function pageTitle(
  build: string,
  type: string,
  name: unknown,
  id: unknown,
  collides = false,
) {
  return (
    clean(build) +
    "/" +
    (typeNames[type] || clean(type)) +
    "/" +
    clean(name || id) +
    (collides
      ? " (" +
        clean((typeNames[type] || type).replace(/s$/, "")) +
        " " +
        clean(id) +
        ")"
      : "")
  );
}

class ProgressBar {
  private current = 0;
  private label = "starting";
  private lastRender = 0;
  private nextLog = 0;
  private readonly startedAt = Date.now();
  private readonly logInterval: number;

  constructor(private readonly total: number) {
    this.logInterval = Math.max(1, Math.ceil(total / 100));
    this.render(true);
  }

  setLabel(label: string) {
    this.label = label;
  }

  tick() {
    this.current++;
    this.render(false);
  }

  finish() {
    this.current = this.total;
    this.render(true);
    if (process.stdout.isTTY) process.stdout.write("\n");
  }

  private render(force: boolean) {
    const now = Date.now();
    if (process.stdout.isTTY) {
      if (!force && now - this.lastRender < 100) return;
      this.lastRender = now;
      const ratio = this.total > 0 ? this.current / this.total : 1;
      const width = 30;
      const filled = Math.min(width, Math.round(ratio * width));
      const bar = "#".repeat(filled) + "-".repeat(width - filled);
      const percent = (ratio * 100).toFixed(1).padStart(5);
      const elapsed = Math.round((now - this.startedAt) / 1000);
      process.stdout.write(
        "\r[" +
          bar +
          "] " +
          percent +
          "% " +
          this.current.toLocaleString() +
          "/" +
          this.total.toLocaleString() +
          " pages | " +
          this.label +
          " | " +
          elapsed +
          "s",
      );
      return;
    }

    if (!force && this.current < this.nextLog) return;
    const percent = this.total > 0 ? (this.current / this.total) * 100 : 100;
    console.log(
      "MediaWiki build " +
        percent.toFixed(1) +
        "% (" +
        this.current.toLocaleString() +
        "/" +
        this.total.toLocaleString() +
        " pages) - " +
        this.label,
    );
    this.nextLog = this.current + this.logInterval;
  }
}

async function countPages(builds: BuildEntry[]) {
  let total = 0;
  for (const build of builds) {
    if (
      process.env.MEDIAWIKI_BUILD &&
      process.env.MEDIAWIKI_BUILD !== build.slug
    ) {
      continue;
    }

    const indexDir = join(dataRoot, build.slug, "index");
    const files = (await readdir(indexDir)).filter((file) =>
      file.endsWith(".json"),
    );
    for (const file of files) {
      total++;
      if (file === "player-stats.json") continue;

      const routes = await readJson<Record<string, Obj>>(
        join(dataRoot, build.slug, "routes", file),
      );
      total += Object.entries(routes).filter(
        ([segment, target]) => segment === target.canonical,
      ).length;
    }
  }
  return total;
}

class ManifestWriter {
  private pages: ManifestPage[] = [];
  private shards: ExportManifest["shards"] = [];
  private totalPages = 0;

  constructor(private readonly progress: ProgressBar) {}

  async add(page: ManifestPage) {
    this.pages.push(page);
    this.totalPages++;
    this.progress.tick();
    if (this.pages.length >= config.shardSize) await this.flush();
  }

  async finish() {
    await this.flush();
    return { pageCount: this.totalPages, shards: this.shards };
  }

  private async flush() {
    if (!this.pages.length) return;

    const shardPages = this.pages;
    this.pages = [];
    const id = String(this.shards.length).padStart(6, "0");
    const path = join("shards", id + ".json");
    await mkdir(join(outRoot, "shards"), { recursive: true });
    await writeFile(join(outRoot, path), JSON.stringify(shardPages));
    this.shards.push({
      id,
      hash: digest(shardPages.map((page) => page.hash).join("")),
      path,
      pageCount: shardPages.length,
    });
  }
}

async function addPage(
  title: string,
  build: string,
  type: string,
  body: string,
  writer: ManifestWriter,
  pageMedia: string[] = [],
) {
  const path = join("pages", build, type, digest(title).slice(0, 24) + ".wiki");
  await mkdir(dirname(join(outRoot, path)), { recursive: true });
  await writeFile(join(outRoot, path), body);
  const sections = [
    ...body.matchAll(
      /^== ([^=\n]+) ==\n<!-- OFAW:([^:>]+):v\d+ -->\n([\s\S]*?)(?=^== [^=\n]+ ==\n|(?![\s\S]))/gm,
    ),
  ].map((m) => ({ heading: m[1], key: m[2], hash: digest(m[3]) }));
  await writer.add({
    title,
    path,
    hash: digest(body),
    build,
    type,
    sections,
    media: pageMedia,
  });
}

async function main() {
  await mkdir(outRoot, { recursive: true });
  const builds = await readJson<BuildEntry[]>(
    join(root, "site/public/builds.json"),
  );
  console.log("Counting MediaWiki pages...");
  const progress = new ProgressBar(await countPages(builds));
  const writer = new ManifestWriter(progress);

  for (const build of builds) {
    if (
      process.env.MEDIAWIKI_BUILD &&
      process.env.MEDIAWIKI_BUILD !== build.slug
    )
      continue;

    progress.setLabel(build.displayName);
    const dir = join(dataRoot, build.slug, "index");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));

    const indexes = new Map<string, Obj[]>();
    const routes = new Map<string, Record<string, Obj>>();
    const titles = new Map<string, string>();

    for (const file of files) {
      const type = file.slice(0, -5);
      const rows = await readJson<Obj[]>(join(dir, file));
      indexes.set(type, rows);

      if (type === "player-stats") continue;
      const map = await readJson<Record<string, Obj>>(
        join(dataRoot, build.slug, "routes", file),
      );
      routes.set(type, map);

      for (const [segment, target] of Object.entries(map)) {
        if (target.kind === "entity" && segment === target.canonical) {
          const row =
            rows.find((r) => String(r.id) === String(target.id)) ||
            rows.find(
              (r) =>
                Array.isArray(r.members) &&
                (r.members as Obj[]).some(
                  (m) => String(m.id) === String(target.id),
                ),
            );
          const name = row?.name ?? row?.code ?? target.id;
          const collision =
            segment !==
            clean(
              String(name)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-"),
            ).replace(/^-|-$/g, "");
          titles.set(
            type + ":" + target.id,
            pageTitle(build.displayName, type, name, target.id, collision),
          );
        } else if (target.kind === "ambiguity" && segment === target.canonical)
          titles.set(
            type + ":ambiguity:" + segment,
            pageTitle(build.displayName, type, target.title, segment),
          );
      }
    }
    const link = (value: unknown) => {
      const ref = value as Obj;
      const type = refTypes[String(ref.type)] || String(ref.type);
      const title =
        titles.get(type + ":" + ref.id) ||
        pageTitle(build.displayName, type, ref.name, ref.id);
      const icon =
        typeof ref.icon === "string" && ref.icon
          ? "[[File:" +
            mediaFileName(ref.icon) +
            "|24px|alt=|link=" +
            title +
            "]] "
          : "";
      return icon + "[[" + title + "|" + escapeText(ref.name ?? ref.id) + "]]";
    };

    for (const [type, rows] of indexes) {
      const indexTitle =
        clean(build.displayName) + "/" + (typeNames[type] || clean(type));
      if (type === "player-stats") {
        await addPage(
          indexTitle,
          build.slug,
          type,
          renderIndex(type, rows, (r) => escapeText(r.level ?? r.id), config, [
            build.displayName,
            typeNames[type],
          ]),
          writer,
        );
        continue;
      }
      const map = routes.get(type)!;
      const rowLink = (row: Obj) => {
        const target = map[String(row.routeId ?? row.id)];
        const title =
          target?.kind === "ambiguity"
            ? titles.get(type + ":ambiguity:" + target.canonical)
            : titles.get(type + ":" + (target?.id ?? row.id));
        return (
          "[[" +
          (title ||
            pageTitle(build.displayName, type, row.name ?? row.code, row.id)) +
          "|" +
          escapeText(row.name ?? row.code ?? row.id) +
          "]]"
        );
      };
      await addPage(
        indexTitle,
        build.slug,
        type,
        renderIndex(type, rows, rowLink, config, [
          build.displayName,
          typeNames[type],
          "OpenFusion AutoWiki indexes",
        ]),
        writer,
      );
      for (const [segment, target] of Object.entries(map)) {
        if (segment !== target.canonical) continue;
        if (target.kind === "ambiguity") {
          const title = titles.get(type + ":ambiguity:" + segment)!;
          const pageMedia = [...(await collectMedia(target.matches))];
          await addPage(
            title,
            build.slug,
            type,
            renderAmbiguity(type, target.matches as Obj[], link, config, [
              build.displayName,
              typeNames[type],
              "Disambiguation pages",
            ]),
            writer,
            pageMedia,
          );
          continue;
        }
        const bucket = await chunk(
            join(dataRoot, build.slug, type, String(target.chunk) + ".json"),
          ),
          entity = bucket[String(target.id)];
        if (!entity) continue;
        const title = titles.get(type + ":" + target.id)!;
        const cats = [build.displayName, typeNames[type]];
        for (const key of [
          "rarity",
          "type",
          "displayType",
          "category",
          "areaZone",
          "nanoType",
        ])
          if (entity[key]) cats.push(String(entity[key]));
        const generatedMaps = await buildPhaseOneMaps(type, entity);
        for (const map of generatedMaps) media.set(map.name, map.media);
        const pageMedia = [
          ...(await collectMedia(entity)),
          ...generatedMaps.map((map) => map.name),
        ];
        await addPage(
          title,
          build.slug,
          type,
          renderEntity(type, entity, link, config, cats, generatedMaps),
          writer,
          pageMedia,
        );
      }
    }
    chunkCache.clear();
  }
  const output = await writer.finish();
  progress.finish();
  const manifest: ExportManifest = {
    schemaVersion: config.schemaVersion,
    generatedAt: new Date().toISOString(),
    pageCount: output.pageCount,
    shards: output.shards,
    media: [...media.values()],
  };
  await writeFile(
    join(outRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    "MediaWiki export: " +
      output.pageCount +
      " pages, " +
      output.shards.length +
      " shards",
  );
}
await main();
