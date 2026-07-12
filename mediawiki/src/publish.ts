import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "mediawiki/output");
const cfg = JSON.parse(
  await readFile(join(root, "mediawiki/config.json"), "utf8"),
);

const user = process.env.MEDIAWIKI_USERNAME;
const pass = process.env.MEDIAWIKI_PASSWORD;

if (!user || !pass) {
  throw new Error("MediaWiki credentials are required");
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

async function apiOnce(params: Record<string, string>, post = false) {
  const body = new URLSearchParams({
    ...params,
    format: "json",
    formatversion: "2",
  });

  const res = await fetch(
    post ? cfg.apiUrl : cfg.apiUrl + "?" + body.toString(),
    {
      method: post ? "POST" : "GET",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": "OpenFusionAutoWiki/1.0",
        cookie: cookieHeader(),
      },
      body: post ? body : undefined,
    },
  );

  storeCookies(res.headers);
  const raw = await res.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      "MediaWiki returned non-JSON: HTTP " +
        res.status +
        ", content-type " +
        (res.headers.get("content-type") ?? "unknown") +
        ", body " +
        JSON.stringify(raw.slice(0, 200)),
    );
  }

  if (!res.ok) throw new Error("MediaWiki HTTP " + res.status);
  if (json.error) throw new Error(json.error.code + ": " + json.error.info);
  return json;
}

async function api(params: Record<string, string>, post = false) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiOnce(params, post);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /^(ratelimited|maxlag):/.test(message);
      if (!retryable || attempt >= 5) throw error;
      const delay = Math.min(60000, 10000 * 2 ** attempt);
      console.warn(message + "; retrying in " + Math.ceil(delay / 1000) + "s");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

let token = (await api({ action: "query", meta: "tokens", type: "login" }))
  .query.tokens.logintoken;
const login = await api(
  { action: "login", lgname: user, lgpassword: pass, lgtoken: token },
  true,
);
if (login.login.result !== "Success") {
  throw new Error(
    "Login failed: " +
      login.login.result +
      (login.login.reason ? " - " + login.login.reason : ""),
  );
}

token = (await api({ action: "query", meta: "tokens" })).query.tokens.csrftoken;

function sections(s: string) {
  return [
    ...s.matchAll(
      /^== ([^=\n]+) ==\n<!-- OFAW:([^:>]+):v\d+ -->\n[\s\S]*?(?=^== [^=\n]+ ==\n|(?![\s\S]))/gm,
    ),
  ].map((m) => ({ key: m[2], text: m[0].trimEnd() }));
}

function merge(old: string, next: string) {
  let result = old
    .trimEnd()
    .replace(
      /^== [^=\n]+ ==\n<!-- OFAW:[^:>\n]*classification:v\d+ -->\n[\s\S]*?(?=^== [^=\n]+ ==\n|(?![\s\S]))/gm,
      "",
    )
    .trimEnd();
  for (const s of sections(next)) {
    const re = new RegExp(
      "^== [^=\\n]+ ==\\n<!-- OFAW:" +
        s.key +
        ":v\\d+ -->\\n[\\s\\S]*?(?=^== [^=\n]+ ==\n|(?![\s\S]))",
      "m",
    );
    result = re.test(result)
      ? result.replace(re, s.text + "\n")
      : result + (result ? "\n\n" : "") + s.text;
  }
  return result.trimEnd() + "\n";
}

const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
const wanted = process.env.MEDIAWIKI_SHARD;
const max = Number(process.env.MEDIAWIKI_MAX_SHARDS || 1);
const start =
  Number(process.env.GITHUB_RUN_NUMBER || 0) % manifest.shards.length;
const shards = wanted
  ? manifest.shards.filter((shard: any) => shard.id === wanted)
  : manifest.shards.slice(start, start + max);

let changed = 0;
let unchanged = 0;
let failed = 0;

for (const shard of shards) {
  const shardPages = JSON.parse(await readFile(join(out, shard.path), "utf8"));
  for (const p of shardPages) {
    const generated = await readFile(join(out, p.path), "utf8");
    try {
      const q = await api({
        action: "query",
        prop: "revisions",
        rvprop: "content|timestamp",
        rvslots: "main",
        titles: p.title,
      });
      const page = q.query.pages[0];
      const old = page.missing
        ? ""
        : page.revisions?.[0]?.slots?.main?.content || "";
      const next = merge(old, generated);
      if (next === old) {
        unchanged++;
        continue;
      }
      await api(
        {
          action: "edit",
          title: p.title,
          text: next,
          summary: cfg.editSummary,
          token,
          bot: "1",
          basetimestamp: page.revisions?.[0]?.timestamp || "",
          maxlag: "5",
        },
        true,
      );
      changed++;
      await new Promise((r) =>
        setTimeout(r, Number(process.env.MEDIAWIKI_EDIT_DELAY_MS || 1500)),
      );
    } catch (e) {
      if (e instanceof Error && /^(ratelimited|maxlag):/.test(e.message)) {
        throw e;
      }
      failed++;
      console.error(p.title, e);
    }
  }
}

console.log({ changed, unchanged, failed });
if (failed) process.exitCode = 1;
