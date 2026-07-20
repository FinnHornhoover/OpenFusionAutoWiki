import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEditParams, isEditConflict, mergeContinuedPage } from "./edit.js";
import { importBatches, renderImportXml, type ImportPage } from "./import.js";
import { mergeOwnedSections, pageTextEqual } from "./merge.js";
import type { ExportManifest, ManifestPage } from "./types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "mediawiki/output");
const cfg = JSON.parse(
  await readFile(join(root, "mediawiki/config.json"), "utf8"),
);
const apiUrl = process.env.MEDIAWIKI_API_URL ?? cfg.apiUrl;

const username = process.env.MEDIAWIKI_USERNAME;
const password = process.env.MEDIAWIKI_PASSWORD;
if (!username || !password)
  throw new Error("MediaWiki credentials are required");

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(name + " must be a positive number");
  return Math.floor(value);
};

const pageQueryBatchSize = Math.min(
  500,
  numberFromEnv("MEDIAWIKI_PAGE_QUERY_BATCH_SIZE", 500),
);
const editConcurrency = Math.min(
  16,
  numberFromEnv("MEDIAWIKI_EDIT_CONCURRENCY", 8),
);
const mediaDelay = numberFromEnv("MEDIAWIKI_MEDIA_DELAY_MS", 250);
const mediaConcurrency = Math.min(
  16,
  numberFromEnv("MEDIAWIKI_MEDIA_CONCURRENCY", 4),
);
const uploadChunkBytes = numberFromEnv(
  "MEDIAWIKI_UPLOAD_CHUNK_BYTES",
  512 * 1024,
);
const uploadChunkThreshold = numberFromEnv(
  "MEDIAWIKI_UPLOAD_CHUNK_THRESHOLD_BYTES",
  1024 * 1024,
);
const publishMode = process.env.MEDIAWIKI_PUBLISH_MODE ?? "edit";
if (publishMode !== "edit" && publishMode !== "import") {
  throw new Error("MEDIAWIKI_PUBLISH_MODE must be edit or import");
}
const importBatchPages = numberFromEnv("MEDIAWIKI_IMPORT_BATCH_PAGES", 100);
const importBatchBytes = numberFromEnv(
  "MEDIAWIKI_IMPORT_BATCH_BYTES",
  8 * 1024 * 1024,
);

class PublishProgress {
  private current = 0;
  private lastLogged = 0;
  private rendered = false;
  private readonly logInterval: number;

  constructor(private readonly total: number) {
    this.logInterval = Math.max(1, Math.ceil(total / 100));
  }

  tick(label: string, amount = 1) {
    this.current = Math.min(this.total, this.current + amount);
    const ratio = this.total ? this.current / this.total : 1;
    const detail = label.replaceAll(/[\r\n]/g, " ").slice(0, 70);
    if (process.stdout.isTTY) {
      const width = 30;
      const filled = Math.round(width * ratio);
      process.stdout.write(
        "\r\x1b[2K[" +
          "#".repeat(filled) +
          "-".repeat(width - filled) +
          "] " +
          (ratio * 100).toFixed(1).padStart(5) +
          "% " +
          this.current.toLocaleString() +
          "/" +
          this.total.toLocaleString() +
          " - " +
          detail,
      );
      this.rendered = true;
    } else if (
      this.current === this.total ||
      this.current - this.lastLogged >= this.logInterval
    ) {
      console.log(
        "MediaWiki publish " +
          this.current.toLocaleString() +
          "/" +
          this.total.toLocaleString() +
          " (" +
          (ratio * 100).toFixed(1) +
          "%) - " +
          detail,
      );
      this.lastLogged = this.current;
    }
  }

  finish() {
    if (process.stdout.isTTY && this.rendered) process.stdout.write("\n");
  }
}

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
    const pair = value.split(";", 1)[0];
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1));
  }
}

async function jsonResponse(response: Response) {
  storeCookies(response.headers);
  const raw = await response.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      "MediaWiki HTTP " +
        response.status +
        " returned non-JSON, content-type " +
        (response.headers.get("content-type") ?? "unknown") +
        ", body " +
        JSON.stringify(raw.slice(0, 200)),
    );
  }
  if (!response.ok) throw new Error("MediaWiki HTTP " + response.status);
  if (json.error) throw new Error(json.error.code + ": " + json.error.info);
  return json;
}

async function apiOnce(params: Record<string, string>, post = false) {
  const body = new URLSearchParams({
    ...params,
    format: "json",
    formatversion: "2",
  });
  return jsonResponse(
    await fetch(post ? apiUrl : apiUrl + "?" + body.toString(), {
      method: post ? "POST" : "GET",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": "OpenFusionAutoWiki/2.0 mass importer",
        cookie: cookieHeader(),
      },
      body: post ? body : undefined,
    }),
  );
}

const retryable = (message: string) =>
  /^(ratelimited|maxlag):/.test(message) ||
  /MediaWiki HTTP (429|5\d\d)/.test(message) ||
  /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_/i.test(message);

async function retry<T>(
  label: string,
  operation: () => Promise<T>,
  shouldRetry: (message: string) => boolean = retryable,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!shouldRetry(message) || attempt >= 5) throw error;
      const delay = Math.min(60000, 5000 * 2 ** attempt);
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
      console.warn(
        label +
          ": " +
          message +
          "; retrying in " +
          Math.ceil(delay / 1000) +
          "s",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const api = (params: Record<string, string>, post = false) =>
  retry("API request", () => apiOnce(params, post));

let token = "";
async function authenticate() {
  cookies.clear();
  const loginToken = (
    await api({ action: "query", meta: "tokens", type: "login" })
  ).query.tokens.logintoken;
  const login = await api(
    {
      action: "login",
      lgname: username!,
      lgpassword: password!,
      lgtoken: loginToken,
    },
    true,
  );
  if (login.login.result !== "Success") {
    throw new Error(
      "Login failed: " +
        login.login.result +
        (login.login.reason ? " - " + login.login.reason : ""),
    );
  }
  const capability = await api({
    action: "query",
    meta: "tokens|userinfo",
    type: "csrf",
    uiprop: "rights",
  });
  token = capability.query.tokens.csrftoken;
  return new Set<string>(capability.query.userinfo.rights);
}

const rights = await authenticate();
const requiredRights = ["read", "upload", "apihighlimits"];
requiredRights.push(
  ...(publishMode === "import" ? ["import"] : ["edit", "createpage"]),
);
for (const right of requiredRights) {
  if (!rights.has(right))
    throw new Error(
      "The authenticated MediaWiki account lacks " + right + " permission",
    );
}
async function waitForUpload(initial: any, name: string) {
  let upload = initial;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (upload?.result === "Success" || upload?.stage === "published") return;
    const filekey = upload?.filekey ?? upload?.statuskey;
    if (
      !filekey ||
      (upload.result !== "Poll" && upload.result !== "Continue")
    ) {
      throw new Error(
        "Upload failed for " + name + ": " + JSON.stringify(upload),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    upload = (
      await api(
        {
          action: "upload",
          checkstatus: "1",
          filekey: String(filekey),
          token,
        },
        true,
      )
    ).upload;
  }
  throw new Error("Timed out waiting for MediaWiki to publish " + name);
}

async function postUploadForm(form: FormData) {
  return (
    await jsonResponse(
      await fetch(apiUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "user-agent": "OpenFusionAutoWiki/2.0 mass importer",
          cookie: cookieHeader(),
        },
        body: form,
      }),
    )
  ).upload;
}

async function importPages(pages: ImportPage[]) {
  const freshCapability = await api({
    action: "query",
    meta: "tokens|userinfo",
    type: "csrf",
  });
  if (freshCapability.query.userinfo.anon) {
    await authenticate();
  } else {
    token = freshCapability.query.tokens.csrftoken;
  }
  const xml = renderImportXml(pages, {
    username: username!,
    summary: cfg.editSummary,
    timestamp: new Date().toISOString(),
  });
  const form = new FormData();
  form.set("action", "import");
  form.set("format", "json");
  form.set("formatversion", "2");
  form.set("assignknownusers", "1");
  form.set("interwikiprefix", "ofaw");
  form.set("summary", cfg.editSummary);
  form.set("token", token);
  form.set("xml", new Blob([xml], { type: "application/xml" }), "ofaw.xml");
  const result = await retry("XML import", async () =>
    jsonResponse(
      await fetch(apiUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "user-agent": "OpenFusionAutoWiki/2.0 mass importer",
          cookie: cookieHeader(),
        },
        body: form,
      }),
    ),
  );
  if (!Array.isArray(result.import)) {
    throw new Error("Unexpected import response: " + JSON.stringify(result));
  }
}

async function uploadOnce(record: { source: string; name: string }) {
  const bytes = await readFile(join(root, record.source));
  if (bytes.byteLength <= uploadChunkThreshold) {
    const form = new FormData();
    form.set("action", "upload");
    form.set("format", "json");
    form.set("formatversion", "2");
    form.set("filename", record.name);
    form.set("comment", cfg.editSummary);
    form.set("ignorewarnings", "1");
    form.set("async", "1");
    form.set("token", token);
    form.set("file", new Blob([new Uint8Array(bytes)]), record.name);
    await waitForUpload(await postUploadForm(form), record.name);
    return;
  }

  let filekey: string | undefined;
  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = Math.min(offset + uploadChunkBytes, bytes.byteLength);
    const form = new FormData();
    form.set("action", "upload");
    form.set("format", "json");
    form.set("formatversion", "2");
    form.set("filename", record.name);
    form.set("filesize", String(bytes.byteLength));
    form.set("offset", String(offset));
    form.set("stash", "1");
    form.set("ignorewarnings", "1");
    form.set("token", token);
    if (filekey) form.set("filekey", filekey);
    form.set(
      "chunk",
      new Blob([new Uint8Array(bytes.subarray(offset, end))]),
      record.name + ".part",
    );
    const upload = await postUploadForm(form);
    filekey = String(upload?.filekey ?? "");
    if (!filekey) {
      throw new Error(
        "Chunk upload did not return a file key for " +
          record.name +
          ": " +
          JSON.stringify(upload),
      );
    }
    const nextOffset = Number(upload?.offset ?? end);
    if (nextOffset !== end) {
      throw new Error(
        "Chunk upload offset mismatch for " +
          record.name +
          ": expected " +
          end +
          ", received " +
          nextOffset,
      );
    }
    offset = nextOffset;
  }

  const finalized = await api(
    {
      action: "upload",
      filename: record.name,
      filekey: filekey!,
      comment: cfg.editSummary,
      ignorewarnings: "1",
      async: "1",
      token,
    },
    true,
  );
  await waitForUpload(finalized.upload, record.name);
}

function normalizedPageMap(query: any, requested: string[]): Map<string, any> {
  const normalized = new Map<string, string>();
  for (const entry of [
    ...(query.normalized ?? []),
    ...(query.converted ?? []),
    ...(query.redirects ?? []),
  ])
    normalized.set(String(entry.from), String(entry.to));
  const resolveTitle = (title: string) => {
    const seen = new Set<string>();
    while (normalized.has(title) && !seen.has(title)) {
      seen.add(title);
      title = normalized.get(title)!;
    }
    return title;
  };
  const byTitle = new Map<string, any>(
    (query.pages ?? []).map((page: any): [string, any] => [
      String(page.title),
      page,
    ]),
  );
  return new Map<string, any>(
    requested.map((title): [string, any] => [
      title,
      byTitle.get(resolveTitle(title)),
    ]),
  );
}

async function queryCurrentPages(pages: ManifestPage[]) {
  const titles = pages.map((page) => page.title);
  const byTitle = new Map<string, any>();
  const normalized: any[] = [];
  const converted: any[] = [];
  const redirects: any[] = [];
  let continuation: Record<string, string> = {};
  do {
    const result = await api(
      {
        action: "query",
        prop: "revisions",
        rvprop: "content|ids",
        rvslots: "main",
        titles: titles.join("|"),
        ...continuation,
      },
      true,
    );
    normalized.push(...(result.query.normalized ?? []));
    converted.push(...(result.query.converted ?? []));
    redirects.push(...(result.query.redirects ?? []));
    for (const page of result.query.pages ?? []) {
      const title = String(page.title);
      byTitle.set(title, mergeContinuedPage(byTitle.get(title), page));
    }
    continuation = result.continue ?? {};
  } while (Object.keys(continuation).length);

  return normalizedPageMap(
    { pages: [...byTitle.values()], normalized, converted, redirects },
    titles,
  );
}

async function existingMedia(names: string[]) {
  const existing = new Set<string>();
  for (let offset = 0; offset < names.length; offset += 500) {
    const batch = names.slice(offset, offset + 500);
    const titles = batch.map((name) => "File:" + name);
    const result = await api(
      { action: "query", titles: titles.join("|") },
      true,
    );
    const pages = normalizedPageMap(result.query, titles);
    for (let index = 0; index < batch.length; index++) {
      if (!pages.get(titles[index])?.missing) existing.add(batch[index]);
    }
  }
  return existing;
}

let edited = 0;
let unchanged = 0;
let failed = 0;
let progress: PublishProgress;

async function editPage(title: string, text: string, remote: any) {
  const params = buildEditParams(title, text, cfg.editSummary, token, remote);
  const result = await api(params, true);
  if (result.edit?.result !== "Success") {
    throw new Error(
      "Unexpected edit response for " +
        title +
        ": " +
        JSON.stringify(result.edit),
    );
  }
}

const manifest = JSON.parse(
  await readFile(join(out, "manifest.json"), "utf8"),
) as ExportManifest;
const wantedShard = process.env.MEDIAWIKI_SHARD;
const maxShards =
  process.env.MEDIAWIKI_MAX_SHARDS === "all"
    ? manifest.shards.length
    : numberFromEnv("MEDIAWIKI_MAX_SHARDS", 10);
const explicitStart = process.env.MEDIAWIKI_START_SHARD?.trim() || undefined;
const sequence = Number(explicitStart ?? process.env.GITHUB_RUN_NUMBER ?? 0);
if (!Number.isInteger(sequence) || sequence < 0)
  throw new Error("MEDIAWIKI_START_SHARD must be a non-negative integer");
const start =
  (explicitStart === undefined ? sequence * maxShards : sequence) %
  manifest.shards.length;
const shards = wantedShard
  ? manifest.shards.filter((shard) => shard.id === wantedShard)
  : manifest.shards.slice(start, start + maxShards);
if (!shards.length) throw new Error("No MediaWiki shards selected");

const maxPages = Number(process.env.MEDIAWIKI_MAX_PAGES || Infinity);
const selectedPages: ManifestPage[] = [];
for (const shard of shards) {
  selectedPages.push(
    ...(
      JSON.parse(
        await readFile(join(out, shard.path), "utf8"),
      ) as ManifestPage[]
    ).slice(0, maxPages),
  );
}

const mediaByName = new Map(
  manifest.media.map((record) => [record.name, record]),
);
const mediaNames = [...new Set(selectedPages.flatMap((page) => page.media))];
progress = new PublishProgress(mediaNames.length + selectedPages.length);
const presentMedia = await existingMedia(mediaNames);
let uploaded = 0;
const pendingMedia: string[] = [];
for (const name of mediaNames) {
  if (presentMedia.has(name)) {
    progress.tick("Existing media: " + name);
  } else {
    pendingMedia.push(name);
  }
}

let mediaCursor = 0;
async function mediaWorker() {
  while (mediaCursor < pendingMedia.length) {
    const name = pendingMedia[mediaCursor++];
    const record = mediaByName.get(name);
    if (!record) {
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
      console.warn("No media manifest record for " + name);
      progress.tick("Missing media record: " + name);
      continue;
    }
    try {
      await retry("Media upload " + name, () => uploadOnce(record));
      uploaded++;
    } catch (error) {
      const landed = (await existingMedia([name])).has(name);
      if (landed) {
        uploaded++;
        if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
        console.warn(name + " exists after an ambiguous upload response");
      } else {
        failed++;
        if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
        console.error(name, error);
      }
    }
    progress.tick("Media: " + name);
    await new Promise((resolve) => setTimeout(resolve, mediaDelay));
  }
}

await Promise.all(
  Array.from({ length: Math.min(mediaConcurrency, pendingMedia.length) }, () =>
    mediaWorker(),
  ),
);

async function publishPage(record: ManifestPage, initialRemote: any) {
  const generated = await readFile(join(out, record.path), "utf8");
  let remote = initialRemote;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!remote) {
      failed++;
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
      console.error(record.title, "MediaWiki query omitted this title");
      progress.tick("Failed page query: " + record.title);
      return;
    }
    const revision = remote.revisions?.[0];
    const oldText = remote.missing
      ? ""
      : String(revision?.slots?.main?.content ?? "");
    const nextText =
      record.ownership === "generated"
        ? generated
        : mergeOwnedSections(oldText, generated);
    if (pageTextEqual(nextText, oldText)) {
      unchanged++;
      progress.tick("Unchanged page: " + record.title);
      return;
    }
    try {
      await editPage(String(remote.title), nextText, remote);
      edited++;
      progress.tick("Edited page: " + record.title);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isEditConflict(message) && attempt < 3) {
        remote = (await queryCurrentPages([record])).get(record.title);
        continue;
      }
      failed++;
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
      console.error(record.title, error);
      progress.tick("Failed page: " + record.title);
      return;
    }
  }
}

async function prepareImportPage(
  record: ManifestPage,
  remote: any,
): Promise<ImportPage | undefined> {
  if (!remote) {
    failed++;
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
    console.error(record.title, "MediaWiki query omitted this title");
    progress.tick("Failed page query: " + record.title);
    return;
  }
  const generated = await readFile(join(out, record.path), "utf8");
  const revision = remote.revisions?.[0];
  const oldText = remote.missing
    ? ""
    : String(revision?.slots?.main?.content ?? "");
  const nextText =
    record.ownership === "generated"
      ? generated
      : mergeOwnedSections(oldText, generated);
  if (pageTextEqual(nextText, oldText)) {
    unchanged++;
    progress.tick("Unchanged page: " + record.title);
    return;
  }
  return {
    title: String(remote.title),
    namespace: Number(remote.ns ?? 0),
    text: nextText,
  };
}

for (
  let offset = 0;
  offset < selectedPages.length;
  offset += pageQueryBatchSize
) {
  const records = selectedPages.slice(offset, offset + pageQueryBatchSize);
  const current = await queryCurrentPages(records);
  if (publishMode === "import") {
    const prepared = (
      await Promise.all(
        records.map((record) =>
          prepareImportPage(record, current.get(record.title)),
        ),
      )
    ).filter((page): page is ImportPage => page !== undefined);
    for (const pages of importBatches(
      prepared,
      importBatchPages,
      importBatchBytes,
    )) {
      try {
        await importPages(pages);
        edited += pages.length;
        for (const page of pages) progress.tick("Imported page: " + page.title);
      } catch (error) {
        failed += pages.length;
        if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
        console.error(
          "Import batch " + pages[0]!.title + " ... " + pages.at(-1)!.title,
          error,
        );
        for (const page of pages) progress.tick("Failed page: " + page.title);
      }
    }
    continue;
  }
  let pageCursor = 0;
  async function pageWorker() {
    while (pageCursor < records.length) {
      const record = records[pageCursor++];
      await publishPage(record, current.get(record.title));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(editConcurrency, records.length) }, () =>
      pageWorker(),
    ),
  );
}

progress.finish();
console.log({
  selectedShards: shards.length,
  selectedPages: selectedPages.length,
  edited,
  unchanged,
  failed,
  uploaded,
  existingMedia: presentMedia.size,
  mediaConcurrency,
  editConcurrency,
  pageQueryBatchSize,
  publishMode,
  importBatchPages,
  importBatchBytes,
});
if (failed) process.exitCode = 1;
