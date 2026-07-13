// @ts-nocheck -- route JSON is validated by the normalization pipeline.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWikiMaps, buildWorldMapFromAreas, mediaName } from "./maps.js";
import { orderBuilds, tabAnchor } from "./routing.js";
import {
  escapeText,
  mediaFileName,
  renderAmbiguity,
  renderEntity,
  renderIndex,
} from "./render.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = join(root, "site/public/data");
const outRoot = join(root, "mediawiki/output");
const config = JSON.parse(
  await readFile(join(root, "mediawiki/config.json"), "utf8"),
);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const typeNames = {
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
const refTypes = {
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
const clean = (value) =>
  String(value ?? "Unnamed")
    .replace(/[#[\\\]{}|<>\n\r\t/]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Unnamed";
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const topicKey = (semantic) => "topic:" + semantic;
const exactKey = (type, id) => "exact:" + type + ":" + String(id);
const refKey = (build, type, id) => build + ":" + type + ":" + String(id);
const buildTypeKey = (build, type) => build + ":" + type;
const media = new Map();
function mediaSource(value) {
  return value.startsWith("/")
    ? join(root, "site/public", value.slice(1))
    : join(root, "site/public/icons", value);
}
async function registerMedia(value, found) {
  if (!value) return;
  const name = mediaName(value);
  if (media.has(name)) {
    found?.add(name);
    return;
  }
  const source = mediaSource(value);
  try {
    const bytes = await readFile(source);
    media.set(name, {
      source: relative(root, source),
      name,
      hash: createHash("sha256").update(bytes).digest("hex"),
    });
    found?.add(name);
  } catch {
    // Source packs occasionally reference files they do not ship.
  }
}
async function collectMedia(value, key = "", found = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) await collectMedia(entry, key, found);
    return found;
  }
  if (!value || typeof value !== "object") {
    if (/icon$/i.test(key) && typeof value === "string")
      await registerMedia(value, found);
    return found;
  }
  for (const [childKey, entry] of Object.entries(value))
    await collectMedia(entry, childKey, found);
  return found;
}
const chunkCache = new Map();
async function chunk(path) {
  const cached = chunkCache.get(path);
  if (cached) return cached;
  const loaded = await readJson(path);
  if (chunkCache.size >= 24) chunkCache.clear();
  chunkCache.set(path, loaded);
  return loaded;
}
function supportTitle(key, build) {
  return (
    "Project:OpenFusionAutoWiki/Data/" + digest(key).slice(0, 24) + "/" + build
  );
}
function renderShell(key, available, categories) {
  const tabs = available
    .map(
      (build) => supportTitle(key, build.slug) + "|" + clean(build.displayName),
    )
    .join("\n");
  const links = available
    .map(
      (build) =>
        "[[#" + tabAnchor(build) + "|" + escapeText(build.displayName) + "]]",
    )
    .join(" · ");
  const categoryText = categories
    .map((category) => "[[Category:" + escapeText(category) + "]]")
    .join("\n");
  return (
    "== Game data ==\n" +
    "<!-- OFAW:topic-data:v" +
    config.schemaVersion +
    " -->\n" +
    "__NOEDITSECTION__\n" +
    "<tabbertransclude>\n" +
    tabs +
    "\n</tabbertransclude>\n\n" +
    "'''All builds:''' " +
    links +
    "\n\n" +
    categoryText +
    "\n"
  );
}
class ProgressBar {
  total;
  current = 0;
  last = 0;
  constructor(total) {
    this.total = total;
  }
  tick(label) {
    this.current++;
    if (process.stdout.isTTY) {
      if (this.current !== this.total && this.current - this.last < 250) return;
      const ratio = this.total ? this.current / this.total : 1;
      const width = 30;
      const filled = Math.round(width * ratio);
      process.stdout.write(
        "\r[" +
          "#".repeat(filled) +
          "-".repeat(width - filled) +
          "] " +
          (ratio * 100).toFixed(1).padStart(5) +
          "% " +
          label.slice(0, 70),
      );
      this.last = this.current;
    } else if (this.current === this.total || this.current - this.last >= 500) {
      console.log(
        "MediaWiki build " + this.current + "/" + this.total + " - " + label,
      );
      this.last = this.current;
    }
  }
  finish() {
    if (process.stdout.isTTY) process.stdout.write("\n");
  }
}
class ManifestWriter {
  progress;
  pages = [];
  shards = [];
  titles = new Set();
  totalPages = 0;
  constructor(progress) {
    this.progress = progress;
  }
  async add(page) {
    if (this.titles.has(page.title)) {
      throw new Error("Duplicate MediaWiki page title: " + page.title);
    }
    this.titles.add(page.title);
    this.pages.push(page);
    this.totalPages++;
    this.progress.tick(page.title);
    if (this.pages.length >= config.shardSize) await this.flush();
  }
  async finish() {
    await this.flush();
    return { pageCount: this.totalPages, shards: this.shards };
  }
  async flush() {
    if (!this.pages.length) return;
    const pages = this.pages;
    this.pages = [];
    const id = String(this.shards.length).padStart(6, "0");
    const path = join("shards", id + ".json");
    await mkdir(join(outRoot, "shards"), { recursive: true });
    await writeFile(join(outRoot, path), JSON.stringify(pages));
    this.shards.push({
      id,
      path,
      pageCount: pages.length,
      hash: digest(pages.map((page) => page.hash).join("")),
    });
  }
}
async function addPage(
  title,
  build,
  type,
  ownership,
  body,
  writer,
  pageMedia = [],
) {
  const bytes = Buffer.byteLength(body);
  if (bytes > config.maxArticleBytes)
    throw new Error(title + " exceeds maxArticleBytes (" + bytes + ")");
  const path = join(
    "pages",
    ownership,
    build || "shared",
    digest(title).slice(0, 24) + ".wiki",
  );
  await mkdir(dirname(join(outRoot, path)), { recursive: true });
  await writeFile(join(outRoot, path), body);
  const sections =
    ownership === "section"
      ? [
          ...body.matchAll(
            /^== ([^=\n]+) ==\n<!-- OFAW:([^:>]+):v\d+ -->\n([\s\S]*?)(?=^== [^=\n]+ ==\n|(?![\s\S]))/gm,
          ),
        ].map((match) => ({
          heading: match[1],
          key: match[2],
          hash: digest(match[3]),
        }))
      : [];
  await writer.add({
    title,
    path,
    hash: digest(body),
    build,
    type,
    ownership,
    sections,
    media: [...new Set(pageMedia)],
  });
}
function ensureTopic(topics, key, exact = false) {
  let topic = topics.get(key);
  if (!topic) {
    topic = {
      key,
      title: "",
      names: new Map(),
      variants: new Map(),
      types: new Set(),
      exact,
    };
    topics.set(key, topic);
  }
  return topic;
}
function addVariant(topic, variant) {
  const variants = topic.variants.get(variant.build) ?? [];
  const duplicate = variants.some(
    (old) =>
      old.type === variant.type &&
      old.kind === variant.kind &&
      (old.kind !== "entity" ||
        variant.kind !== "entity" ||
        old.id === variant.id),
  );
  if (!duplicate) variants.push(variant);
  topic.variants.set(variant.build, variants);
  topic.types.add(variant.type);
  topic.names.set(variant.build, variant.name);
}
async function buildCatalog(builds) {
  const ambiguousIds = new Set();
  const exactInfo = new Map();
  for (const build of builds) {
    const routeDir = join(dataRoot, build.slug, "routes");
    for (const file of (await readdir(routeDir)).filter((name) =>
      name.endsWith(".json"),
    )) {
      const type = file.slice(0, -5);
      const routes = await readJson(join(routeDir, file));
      for (const [segment, target] of Object.entries(routes)) {
        if (segment !== target.canonical || target.kind !== "ambiguity")
          continue;
        for (const match of target.matches) {
          const key = type + ":" + String(match.id);
          ambiguousIds.add(key);
          let info = exactInfo.get(key);
          if (!info) {
            info = {
              type,
              id: String(match.id),
              baseSemantic: segment,
              names: new Map(),
              details: new Map(),
            };
            exactInfo.set(key, info);
          }
          info.names.set(
            build.slug,
            String(match.name ?? target.title ?? segment),
          );
          info.details.set(build.slug, String(match.detail ?? ""));
        }
      }
    }
  }
  const topics = new Map();
  const entityTopics = new Map();
  const indexRows = new Map();
  const routesByBuildType = new Map();
  for (const build of builds) {
    const indexDir = join(dataRoot, build.slug, "index");
    for (const file of (await readdir(indexDir)).filter((name) =>
      name.endsWith(".json"),
    )) {
      const type = file.slice(0, -5);
      const rows = await readJson(join(indexDir, file));
      indexRows.set(buildTypeKey(build.slug, type), rows);
      if (type === "player-stats") continue;
      const routes = await readJson(join(dataRoot, build.slug, "routes", file));
      routesByBuildType.set(buildTypeKey(build.slug, type), routes);
      const rowsById = new Map();
      for (const row of rows) {
        rowsById.set(String(row.id), row);
        for (const member of row.members ?? [])
          rowsById.set(String(member.id), row);
      }
      for (const [segment, target] of Object.entries(routes)) {
        if (segment !== target.canonical) continue;
        if (target.kind === "ambiguity") {
          const topic = ensureTopic(topics, topicKey(segment));
          addVariant(topic, {
            kind: "ambiguity",
            build: build.slug,
            type,
            name: String(target.title ?? segment),
            matches: target.matches,
          });
          continue;
        }
        if (target.kind !== "entity") continue;
        const id = String(target.id);
        const row = rowsById.get(id);
        const name = String(row?.name ?? row?.code ?? target.id);
        const ambiguous = ambiguousIds.has(type + ":" + id);
        const info = exactInfo.get(type + ":" + id);
        const baseSemantic = info?.baseSemantic ?? segment;
        const base = ensureTopic(topics, topicKey(baseSemantic));
        const variant = {
          kind: "entity",
          build: build.slug,
          type,
          id,
          chunk: String(target.chunk),
          name,
        };
        const collisionHere = routes[baseSemantic]?.kind === "ambiguity";
        if (!collisionHere) addVariant(base, variant);
        if (ambiguous) {
          const exact = ensureTopic(topics, exactKey(type, id), true);
          addVariant(exact, variant);
          entityTopics.set(
            refKey(build.slug, type, id),
            collisionHere ? exact.key : base.key,
          );
        } else {
          addVariant(base, variant);
          entityTopics.set(refKey(build.slug, type, id), base.key);
        }
      }
    }
  }
  const priority = orderBuilds(builds);
  for (const topic of topics.values()) {
    topic.title = clean(
      priority.map((build) => topic.names.get(build.slug)).find(Boolean) ??
        topic.key,
    );
  }
  const baseTopicsByTitle = new Map();
  const mergedTopicKeys = new Map();
  for (const [key, topic] of [...topics]) {
    if (topic.exact) continue;
    const titleKey = topic.title.toLowerCase();
    const target = baseTopicsByTitle.get(titleKey);
    if (!target) {
      baseTopicsByTitle.set(titleKey, topic);
      continue;
    }
    for (const variants of topic.variants.values()) {
      for (const variant of variants) addVariant(target, variant);
    }
    mergedTopicKeys.set(key, target.key);
    topics.delete(key);
  }
  if (mergedTopicKeys.size) {
    for (const [ref, key] of entityTopics) {
      const mergedKey = mergedTopicKeys.get(key);
      if (mergedKey) entityTopics.set(ref, mergedKey);
    }
  }
  const exactGroups = new Map();
  for (const info of exactInfo.values()) {
    const key = info.type + ":" + info.baseSemantic;
    const group = exactGroups.get(key) ?? [];
    group.push(info);
    exactGroups.set(key, group);
  }
  for (const group of exactGroups.values())
    group.sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
  const usedTitles = new Map();
  for (const topic of [...topics.values()].filter((entry) => !entry.exact))
    usedTitles.set(topic.title.toLowerCase(), topic.key);
  for (const [key, info] of exactInfo) {
    const topic = topics.get(exactKey(info.type, info.id));
    if (!topic) continue;
    const group = exactGroups.get(info.type + ":" + info.baseSemantic) ?? [
      info,
    ];
    const name = clean(
      priority.map((build) => info.names.get(build.slug)).find(Boolean) ??
        topic.title,
    );
    const detail = clean(
      priority.map((build) => info.details.get(build.slug)).find(Boolean) ?? "",
    );
    const distinctDetails = new Set(
      group.map((entry) =>
        clean(
          priority
            .map((build) => entry.details.get(build.slug))
            .find(Boolean) ?? "",
        ),
      ),
    );
    const suffix =
      info.type === "items"
        ? "Item " + info.id
        : detail !== "Unnamed" &&
            detail !== "" &&
            distinctDetails.size === group.length
          ? detail
          : (typeNames[info.type] ?? info.type).replace(/s$/, "") +
            " " +
            (group.indexOf(info) + 1);
    let title = name + " (" + suffix + ")";
    if (
      usedTitles.has(title.toLowerCase()) &&
      usedTitles.get(title.toLowerCase()) !== key
    )
      title =
        name +
        " (" +
        clean(typeNames[info.type] ?? info.type) +
        " " +
        suffix +
        ")";
    topic.title = title;
    usedTitles.set(title.toLowerCase(), topic.key);
  }
  return { topics, entityTopics, indexRows, routesByBuildType };
}
async function main() {
  await mkdir(outRoot, { recursive: true });
  const builds = orderBuilds(
    await readJson(join(root, "site/public/builds.json")),
  );
  console.log("Building bundled MediaWiki topic catalog...");
  const catalog = await buildCatalog(builds);
  const selected = process.env.MEDIAWIKI_BUILD;
  if (selected && !builds.some((build) => build.slug === selected))
    throw new Error("Unknown MEDIAWIKI_BUILD: " + selected);
  const supportBuilds = selected
    ? builds.filter((build) => build.slug === selected)
    : builds;
  const supportCount = [...catalog.topics.values()].reduce(
    (count, topic) =>
      count +
      supportBuilds.filter((build) => topic.variants.has(build.slug)).length,
    0,
  );
  const indexTypes = new Set(
    [...catalog.indexRows.keys()].map((key) => key.slice(key.indexOf(":") + 1)),
  );
  const total =
    catalog.topics.size +
    supportCount +
    indexTypes.size +
    supportBuilds.length * indexTypes.size +
    1 +
    supportBuilds.length;
  const progress = new ProgressBar(total);
  const writer = new ManifestWriter(progress);
  const fallbackBuild = (topic, requested) =>
    topic.variants.has(requested)
      ? builds.find((build) => build.slug === requested)
      : builds.find((build) => topic.variants.has(build.slug));
  const linkFor = (build, value) => {
    const ref = value;
    const type = refTypes[String(ref.type)] ?? String(ref.type);
    const key = catalog.entityTopics.get(refKey(build, type, ref.id));
    const topic = key ? catalog.topics.get(key) : undefined;
    if (!topic) return escapeText(ref.name ?? ref.id);
    const targetBuild = fallbackBuild(topic, build);
    const icon =
      typeof ref.icon === "string" && ref.icon
        ? "[[File:" +
          mediaFileName(ref.icon) +
          "|24px|alt=|link=" +
          topic.title +
          "]] "
        : "";
    return (
      icon +
      "[[" +
      topic.title +
      "#" +
      tabAnchor(targetBuild) +
      "|" +
      escapeText(ref.name ?? ref.id) +
      "]]"
    );
  };
  for (const topic of catalog.topics.values()) {
    const available = builds.filter((build) => topic.variants.has(build.slug));
    await addPage(
      topic.title,
      "",
      "topic",
      "section",
      renderShell(topic.key, available, [
        "OpenFusion AutoWiki",
        ...[...topic.types].map((type) => typeNames[type] ?? clean(type)),
      ]),
      writer,
    );
  }
  for (const build of supportBuilds) {
    for (const topic of catalog.topics.values()) {
      const variants = topic.variants.get(build.slug);
      if (!variants) continue;
      const bodies = [];
      const pageMedia = new Set();
      for (const variant of variants) {
        if (variant.kind === "ambiguity") {
          for (const name of await collectMedia(variant.matches))
            pageMedia.add(name);
          bodies.push(
            renderAmbiguity(
              variant.type,
              variant.matches,
              (value) => linkFor(build.slug, value),
              config,
              [],
            ),
          );
          continue;
        }
        const bucket = await chunk(
          join(dataRoot, build.slug, variant.type, variant.chunk + ".json"),
        );
        const entity = bucket[variant.id];
        if (!entity) continue;
        for (const name of await collectMedia(entity)) pageMedia.add(name);
        const maps = buildWikiMaps(variant.type, entity);
        for (const map of maps) {
          for (const source of map.media) {
            await registerMedia(source, pageMedia);
          }
        }
        bodies.push(
          renderEntity(
            variant.type,
            entity,
            (value) => linkFor(build.slug, value),
            config,
            [],
            maps,
          ),
        );
      }
      await addPage(
        supportTitle(topic.key, build.slug),
        build.slug,
        "topic-data",
        "generated",
        "__NOEDITSECTION__\n" + bodies.join("\n\n"),
        writer,
        [...pageMedia],
      );
    }
  }
  const worldKey = "interactive-map";
  const worldBuilds = builds.filter((build) =>
    catalog.routesByBuildType.has(buildTypeKey(build.slug, "areas")),
  );
  await addPage(
    "Interactive Map",
    "",
    "map",
    "section",
    renderShell(worldKey, worldBuilds, ["OpenFusion AutoWiki maps"]),
    writer,
  );
  for (const build of supportBuilds) {
    const routes = catalog.routesByBuildType.get(
      buildTypeKey(build.slug, "areas"),
    );
    if (!routes) continue;
    const areas = [];
    const seen = new Set();
    for (const [segment, target] of Object.entries(routes)) {
      if (segment !== target.canonical || target.kind !== "entity") continue;
      const id = String(target.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const bucket = await chunk(
        join(dataRoot, build.slug, "areas", String(target.chunk) + ".json"),
      );
      if (bucket[id]) areas.push(bucket[id]);
    }
    const world = buildWorldMapFromAreas(areas, (ref) => {
      const rendered = linkFor(build.slug, ref);
      return /\[\[([^|\]]+)/.exec(rendered)?.[1] ?? "";
    });
    const pageMedia = new Set();
    if (world) {
      for (const source of world.media) await registerMedia(source, pageMedia);
    }
    await addPage(
      supportTitle(worldKey, build.slug),
      build.slug,
      "map",
      "generated",
      world
        ? world.wikitext + "\n\n''" + escapeText(world.caption) + "''\n"
        : "No map data is available for this build.\n",
      writer,
      [...pageMedia],
    );
  }
  for (const type of indexTypes) {
    const key = "index:" + type;
    const available = builds.filter((build) =>
      catalog.indexRows.has(buildTypeKey(build.slug, type)),
    );
    await addPage(
      typeNames[type] ?? clean(type),
      "",
      type,
      "section",
      renderShell(key, available, ["OpenFusion AutoWiki indexes"]),
      writer,
    );
    for (const build of supportBuilds) {
      const rows = catalog.indexRows.get(buildTypeKey(build.slug, type));
      if (!rows) continue;
      const routes = catalog.routesByBuildType.get(
        buildTypeKey(build.slug, type),
      );
      const rowLink = (row) => {
        if (!routes) return escapeText(row.name ?? row.code ?? row.id);
        const target = routes[String(row.routeId ?? row.id)];
        const key =
          target?.kind === "ambiguity"
            ? topicKey(String(target.canonical))
            : catalog.entityTopics.get(
                refKey(build.slug, type, target?.id ?? row.id),
              );
        const topic = key ? catalog.topics.get(key) : undefined;
        return topic
          ? "[[" +
              topic.title +
              "#" +
              tabAnchor(fallbackBuild(topic, build.slug)) +
              "|" +
              escapeText(row.name ?? row.code ?? row.id) +
              "]]"
          : escapeText(row.name ?? row.code ?? row.id);
      };
      const body = renderIndex(type, rows, rowLink, config, []);
      await addPage(
        supportTitle(key, build.slug),
        build.slug,
        type,
        "generated",
        "__NOEDITSECTION__\n" + body,
        writer,
      );
    }
  }
  const output = await writer.finish();
  progress.finish();
  const manifest = {
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
      " shards, " +
      media.size +
      " media files",
  );
}
await main();
