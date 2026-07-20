import { createHash } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { mergeContinuedPage } from "./edit.js";
import { importBatches, renderImportXml, type ImportPage } from "./import.js";
import {
  mergeOwnedSections,
  pageTextEqual,
  stripOwnedSections,
} from "./merge.js";
import type { ExportManifest, ManifestPage, PageOwnership } from "./types.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(
  process.env.MEDIAWIKI_RELEASE_DIR ?? join(root, "mediawiki/output"),
);
const work = resolve(
  process.env.MEDIAWIKI_IMPORT_WORK ?? join(root, ".cache/mediawiki-import"),
);
const stateDir = resolve(
  process.env.MEDIAWIKI_STATE_DIR ?? join(root, ".cache/mediawiki-state"),
);
const statePath = join(stateDir, "installed.json.gz");
const cfg = JSON.parse(
  await readFile(
    process.env.MEDIAWIKI_CONFIG ?? join(root, "mediawiki/config.json"),
    "utf8",
  ),
);
const apiUrl = process.env.MEDIAWIKI_API_URL ?? cfg.apiUrl;
const username = process.env.MEDIAWIKI_USERNAME;
const password = process.env.MEDIAWIKI_PASSWORD;
const queryBatchSize = Math.min(
  username && password ? 500 : 50,
  Number(process.env.MEDIAWIKI_PAGE_QUERY_BATCH_SIZE ?? 500),
);
const dumpPages = Number(process.env.MEDIAWIKI_DUMP_PAGES ?? 5000);
const dumpBytes = Number(process.env.MEDIAWIKI_DUMP_BYTES ?? 64 * 1024 * 1024);

interface InstalledPage {
  title: string;
  ownership: PageOwnership;
  sourceHash: string;
  installedHash: string;
}

interface InstalledState {
  schemaVersion: number;
  generatedAt: string;
  pages: InstalledPage[];
  media: Array<{ name: string; hash: string }>;
}

interface RemotePage {
  title: string;
  namespace: number;
  missing: boolean;
  text: string;
}

const normalizedHash = (text: string) =>
  createHash("sha256").update(text.trimEnd()).digest("hex");

function positiveInteger(name: string, value: number) {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(name + " must be a positive integer");
  return value;
}
positiveInteger("MEDIAWIKI_PAGE_QUERY_BATCH_SIZE", queryBatchSize);
positiveInteger("MEDIAWIKI_DUMP_PAGES", dumpPages);
positiveInteger("MEDIAWIKI_DUMP_BYTES", dumpBytes);

const cookies = new Map<string, string>();
function cookieHeader() {
  return [...cookies].map(([key, value]) => key + "=" + value).join("; ");
}
function storeCookies(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values =
    extended.getSetCookie?.() ??
    (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  for (const value of values.flatMap((entry) =>
    entry.split(/,(?=\s*[^;,]+=)/),
  )) {
    const pair = value.split(";", 1)[0]!;
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1));
  }
}
async function api(params: Record<string, string>, post = true) {
  const body = new URLSearchParams({
    ...params,
    format: "json",
    formatversion: "2",
  });
  const response = await fetch(post ? apiUrl : apiUrl + "?" + body, {
    method: post ? "POST" : "GET",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": "OpenFusionAutoWiki/2.0 release preparer",
      cookie: cookieHeader(),
    },
    body: post ? body : undefined,
  });
  storeCookies(response.headers);
  const raw = await response.text();
  let result: any;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(
      "MediaWiki HTTP " + response.status + " returned " + raw.slice(0, 200),
    );
  }
  if (!response.ok) throw new Error("MediaWiki HTTP " + response.status);
  if (result.error)
    throw new Error(result.error.code + ": " + result.error.info);
  return result;
}

async function authenticate() {
  if (!username || !password) return;
  const loginToken = (
    await api({ action: "query", meta: "tokens", type: "login" })
  ).query.tokens.logintoken;
  const result = await api({
    action: "login",
    lgname: username,
    lgpassword: password,
    lgtoken: loginToken,
  });
  if (result.login.result !== "Success")
    throw new Error("Login failed: " + result.login.result);
}

function normalizedPageMap(query: any, requested: string[]) {
  const aliases = new Map<string, string>();
  for (const entry of [
    ...(query.normalized ?? []),
    ...(query.converted ?? []),
    ...(query.redirects ?? []),
  ])
    aliases.set(String(entry.from), String(entry.to));
  const resolved = (title: string) => {
    const seen = new Set<string>();
    while (aliases.has(title) && !seen.has(title)) {
      seen.add(title);
      title = aliases.get(title)!;
    }
    return title;
  };
  const pages = new Map<string, any>(
    (query.pages ?? []).map((page: any) => [String(page.title), page]),
  );
  return new Map(requested.map((title) => [title, pages.get(resolved(title))]));
}

async function queryCurrent(titles: string[]) {
  const byTitle = new Map<string, any>();
  const normalized: any[] = [];
  const converted: any[] = [];
  const redirects: any[] = [];
  let continuation: Record<string, string> = {};
  do {
    const result = await api({
      action: "query",
      prop: "revisions",
      rvprop: "content|ids",
      rvslots: "main",
      titles: titles.join("|"),
      ...continuation,
    });
    normalized.push(...(result.query.normalized ?? []));
    converted.push(...(result.query.converted ?? []));
    redirects.push(...(result.query.redirects ?? []));
    for (const page of result.query.pages ?? []) {
      const title = String(page.title);
      byTitle.set(title, mergeContinuedPage(byTitle.get(title), page));
    }
    continuation = result.continue ?? {};
  } while (Object.keys(continuation).length);
  const mapped = normalizedPageMap(
    { pages: [...byTitle.values()], normalized, converted, redirects },
    titles,
  );
  return new Map<string, RemotePage>(
    titles.map((title) => {
      const page = mapped.get(title);
      if (!page) throw new Error("MediaWiki omitted " + title);
      return [
        title,
        {
          title: String(page.title),
          namespace: Number(page.ns ?? 0),
          missing: Boolean(page.missing),
          text: page.missing
            ? ""
            : String(page.revisions?.[0]?.slots?.main?.content ?? ""),
        },
      ];
    }),
  );
}

async function existingMedia(names: string[]) {
  const existing = new Map<string, string>();
  for (let offset = 0; offset < names.length; offset += queryBatchSize) {
    const batch = names.slice(offset, offset + queryBatchSize);
    const titles = batch.map((name) => "File:" + name);
    const result = await api({
      action: "query",
      prop: "imageinfo",
      iiprop: "sha1",
      titles: titles.join("|"),
    });
    const pages = normalizedPageMap(result.query, titles);
    for (let index = 0; index < batch.length; index++) {
      const page = pages.get(titles[index]);
      const sha1 = page?.imageinfo?.[0]?.sha1;
      if (!page?.missing && sha1) existing.set(batch[index]!, String(sha1));
    }
  }
  return existing;
}

async function loadState(): Promise<InstalledState | undefined> {
  try {
    return JSON.parse(
      (await gunzipAsync(await readFile(statePath))).toString("utf8"),
    );
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

const manifest = JSON.parse(
  await readFile(join(output, "manifest.json"), "utf8"),
) as ExportManifest;
const wantedShard = process.env.MEDIAWIKI_SHARD;
const allShards = process.env.MEDIAWIKI_MAX_SHARDS === "all";
const maxShards = allShards
  ? manifest.shards.length
  : Number(process.env.MEDIAWIKI_MAX_SHARDS ?? 10);
const start = Number(process.env.MEDIAWIKI_START_SHARD ?? 0);
const shards = wantedShard
  ? manifest.shards.filter((shard) => shard.id === wantedShard)
  : manifest.shards.slice(start, start + maxShards);
if (!shards.length) throw new Error("No MediaWiki shards selected");
const fullRelease = !wantedShard && allShards && start === 0;
const maxPages = Number(process.env.MEDIAWIKI_MAX_PAGES ?? Infinity);
const records: ManifestPage[] = [];
for (const shard of shards) {
  records.push(
    ...(
      JSON.parse(
        await readFile(join(output, shard.path), "utf8"),
      ) as ManifestPage[]
    ).slice(0, maxPages),
  );
}

await authenticate();
await mkdir(work, { recursive: true });
await Promise.all([
  rm(join(work, "dumps"), { recursive: true, force: true }),
  rm(join(work, "delete-titles.txt"), { force: true }),
  rm(join(work, "media.json"), { force: true }),
  rm(join(work, "next-state.json.gz"), { force: true }),
  rm(join(work, "plan.json"), { force: true }),
]);
await mkdir(join(work, "dumps"), { recursive: true });
const previous = await loadState();
const previousPages = new Map(
  (previous?.pages ?? []).map((page) => [page.title, page]),
);
const nextPages = fullRelease
  ? new Map<string, InstalledPage>()
  : previousPages;
const changed: ImportPage[] = [];
let unchanged = 0;
let imported = 0;
let prepared = 0;
let dumpIndex = 0;
const dumpFiles: string[] = [];

async function flushChanged(force = false) {
  if (!changed.length) return;
  const batches = importBatches(changed, dumpPages, dumpBytes);
  const ready = force ? batches : batches.slice(0, -1);
  const retained = force ? [] : batches.at(-1)!;
  changed.length = 0;
  changed.push(...retained);
  for (const pages of ready) {
    const name = String(dumpIndex++).padStart(6, "0") + ".xml.gz";
    const xml = renderImportXml(pages, {
      username: username ?? "OpenFusionAutoWiki",
      summary: cfg.editSummary,
      timestamp: new Date().toISOString(),
    });
    await writeFile(
      join(work, "dumps", name),
      await gzipAsync(xml, { level: 6 }),
    );
    dumpFiles.push(name);
  }
}

for (let offset = 0; offset < records.length; offset += queryBatchSize) {
  const batch = records.slice(offset, offset + queryBatchSize);
  const current = await queryCurrent(batch.map((record) => record.title));
  for (const record of batch) {
    const remote = current.get(record.title)!;
    const generated = await readFile(join(output, record.path), "utf8");
    const nextText =
      record.ownership === "generated"
        ? generated
        : mergeOwnedSections(remote.text, generated);
    if (pageTextEqual(nextText, remote.text)) unchanged++;
    else {
      imported++;
      changed.push({
        title: remote.title,
        namespace: remote.namespace,
        text: nextText,
      });
    }
    nextPages.set(record.title, {
      title: record.title,
      ownership: record.ownership,
      sourceHash: record.hash,
      installedHash: normalizedHash(nextText),
    });
    prepared++;
  }
  await flushChanged();
  if (prepared % 5000 === 0 || prepared === records.length)
    console.log(
      "Prepared " +
        prepared.toLocaleString() +
        "/" +
        records.length.toLocaleString(),
    );
}

const deleteTitles: string[] = [];
const preservedStale: string[] = [];
if (fullRelease && previous) {
  const active = new Set(records.map((record) => record.title));
  const stale = previous.pages.filter((page) => !active.has(page.title));
  for (let offset = 0; offset < stale.length; offset += queryBatchSize) {
    const batch = stale.slice(offset, offset + queryBatchSize);
    const current = await queryCurrent(batch.map((page) => page.title));
    for (const old of batch) {
      const remote = current.get(old.title)!;
      if (remote.missing) continue;
      if (old.ownership === "generated") {
        if (normalizedHash(remote.text) === old.installedHash)
          deleteTitles.push(remote.title);
        else preservedStale.push(remote.title);
        continue;
      }
      const prose = stripOwnedSections(remote.text);
      if (prose) {
        if (!pageTextEqual(prose, remote.text))
          changed.push({
            title: remote.title,
            namespace: remote.namespace,
            text: prose + "\n",
          });
      } else {
        deleteTitles.push(remote.title);
      }
    }
    await flushChanged();
  }
}
await flushChanged(true);

const previousMedia = new Map(
  (previous?.media ?? []).map((record) => [record.name, record.hash]),
);
const skipMedia = process.env.MEDIAWIKI_SKIP_MEDIA === "1";
const selectedMedia = new Set(records.flatMap((record) => record.media));
const releaseMedia = skipMedia
  ? []
  : fullRelease
    ? manifest.media
    : manifest.media.filter((record) => selectedMedia.has(record.name));
const presentMedia = skipMedia
  ? new Map<string, string>()
  : await existingMedia(releaseMedia.map((record) => record.name));
const pendingMedia: string[] = [];
for (const record of releaseMedia) {
  const bytes = await readFile(join(root, record.source));
  const releaseSha1 = createHash("sha1").update(bytes).digest("hex");
  if (presentMedia.get(record.name) !== releaseSha1)
    pendingMedia.push(record.name);
}
const nextMedia =
  fullRelease && !skipMedia ? new Map<string, string>() : previousMedia;
for (const record of releaseMedia) nextMedia.set(record.name, record.hash);
const nextState: InstalledState = {
  schemaVersion: manifest.schemaVersion,
  generatedAt: manifest.generatedAt,
  pages: [...nextPages.values()],
  media: [...nextMedia].map(([name, hash]) => ({ name, hash })),
};
await writeFile(
  join(work, "next-state.json.gz"),
  await gzipAsync(JSON.stringify(nextState), { level: 9 }),
);
await writeFile(
  join(work, "delete-titles.txt"),
  deleteTitles.join("\n") + (deleteTitles.length ? "\n" : ""),
);
await writeFile(join(work, "media.json"), JSON.stringify(pendingMedia));
await writeFile(
  join(work, "plan.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      releaseGeneratedAt: manifest.generatedAt,
      fullRelease,
      selectedPages: records.length,
      changedPages: imported,
      unchangedPages: unchanged,
      dumpFiles,
      deleteTitles: deleteTitles.length,
      preservedStale,
      pendingMedia: pendingMedia.length,
    },
    null,
    2,
  ),
);
console.log({
  selectedPages: records.length,
  importedPages: imported,
  unchangedPages: unchanged,
  dumps: dumpFiles.length,
  deleteTitles: deleteTitles.length,
  preservedStale: preservedStale.length,
  pendingMedia: pendingMedia.length,
  fullRelease,
});
