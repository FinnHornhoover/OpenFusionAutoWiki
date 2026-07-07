#!/usr/bin/env node
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const port = Number(process.env.PORT || 8787);
const allBuildSource = 'beta-20111013-fixed';
const fixedDataDir = join(root, 'fixed_data');
const publicDir = join(root, 'site', 'public');
const buildsPath = join(publicDir, 'builds.json');
const excludedTypes = new Set(['General', 'CRATE']);
const excludedTypeIds = new Set([7, 9]);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (fallback !== undefined && error && typeof error === 'object' && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function itemSortLabel(item) {
  if (item.type !== 'Weapon') return item.type || '';
  const weaponType = String(item.weaponType || '').trim();
  if (weaponType && weaponType !== 'None' && weaponType !== 'Weapon') return weaponType;
  const displayType = String(item.displayType || '').trim();
  if (displayType && displayType !== 'Weapon') return displayType;
  return item.type || '';
}

async function loadBuilds() {
  return readJson(buildsPath, []);
}

async function loadItems(slug) {
  const rows = await readJson(join(publicDir, 'data', slug, 'index', 'items.json'), []);
  return rows
    .filter((item) => item && !excludedTypeIds.has(item.typeId) && !excludedTypes.has(item.type))
    .map((item) => ({ ...item, setSortType: itemSortLabel(item) }))
    .sort((a, b) => a.setSortType.localeCompare(b.setSortType, undefined, { numeric: true }) || a.contentLevel - b.contentLevel || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function loadSets(slug) {
  return readJson(join(fixedDataDir, slug, 'item_sets.json'), {});
}

function normalizeSets(input) {
  const out = {};
  for (const raw of Object.values(input || {})) {
    const id = Number(raw.id);
    const name = String(raw.name || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !name) continue;
    const items = Array.from(new Set((raw.items || []).map(String).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    out[String(id)] = { id, name, items, reviewed: Boolean(raw.reviewed) };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
}

function associatedIds(sets) {
  const ids = new Set();
  for (const set of Object.values(sets)) {
    for (const id of set.items || []) ids.add(id);
  }
  return ids;
}

async function stateFor(build) {
  const builds = await loadBuilds();
  const mode = build === 'all' ? 'all' : 'single';
  const sourceBuild = mode === 'all' ? allBuildSource : build;
  if (!sourceBuild || !builds.some((b) => b.slug === sourceBuild)) throw new Error(`Unknown build: ${sourceBuild}`);
  const [items, sets] = await Promise.all([loadItems(sourceBuild), loadSets(sourceBuild)]);
  return { builds, mode, build, sourceBuild, items, sets: normalizeSets(sets), associated: [...associatedIds(sets)] };
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function pruneSmallSets(sets) {
  const normalized = normalizeSets(sets);
  const kept = Object.fromEntries(Object.entries(normalized).filter(([, set]) => set.items.length >= 2));
  return { sets: kept, pruned: Object.keys(normalized).length - Object.keys(kept).length };
}

async function writeSets(slug, sets) {
  const dir = join(fixedDataDir, slug);
  const pruned = pruneSmallSets(sets);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'item_sets.json'), JSON.stringify(pruned.sets, null, 2) + '\n');
  return { written: Object.keys(pruned.sets).length, pruned: pruned.pruned };
}

function pairedBuildSlugs(slug, builds) {
  const existing = new Set(builds.map((build) => build.slug));
  const base = slug.endsWith('-fixed') ? slug.slice(0, -'-fixed'.length) : slug;
  return [base, base + '-fixed'].filter((candidate) => existing.has(candidate));
}

async function saveBuildPair(build, sets) {
  const builds = await loadBuilds();
  const slugs = pairedBuildSlugs(build, builds);
  if (!slugs.length) throw new Error(`Unknown build: ${build}`);
  const mapped = Object.values(sets).reduce((n, set) => n + set.items.length, 0);
  const result = [];
  for (const slug of slugs) {
    const writeResult = await writeSets(slug, sets);
    result.push({ build: slug, mapped, missing: 0, pruned: writeResult.pruned });
  }
  return result;
}

async function saveAllBuilds(sourceSets) {
  const builds = await loadBuilds();
  const result = [];

  for (const build of builds) {
    const targetItems = await loadItems(build.slug);
    const targetIds = new Set(targetItems.map((item) => String(item.id)));
    const targetSets = {};
    let mapped = 0;
    let missing = 0;

    for (const set of Object.values(sourceSets)) {
      const items = [];
      for (const sourceId of set.items || []) {
        const id = String(sourceId);
        if (!targetIds.has(id)) { missing++; continue; }
        items.push(id);
        mapped++;
      }
      targetSets[String(set.id)] = { id: set.id, name: set.name, items: Array.from(new Set(items)), reviewed: Boolean(set.reviewed) };
    }

    const writeResult = await writeSets(build.slug, targetSets);
    result.push({ build: build.slug, mapped, missing, pruned: writeResult.pruned });
  }

  return result;
}

function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith('/icons/')) return false;
  const rel = normalize(pathname.slice(1));
  if (rel.startsWith('..')) return false;
  const path = join(publicDir, rel);
  if (!existsSync(path)) return false;
  const types = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.svg', 'image/svg+xml']]);
  res.writeHead(200, { 'content-type': types.get(extname(path).toLowerCase()) || 'application/octet-stream' });
  createReadStream(path).pipe(res);
  return true;
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const build = url.searchParams.get('build') || allBuildSource;
      return json(res, 200, await stateFor(build));
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      const payload = await bodyJson(req);
      const build = String(payload.build || '');
      const mode = build === 'all' ? 'all' : 'single';
      const sets = normalizeSets(payload.sets || {});
      if (mode === 'all') {
        const results = await saveAllBuilds(sets);
        return json(res, 200, { ok: true, mode, results });
      }
      if (!build) return json(res, 400, { ok: false, error: 'Missing build' });
      const results = await saveBuildPair(build, sets);
      return json(res, 200, { ok: true, mode, results });
    }
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Item Set Editor</title>
<style>
:root { color-scheme: dark; --bg:#0d1b2a; --panel:#16263a; --panel2:#1e3047; --border:#2a3f5c; --text:#e6eef7; --muted:#8aa0b8; --accent:#f4a261; --danger:#e63946; --ok:#6ad28a; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--text); overflow: hidden; }
button, input, select { font: inherit; }
button, select, input[type=search], input[type=text] { border: 1px solid var(--border); border-radius: 4px; background: var(--panel2); color: var(--text); padding: 8px 10px; }
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: #e07a26; color: #1a1300; font-weight: 700; }
button.danger { border-color: var(--danger); color: #ffd9dd; }
button:disabled { opacity: .45; cursor: not-allowed; }
.app { height: 100vh; height: 100dvh; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px; background: var(--panel); border-bottom: 1px solid var(--border); }
.toolbar label { display: inline-flex; gap: 8px; align-items: center; color: var(--muted); }
.toolbar select { min-width: min(440px, 100%); }
.status { margin-left: auto; color: var(--muted); }
.status.dirty { color: var(--accent); }
.main { display: grid; grid-template-columns: minmax(320px, 42%) minmax(360px, 1fr); gap: 12px; padding: 12px; min-height: 0; overflow: hidden; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); overflow: hidden; }
.item-panel { grid-template-rows: auto auto auto minmax(0, 1fr); }
.panel-head { padding: 12px; border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.panel-head h2 { margin: 0; font-size: 16px; }
.panel-controls { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.panel-controls input[type=search] { flex: 1 1 220px; min-width: 0; }
.list { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 8px; }
.row { width: 100%; display: grid; gap: 8px; align-items: center; text-align: left; border: 1px solid transparent; background: transparent; color: var(--text); padding: 8px; border-radius: 6px; }
.row:hover { background: var(--panel2); text-decoration: none; }
.row.selected { border-color: var(--accent); background: rgba(244,162,97,.12); }
.set-row { grid-template-columns: auto 1fr auto; }
.item-row { grid-template-columns: 52px 1fr auto auto; }
.icon { width: 52px; height: 52px; object-fit: contain; image-rendering: auto; }
.name { font-weight: 700; overflow-wrap: anywhere; }
.meta { color: var(--muted); font-size: 12px; }
.badge { display: inline-block; border: 1px solid var(--border); border-radius: 999px; padding: 2px 7px; color: var(--muted); font-size: 12px; white-space: nowrap; }
.badge.warn { border-color: var(--danger); color: #ffd9dd; background: rgba(230, 57, 70, .18); font-weight: 700; }
.item-row.unobtainable { border-color: rgba(230, 57, 70, .42); background: rgba(230, 57, 70, .07); }
.review-mark { color: var(--ok); font-weight: 800; font-size: 20px; line-height: 1; min-width: 1.5rem; text-align: center; }
.review-toggle { display: inline-flex; align-items: center; gap: 6px; }
.review-toggle.active { border-color: var(--ok); color: var(--ok); background: rgba(106, 210, 138, .12); }
.list-section-title { padding: 10px 8px 4px; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.selected-set { padding: 12px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,.12); display: grid; gap: 10px; }
.selected-set-title { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.set-items { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; gap: 7px; align-items: center; border: 1px solid var(--border); background: var(--panel2); border-radius: 999px; padding: 4px 8px 4px 5px; }
.chip .chip-icon { width: 24px; height: 24px; object-fit: contain; }
.chip .chip-text { display: inline-grid; gap: 0; line-height: 1.1; }
.chip .chip-id { color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.chip button { padding: 0 4px; border: 0; background: transparent; color: var(--danger); }
.empty { padding: 24px; color: var(--muted); text-align: center; }
.toast { position: fixed; right: 12px; bottom: 12px; max-width: min(520px, calc(100vw - 24px)); background: #07111f; border: 1px solid var(--border); border-radius: 8px; padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.35); white-space: pre-wrap; }
@media (max-width: 860px) {
  body { overflow: auto; }
  .app { height: auto; min-height: 100vh; min-height: 100dvh; }
  .main { grid-template-columns: 1fr; overflow: visible; }
  .panel { min-height: min(72vh, 720px); }
  .toolbar select, .toolbar button.primary { flex: 1 0 100%; }
  .status { margin-left: 0; }
}
</style>
</head>
<body>
<div class="app">
  <div class="toolbar">
    <strong>Item Set Editor</strong>
    <label>Build <select id="buildSelect"></select></label>
    <button id="saveBtn" class="primary">Save</button>
    <button id="reloadBtn">Reload</button>
    <button id="unreviewBtn" class="danger">Un-review build</button>
    <span id="reviewCount" class="badge">0 / 0 reviewed</span>
    <span id="status" class="status">Loading...</span>
  </div>
  <main class="main">
    <section class="panel">
      <div class="panel-head"><h2>Sets</h2><button id="addSetBtn">Add set</button><button id="deleteSetBtn" class="danger">Delete empty set</button></div>
      <div class="panel-controls"><input id="setSearch" type="search" placeholder="Search sets..." /></div>
      <div id="setList" class="list"></div>
    </section>
    <section class="panel item-panel">
      <div class="panel-head"><h2>Items</h2><span id="itemCount" class="meta"></span></div>
      <div id="selectedSet" class="selected-set"></div>
      <div class="panel-controls"><input id="itemSearch" type="search" placeholder="Search items..." /><label><input id="hideAssociated" type="checkbox" checked /> Hide items already in sets</label></div>
      <div id="itemList" class="list"></div>
    </section>
  </main>
</div>
<div id="toast" class="toast" hidden></div>
<script>
const state = { build: 'all', sourceBuild: '', builds: [], items: [], sets: {}, selectedSetId: null, dirty: false };
const els = Object.fromEntries(['buildSelect','saveBtn','reloadBtn','unreviewBtn','reviewCount','status','addSetBtn','deleteSetBtn','setSearch','setList','selectedSet','itemSearch','hideAssociated','itemList','itemCount','toast'].map(id => [id, document.getElementById(id)]));
const typeRank = new Map(['Thrown','Pistol','Rifle','Shattergun','Rocket','Body','Legs','Shoes','Hat','Glasses','Backpack','General','CRATE','Vehicle'].map((x,i)=>[x,i]));
const rarityRank = new Map(['Common','Uncommon','Rare','Ultra Rare','Amazing!'].map((x,i)=>[x,i]));
function reviewStats(){ const sets=Object.values(state.sets); return { reviewed: sets.filter(s=>s.reviewed).length, total: sets.length }; }
function updateReviewCount(){ const stats=reviewStats(); els.reviewCount.textContent=stats.reviewed.toLocaleString()+' / '+stats.total.toLocaleString()+' reviewed'; }
function updateModeControls(){ els.unreviewBtn.disabled = state.build === 'all'; }
function setDirty(value=true){ state.dirty=value; els.status.textContent = value ? 'Unsaved changes' : (state.build === 'all' ? 'All builds mode' : state.sourceBuild); els.status.className = 'status' + (value ? ' dirty' : ''); updateReviewCount(); updateModeControls(); }
function toast(msg){ els.toast.textContent=msg; els.toast.hidden=false; setTimeout(()=>{ els.toast.hidden=true; }, 6500); }
function sortedSets(){ return Object.values(state.sets).sort((a,b)=>Number(Boolean(a.reviewed))-Number(Boolean(b.reviewed)) || a.name.localeCompare(b.name, undefined, {numeric:true}) || a.id-b.id); }
function associated(){ const ids=new Set(); for(const set of Object.values(state.sets)) for(const id of set.items||[]) ids.add(id); return ids; }
function itemById(){ return new Map(state.items.map(item=>[item.id,item])); }
function itemType(item){ return item.setSortType || item.displayType || item.type || ''; }
function compareItems(a,b){ const ta=itemType(a), tb=itemType(b); return (typeRank.get(ta)??999)-(typeRank.get(tb)??999) || ta.localeCompare(tb, undefined, {numeric:true}) || a.contentLevel-b.contentLevel || (rarityRank.get(a.rarity)??999)-(rarityRank.get(b.rarity)??999) || a.name.localeCompare(b.name, undefined, {numeric:true}) || a.id.localeCompare(b.id, undefined, {numeric:true}); }
function currentSet(){ return state.selectedSetId == null ? null : state.sets[String(state.selectedSetId)] || null; }
function clearSearches(){ els.setSearch.value=''; els.itemSearch.value=''; }
function selectSet(id){ state.selectedSetId=id; clearSearches(); render(); }
function renderBuilds(){ els.buildSelect.innerHTML = '<option value="all">All builds (source: beta-20111013-fixed)</option>' + state.builds.map(b=>'<option value="'+b.slug+'">'+b.displayName+'</option>').join(''); els.buildSelect.value=state.build; }
function renderSets(){ const q=els.setSearch.value.trim().toLowerCase(); const rows=sortedSets().filter(s=>!q || s.name.toLowerCase().includes(q) || String(s.id)===q); els.setList.innerHTML = rows.length ? '' : '<div class="empty">No sets.</div>'; for(const set of rows){ const btn=document.createElement('button'); btn.className='row set-row'+(String(set.id)===String(state.selectedSetId)?' selected':''); btn.innerHTML='<span class="review-mark"></span><span><span class="name"></span><br><span class="meta"></span></span><span class="badge"></span>'; btn.querySelector('.review-mark').textContent=set.reviewed?'✓':''; btn.querySelector('.name').textContent=set.name; btn.querySelector('.meta').textContent='Set '+set.id; btn.querySelector('.badge').textContent=(set.items?.length||0)+' items'; btn.onclick=()=>{ selectSet(set.id); }; els.setList.appendChild(btn); } updateReviewCount(); }
function renderSelectedSet(){ const set=currentSet(); if(!set){ els.selectedSet.innerHTML='<div class="meta">Select a set before adding items.</div>'; els.deleteSetBtn.disabled=true; return; } els.deleteSetBtn.disabled=(set.items?.length||0)>0; const wrap=document.createElement('div'); const title=document.createElement('div'); title.className='selected-set-title'; title.innerHTML='<div><strong></strong><div class="meta"></div></div><button class="review-toggle" type="button"></button><button>Rename</button>'; title.querySelector('strong').textContent=set.name; title.querySelector('.meta').textContent='Set '+set.id+' · '+(set.items?.length||0)+' items'; const reviewBtn=title.querySelector('.review-toggle'); reviewBtn.textContent=set.reviewed?'✓ Reviewed':'Mark reviewed'; reviewBtn.classList.toggle('active', Boolean(set.reviewed)); reviewBtn.onclick=()=>{ set.reviewed=!set.reviewed; setDirty(); render(); }; title.querySelector('button:last-child').onclick=()=>renameSet(set); wrap.append(title); els.selectedSet.replaceChildren(wrap); }
function renderItems(){ const set=currentSet(); const q=els.itemSearch.value.trim().toLowerCase(); const used=associated(); const matches=item=>!q || (item.name+' '+item.id+' '+item.type+' '+item.displayType+' '+item.rarity).toLowerCase().includes(q); const inSetRows=set ? state.items.filter(item=>set.items?.includes(item.id) && matches(item)).sort(compareItems) : []; let otherRows=state.items.filter(item=>!set?.items?.includes(item.id) && matches(item)); if(els.hideAssociated.checked) otherRows=otherRows.filter(item=>!used.has(item.id)); otherRows.sort(compareItems); const rows=[...inSetRows,...otherRows]; els.itemCount.textContent=rows.length.toLocaleString()+' shown'; els.itemList.innerHTML=''; if(!rows.length){ els.itemList.innerHTML='<div class="empty">No items.</div>'; return; } const renderHeader=text=>{ const h=document.createElement('div'); h.className='list-section-title'; h.textContent=text; els.itemList.appendChild(h); }; const renderRow=item=>{ const inSet=Boolean(set?.items?.includes(item.id)); const inAny=used.has(item.id); const btn=document.createElement('button'); btn.className='row item-row'+(inSet?' selected':'')+(item.obtainable===false?' unobtainable':''); btn.disabled=!set; btn.innerHTML='<img class="icon" alt="" loading="lazy"><span><span class="name"></span><br><span class="meta"></span></span><span class="badge item-id"></span><span class="badge item-action"></span>'; btn.querySelector('img').src=item.icon?'/icons/'+item.icon:''; btn.querySelector('.name').textContent=item.name; btn.querySelector('.meta').textContent=[itemType(item),'Lv '+item.contentLevel,item.rarity,item.obtainable===false?'Unobtainable':'Obtainable'].filter(Boolean).join(' · '); btn.querySelector('.item-id').textContent=item.id; const action=btn.querySelector('.item-action'); action.textContent=inSet?'Remove':(item.obtainable===false?'Unobtainable':(inAny?'Has set':'Add')); if(item.obtainable===false) action.classList.add('warn'); btn.onclick=()=>{ if(!set) return; if(inSet) removeItem(set,item.id); else addItem(set,item.id); }; els.itemList.appendChild(btn); }; if(inSetRows.length){ renderHeader('In selected set'); inSetRows.forEach(renderRow); } if(otherRows.length){ if(inSetRows.length) renderHeader('Other items'); otherRows.forEach(renderRow); } }
function render(){ renderSets(); renderSelectedSet(); renderItems(); }
function addItem(set,id){ set.items=Array.from(new Set([...(set.items||[]),id])); setDirty(); render(); }
function removeItem(set,id){ set.items=(set.items||[]).filter(x=>x!==id); setDirty(); render(); }
function nextSetId(){ return Math.max(0,...Object.values(state.sets).map(s=>Number(s.id)||0))+1; }
function addSet(){ const name=prompt('Set name'); if(!name?.trim()) return; const id=nextSetId(); state.sets[String(id)]={id,name:name.trim(),items:[],reviewed:false}; state.selectedSetId=id; clearSearches(); setDirty(); render(); }
function renameSet(set){ const name=prompt('Set name', set.name); if(!name?.trim()) return; set.name=name.trim(); setDirty(); render(); }
function deleteSet(){ const set=currentSet(); if(!set) return; if((set.items||[]).length){ alert('Sets can only be deleted when empty.'); return; } if(!confirm('Delete '+set.name+'?')) return; delete state.sets[String(set.id)]; state.selectedSetId=null; clearSearches(); setDirty(); render(); }
function canonicalItems(set){ return Array.from(new Set((set?.items||[]).map(String))).sort((a,b)=>a.localeCompare(b, undefined, {numeric:true})); }
function setsDiffer(a,b){ if(!b) return true; if(String(a.name||'') !== String(b.name||'')) return true; const ai=canonicalItems(a), bi=canonicalItems(b); return ai.length !== bi.length || ai.some((id,i)=>id!==bi[i]); }
function referenceBuildSlug(){ if(state.sourceBuild === 'retrobution') return 'beta-20111013-fixed'; const current=state.builds.find(build=>build.slug===state.sourceBuild); if(!current?.date) return null; const next=state.builds.filter(build=>build.fixed && build.date && build.date > current.date).sort((a,b)=>a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug))[0]; return next?.slug || null; }
async function referenceSets(slug){ const res=await fetch('/api/state?build='+encodeURIComponent(slug)); const data=await res.json(); if(!res.ok || data.error) throw new Error(data.error||'Failed to load reference sets'); return data.sets || {}; }
async function unreviewBuild(){ if(state.build === 'all') return; const referenceSlug=referenceBuildSlug(); if(!referenceSlug){ toast('No later fixed reference build for '+state.sourceBuild+'.'); return; } const reference=await referenceSets(referenceSlug); const differing=Object.values(state.sets).filter(set=>setsDiffer(set, reference[String(set.id)])); const reviewed=differing.filter(set=>set.reviewed); if(!differing.length){ toast('No set differences from '+referenceSlug+'.'); return; } if(!reviewed.length){ toast(differing.length.toLocaleString()+' differing sets were already unreviewed.'); return; } if(!confirm('Clear reviewed status for '+reviewed.length.toLocaleString()+' changed sets in '+state.sourceBuild+' compared to '+referenceSlug+'?')) return; for(const set of reviewed) set.reviewed=false; setDirty(); render(); }
async function load(build=state.build){ if(state.dirty && !confirm('Discard unsaved changes?')) return; els.status.textContent='Loading...'; const res=await fetch('/api/state?build='+encodeURIComponent(build)); const data=await res.json(); if(!res.ok || data.error) throw new Error(data.error||'Load failed'); Object.assign(state,{build:data.build,sourceBuild:data.sourceBuild,builds:data.builds,items:data.items,sets:data.sets,selectedSetId:null,dirty:false}); renderBuilds(); setDirty(false); render(); }
async function save(){ els.status.textContent='Saving...'; const res=await fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({build:state.build,sets:state.sets})}); const data=await res.json(); if(!res.ok || !data.ok) throw new Error(data.error||'Save failed'); setDirty(false); const formatResult=r=>r.build+': '+r.mapped+' mapped, '+r.missing+' missing, '+(r.pruned||0)+' pruned'; const summary=data.mode==='all'?data.results.map(formatResult).join('\n'):'Saved '+data.results.map(r=>r.build+' ('+(r.pruned||0)+' pruned)').join(', '); toast(summary); }
els.buildSelect.onchange=()=>load(els.buildSelect.value).catch(e=>toast(e.message)); els.saveBtn.onclick=()=>save().catch(e=>toast(e.message)); els.reloadBtn.onclick=()=>load().catch(e=>toast(e.message)); els.unreviewBtn.onclick=()=>unreviewBuild().catch(e=>toast(e.message)); els.addSetBtn.onclick=addSet; els.deleteSetBtn.onclick=deleteSet; els.setSearch.oninput=renderSets; els.itemSearch.oninput=renderItems; els.hideAssociated.onchange=renderItems; window.onbeforeunload=()=>state.dirty?'Unsaved item set changes':undefined; load('all').catch(e=>toast(e.message));
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (serveStatic(req, res, url)) return;
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return text(res, 200, html, 'text/html; charset=utf-8');
  return text(res, 404, 'Not found');
});

server.listen(port, () => {
  console.log(`Item set editor running at http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
});
