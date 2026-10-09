/* =====================================================================
   MUSICAL ATLAS - map/atlas-map.js
   Mappamondo interattivo, senza librerie e senza servizi esterni.

   Livelli:   MONDO -> CONTINENTE -> ZONA
     - i continenti sono le cartelle dentro World
     - le zone sono le sottocartelle di un continente
       (tranne INSTRUMENTS e PEOPLES)
   Stati:     BLOCCATO (gira, EXPLORE al centro) / ATTIVO (si naviga e si zooma)

   Dati:      map/world.json       confini dei paesi (Natural Earth)
              map/map-config.json  alias dei nomi, paesi delle zone
              atlas-index.json     passato da app.js con AtlasMap.setIndex()

   Per le pagine (usato da app.js):
     AtlasMap.setIndex(index)   dopo aver letto atlas-index.json
     AtlasMap.knows(testo)      vero se la mappa sa mostrare quel nome
     AtlasMap.show(testo)       apre la mappa e va su quel nome
     AtlasMap.represents(nodo)  vero se la mappa mostra quella cartella o pagina
                                (i suoi pulsanti si nascondono a mappa aperta)
     AtlasMap.label             testo della voce di menu ("show on map")

   Sezioni:
     1. Impostazioni
     2. Nomi
     3. Indice del sito (cartelle, pagine, popoli)
     4. Dati geografici (paesi, zone, aloni dei popoli)
     5. Proiezione
     6. Disegno
     7. Livelli, stati, animazioni, sincronia con l'indirizzo
     8. Mouse e dita
     9. Riquadro e avvio
   ===================================================================== */
(() => {
"use strict";


/* =====================================================================
   1. IMPOSTAZIONI
   ===================================================================== */
const WORLD_FILE  = "map/world.json";
const CONFIG_FILE = "map/map-config.json";
const SPECIAL_FOLDERS = ["INSTRUMENTS", "PEOPLES"];   // come in app.js
const STORE_KEY = "musicalAtlas.mapOpen";              // ricorda se la mappa e' aperta
const FROZEN_KEY = "musicalAtlas.mapFrozen";           // ricorda se il globo e' bloccato
const FLY_MS = 1100;          // durata degli spostamenti
const ZOOM_MS = 450;          // durata di uno scatto di zoom
const ZOOM_FACTOR = 1.6;      // uno scatto di + o - (e un pizzico)
const WHEEL_FACTOR = 1.25;    // uno scatto della rotellina
const ZOOM_MAX_EXTRA = 2;     // zoom massimo: il paese piu' piccolo dell'atlante inquadrato, per 2
const STAR_SIZE = 1.5;        // grandezza delle stelline (1 = piccole, 2 = il doppio)
const SPIN_DEG_S = 3;         // rotazione del globo bloccato (gradi al secondo, al livello mondo)
const SMALL_AREA = 1;         // gradi^2: paesi minuscoli ignorati per l'inquadratura
const SHOW_OUTSIDE_NAMES = true;   // nomi anche fuori dal confine del livello (true = si', false = no)

const DEFAULT_LABELS = {
  map: "MAP", explore: "EXPLORE", showOnMap: "show on map",
  loading: "LOADING…", error: "Map not available.",
};

const DEG = Math.PI / 180;


/* =====================================================================
   2. NOMI
   ===================================================================== */
// Identica a normalizeKey di app.js
function normalizeKey(s){
  return String(s || "").trim().normalize("NFC")
    .replace(/[‘’‚‛´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .toLowerCase();
}
// Identica a geo_key di _build_index.py: anche senza accenti
function geoKey(s){
  return normalizeKey(s).normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}
// Toglie punteggiatura ai bordi (come trovaPaginaOCartella di app.js)
function cleanText(t){
  return String(t || "").replace(/^[\s"'(\[‘“]+|[\s"'.,;:!?)\]’”]+$/g, "");
}
const stem = (name) => String(name).replace(/\.[^.]+$/, "");
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");
function currentPath(){
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ""; }
}
// Benvenuto (nessuna pagina aperta): il globo gira e si parte solo da EXPLORE
const isWelcome = () => !currentPath();


/* =====================================================================
   3. INDICE DEL SITO
   ===================================================================== */
const SITE = {
  index: null,
  root: null,
  byPath: new Map(),
  parentOf: new Map(),
  continents: [],             // cartelle continente
  zones: [],                  // cartelle zona
  countryPages: new Map(),    // geoKey(titolo) -> pagina del paese
  pageCode: new Map(),        // percorso pagina del paese -> codice del paese
  codePage: new Map(),        // codice del paese -> pagina
  onMap: new Set(),           // percorsi di continenti, zone e paesi presenti sulla mappa
  peoples: new Map(),         // normalizeKey(nome) -> popolo {name, path, countries}
  groups: new Map(),          // percorso pagina PEOPLES -> [chiavi popoli]
  names: new Map(),           // geoKey -> cosa mostrare
};
let resolveIndex;
const indexReady = new Promise(r => { resolveIndex = r; });

const isFolder = (n) => n && n.type === "folder";
const isSpecial = (n) => isFolder(n) && SPECIAL_FOLDERS.includes(n.name.toUpperCase());

function presentationOf(folder){
  const want = folder.name.toLowerCase();
  return folder.children.find(c => c.type === "page" && stem(c.name).toLowerCase() === want) || null;
}

function chainOf(node){
  const chain = [];
  for (let n = node; n; n = SITE.parentOf.get(n.path)) chain.unshift(n);
  return chain;
}

// Continente e zona che contengono un percorso
function placeOf(path){
  const node = SITE.byPath.get(path);
  if (!node) return { node: null, continent: null, zone: null };
  const chain = chainOf(node);
  const continent = isFolder(chain[1]) ? chain[1] : null;
  const zone = continent && isFolder(chain[2]) && !isSpecial(chain[2]) ? chain[2] : null;
  return { node, chain, continent, zone };
}

function setIndex(index){
  SITE.index = index;
  SITE.root = index.tree;
  SITE.byPath.clear(); SITE.parentOf.clear(); SITE.countryPages.clear();
  SITE.peoples.clear(); SITE.groups.clear(); SITE.names.clear();

  (function walk(node, parent){
    SITE.byPath.set(node.path, node);
    if (parent) SITE.parentOf.set(node.path, parent);
    if (isFolder(node)) for (const ch of node.children) walk(ch, node);
  })(SITE.root, null);

  SITE.continents = SITE.root.children.filter(c => isFolder(c) && !isSpecial(c));
  SITE.zones = [];
  for (const cont of SITE.continents){
    for (const z of cont.children){
      if (isFolder(z) && !isSpecial(z)) SITE.zones.push(z);
    }
  }

  // Cosa compare sulla mappa: lo calcola _build_index.py (sezione "map")
  const info = index.map || { continents: [], zones: [], countryPages: {} };
  SITE.pageCode.clear(); SITE.codePage.clear();
  for (const [path, code] of Object.entries(info.countryPages || {})){
    const page = SITE.byPath.get(path);
    if (!page) continue;
    SITE.pageCode.set(path, code);
    if (!SITE.codePage.has(code)) SITE.codePage.set(code, page);
    SITE.countryPages.set(geoKey(page.title), page);
  }
  SITE.onMap = new Set([...(info.continents || []), ...(info.zones || []), ...SITE.pageCode.keys()]);

  for (const [key, p] of Object.entries(index.peoples || {})){
    SITE.peoples.set(key, p);
    if (!SITE.groups.has(p.path)) SITE.groups.set(p.path, []);
    SITE.groups.get(p.path).push(key);
  }

  // Nomi riconosciuti, dal meno al piu' importante (l'ultimo vince)
  const names = SITE.names;
  for (const [k, code] of Object.entries(index.geoNames || {})) names.set(k, { kind: "country", code });
  for (const [k, page] of SITE.countryPages) names.set(k, { kind: "country", page });
  for (const [key, p] of SITE.peoples) names.set(geoKey(p.name), { kind: "people", key });
  for (const z of SITE.zones){
    if (SITE.onMap.has(z.path)) names.set(geoKey(z.title), { kind: "zone", node: z });
  }
  for (const c of SITE.continents){
    if (SITE.onMap.has(c.path)) names.set(geoKey(c.title), { kind: "continent", node: c });
  }

  resolveIndex();
  if (GEO.ready) { buildGeoFromSite(); syncFromAddress(false); }
}

function lookup(text){
  return SITE.names.get(geoKey(cleanText(text))) || null;
}


/* =====================================================================
   4. DATI GEOGRAFICI
   Ogni punto e' salvato come 4 numeri: longitudine, latitudine (radianti),
   cos(latitudine), sin(latitudine).
   ===================================================================== */
const GEO = {
  ready: false,
  cfg: null,
  countries: [],               // {code, name, cont, sub, label, rings, cap, area}
  byCode: new Map(),
  coast: [],                   // coste di tutte le terre
  q: 100,
  continents: new Map(),       // cartella -> {codes, outline, cap}
  zones: new Map(),            // cartella -> {codes, outline, cap}
  zoneOfCode: new Map(),
  continentOfCode: new Map(),
  peoples: new Map(),          // chiave -> {name, codes, vec, lon, lat, radius}
};

const vec = (lam, phi) => [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norm(v){ const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const lonOf = (v) => Math.atan2(v[1], v[0]);
const latOf = (v) => Math.asin(Math.max(-1, Math.min(1, v[2])));

function makePoints(lonlatDeg){            // [[lon,lat],...] in gradi
  const n = lonlatDeg.length, a = new Float64Array(n * 4);
  for (let i = 0; i < n; i++){
    const lam = lonlatDeg[i][0] * DEG, phi = lonlatDeg[i][1] * DEG;
    a[i * 4] = lam; a[i * 4 + 1] = phi; a[i * 4 + 2] = Math.cos(phi); a[i * 4 + 3] = Math.sin(phi);
  }
  return a;
}

// Cerchio che contiene una serie di punti: centro (vettore) e raggio (radianti)
function capOf(pts, center){
  const n = pts.length / 4;
  let c = center;
  if (!c){
    let s = [0, 0, 0];
    for (let i = 0; i < n; i++){
      const v = vec(pts[i * 4], pts[i * 4 + 1]);
      s[0] += v[0]; s[1] += v[1]; s[2] += v[2];
    }
    c = norm(s);
  }
  let r = 0;
  for (let i = 0; i < n; i++) r = Math.max(r, angle(c, vec(pts[i * 4], pts[i * 4 + 1])));
  return { vec: c, r };
}

function decodeWorld(world){
  const q = world.q || 100;
  GEO.q = q;
  for (const c of world.countries){
    const rings = [];
    for (const flat of c.r){
      const ints = new Int32Array(flat.length);
      let x = 0, y = 0;
      const deg = [];
      for (let i = 0; i < flat.length; i += 2){
        x = i ? x + flat[i] : flat[i];
        y = i ? y + flat[i + 1] : flat[i + 1];
        ints[i] = x; ints[i + 1] = y;
        deg.push([x / q, y / q]);
      }
      // area e baricentro (piani, in gradi: bastano per un paese)
      let A = 0, cx = 0, cy = 0;
      for (let i = 0, n = deg.length; i < n; i++){
        const [x1, y1] = deg[(i + n - 1) % n], [x2, y2] = deg[i];
        const f = x1 * y2 - x2 * y1;
        A += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
      }
      const area = Math.abs(A / 2) * Math.cos((deg[0][1]) * DEG);
      const centroid = A ? [cx / (3 * A), cy / (3 * A)] : deg[0];
      const pts = makePoints(deg);
      const cap = capOf(pts, vec(centroid[0] * DEG, centroid[1] * DEG));
      rings.push({ pts, ints, area, centroid, cap });
    }
    const main = rings.reduce((a, b) => (b.area > a.area ? b : a));
    // solo le parti vicine al territorio principale (niente isole d'oltremare)
    const near = rings.filter(r => r === main ||
      (r.area >= 0.5 && angle(r.cap.vec, main.cap.vec) < 25 * DEG));
    let s = [0, 0, 0], area = 0, r = 0;
    for (const ring of near){
      const v = ring.cap.vec;
      s[0] += v[0] * ring.area; s[1] += v[1] * ring.area; s[2] += v[2] * ring.area;
      area += ring.area;
    }
    const center = norm(s);
    for (const ring of near) r = Math.max(r, angle(center, ring.cap.vec) + ring.cap.r);
    const country = {
      code: c.a, name: c.n, cont: c.c, sub: c.s,
      label: vec(c.l[0] * DEG, c.l[1] * DEG), labelLonLat: c.l,
      rings, cap: { vec: center, r }, area,
    };
    GEO.countries.push(country);
    GEO.byCode.set(country.code, country);
  }
}

// Le cuciture lungo l'antimeridiano e il polo sud non si disegnano.
function isSeam(ints, i, j){
  const x1 = ints[i * 2], y1 = ints[i * 2 + 1], x2 = ints[j * 2], y2 = ints[j * 2 + 1];
  return (Math.abs(x1) >= 17999 && Math.abs(x2) >= 17999) || (y1 <= -8990 && y2 <= -8990);
}
const edgeKey = (ints, i, j) => {
  const a = ints[i * 2] + "," + ints[i * 2 + 1], b = ints[j * 2] + "," + ints[j * 2 + 1];
  return a < b ? a + "|" + b : b + "|" + a;
};
let EDGE_OWNERS = null;     // tratto -> paesi che lo usano
function edgeOwners(){
  if (EDGE_OWNERS) return EDGE_OWNERS;
  EDGE_OWNERS = new Map();
  for (const c of GEO.countries){
    for (const ring of c.rings){
      const n = ring.ints.length / 2;
      for (let i = 0; i < n; i++){
        const k = edgeKey(ring.ints, i, (i + 1) % n);
        const list = EDGE_OWNERS.get(k);
        if (list){ if (!list.includes(c.code)) list.push(c.code); }
        else EDGE_OWNERS.set(k, [c.code]);
      }
    }
  }
  return EDGE_OWNERS;
}

/* ---------- Contorni morbidi ----------
   Ogni paese riceve un'etichetta (il suo continente, o la sua zona).
   Si tengono solo i tratti tra etichette diverse e le coste,
   si uniscono in linee, si semplificano molto e si arrotondano.
   Ogni confine e' calcolato e disegnato una volta sola. */
const SMOOTH = { coast: 0.45, continent: 0.5, zone: 0.3 };   // gradi di approssimazione

function boundaries(labelOf, tol){
  const owners = edgeOwners(), q = GEO.q;
  const edges = [], coords = new Map(), seen = new Set();
  for (const c of GEO.countries){
    for (const ring of c.rings){
      const ints = ring.ints, n = ints.length / 2;
      for (let i = 0; i < n; i++){
        const j = (i + 1) % n;
        if (isSeam(ints, i, j)) continue;
        const k = edgeKey(ints, i, j);
        if (seen.has(k)) continue;
        seen.add(k);
        const o = owners.get(k);
        const labels = new Set(o.map(labelOf));
        if (o.length > 1 && labels.size === 1) continue;     // dentro lo stesso gruppo
        const a = ints[i * 2] + "," + ints[i * 2 + 1], b = ints[j * 2] + "," + ints[j * 2 + 1];
        coords.set(a, [ints[i * 2] / q, ints[i * 2 + 1] / q]);
        coords.set(b, [ints[j * 2] / q, ints[j * 2 + 1] / q]);
        edges.push({ a, b, labels, sides: [...labels].sort().join("|") });
      }
    }
  }

  // unione dei tratti in linee, spezzate dove si incontrano piu' confini
  const adj = new Map();
  edges.forEach((e, idx) => {
    for (const p of [e.a, e.b]){ if (!adj.has(p)) adj.set(p, []); adj.get(p).push(idx); }
  });
  const used = new Uint8Array(edges.length);
  const isNode = (p) => {
    const l = adj.get(p);
    return l.length !== 2 || edges[l[0]].sides !== edges[l[1]].sides;
  };
  const walk = (start, first) => {
    const pts = [start], sides = edges[first].sides;
    let cur = start, e = first;
    for (;;){
      used[e] = 1;
      const next = edges[e].a === cur ? edges[e].b : edges[e].a;
      pts.push(next);
      if (next === start) break;
      const l = adj.get(next);
      if (l.length !== 2) break;
      const other = l[0] === e ? l[1] : l[0];
      if (used[other] || edges[other].sides !== sides) break;
      cur = next; e = other;
    }
    return { keys: pts, labels: edges[first].labels };
  };
  const chains = [];
  for (const p of adj.keys()){
    if (!isNode(p)) continue;
    for (const e of adj.get(p)) if (!used[e]) chains.push(walk(p, e));
  }
  edges.forEach((e, idx) => { if (!used[idx]) chains.push(walk(e.a, idx)); });   // anelli (isole)

  const out = [];
  for (const ch of chains){
    let pts = ch.keys.map(k => coords.get(k));
    const closed = ch.keys[0] === ch.keys[ch.keys.length - 1];
    if (closed){
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of pts){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (Math.max(x1 - x0, y1 - y0) < tol * 2.5) continue;      // isolette: niente
    }
    pts = smooth(simplify(pts, tol, closed), closed);
    if (pts.length < 2) continue;
    const p4 = makePoints(pts);
    out.push({ pts: p4, cap: capOf(p4), labels: ch.labels });
  }
  return out;
}

// Douglas-Peucker in gradi (estremi fissi)
function simplify(pts, tol, closed){
  if (pts.length < 3) return pts;
  if (closed){
    // si spezza l'anello nel punto piu' lontano dall'inizio
    let far = 1, fd = -1;
    for (let i = 1; i < pts.length - 1; i++){
      const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
      if (d > fd){ fd = d; far = i; }
    }
    const a = simplify(pts.slice(0, far + 1), tol, false);
    const b = simplify(pts.slice(far), tol, false);
    return a.concat(b.slice(1));
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length){
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = 0, idx = -1;
    for (let k = i + 1; k < j; k++){
      const [px, py] = pts[k];
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > best){ best = d; idx = k; }
    }
    if (idx >= 0 && best > tol){ keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// Arrotondamento di Chaikin (2 passaggi): angoli smussati, estremi fermi
function smooth(pts, closed){
  for (let it = 0; it < 2; it++){
    if (pts.length < 3) return pts;
    const out = closed ? [] : [pts[0]];
    const n = pts.length - (closed ? 1 : 0);
    for (let i = 0; i < (closed ? n : n - 1); i++){
      const p = pts[i], q = pts[(i + 1) % n];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    if (closed) out.push(out[0]); else out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// Cerchio piu' stretto che inquadra un gruppo di paesi
// (senza isole minuscole e territori lontani)
// Punti del contorno di un gruppo di paesi (niente isole lontane): servono a inquadrarlo
function pointsOfCodes(codes){
  let list = [...codes].map(c => GEO.byCode.get(c)).filter(Boolean);
  const big = list.filter(c => c.area >= SMALL_AREA);
  if (big.length) list = big;
  const pts = [];
  for (const c of list){
    const main = c.rings.reduce((a, b) => (b.area > a.area ? b : a));
    for (const ring of c.rings){
      if (ring !== main && (ring.area < 0.5 || angle(ring.cap.vec, c.cap.vec) > 25 * DEG)) continue;
      const n = ring.pts.length / 4, step = Math.max(1, Math.floor(n / 60));
      for (let k = 0; k < n; k += step) pts.push(vec(ring.pts[k * 4], ring.pts[k * 4 + 1]));
    }
  }
  return pts;
}

function capOfCodes(codes){
  let list = [...codes].map(c => GEO.byCode.get(c)).filter(Boolean);
  const big = list.filter(c => c.area >= SMALL_AREA);
  if (big.length) list = big;
  if (!list.length) return null;
  const pts = [];
  for (const c of list){
    for (const ring of c.rings){
      if (ring !== c.rings.reduce((a, b) => (b.area > a.area ? b : a)) &&
          (ring.area < 0.5 || angle(ring.cap.vec, c.cap.vec) > 25 * DEG)) continue;
      const n = ring.pts.length / 4, step = Math.max(1, Math.floor(n / 60));
      for (let k = 0; k < n; k += step) pts.push(vec(ring.pts[k * 4], ring.pts[k * 4 + 1]));
    }
  }
  // Badoiu-Clarkson: il centro si sposta verso il punto piu' lontano
  let s = [0, 0, 0];
  for (const p of pts){ s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
  let center = norm(s);
  for (let it = 1; it <= 80; it++){
    let far = pts[0], fd = -1;
    for (const p of pts){ const d = angle(center, p); if (d > fd){ fd = d; far = p; } }
    center = norm(slerp(center, far, 1 / (it + 1)));
  }
  let r = 0;
  for (const p of pts) r = Math.max(r, angle(center, p));
  return { vec: center, r };
}

function codeOfName(name){
  const hit = (SITE.index && SITE.index.geoNames || {})[geoKey(name)];
  if (hit) return hit;
  const alias = Object.entries(GEO.cfg.aliases || {}).find(([k]) => geoKey(k) === geoKey(name));
  if (alias) return alias[1];
  const c = GEO.countries.find(c => geoKey(c.name) === geoKey(name));
  return c ? c.code : null;
}

function viewOverride(name){
  const v = (GEO.cfg.views || {})[name];
  if (!v || !Array.isArray(v.center)) return null;
  return { vec: vec(v.center[0] * DEG, v.center[1] * DEG), r: (v.radius || 20) * DEG };
}

// Coste di tutte le terre (tenui, per non lasciare il globo vuoto)
// e, dalle stesse coste, le sagome delle terre per il grigio di fondo
function buildStatic(){
  GEO.coast = boundaries(() => "land", SMOOTH.coast);
  GEO.land = stitch(GEO.coast);
  // i continenti di Natural Earth, con il loro centro (per i nomi senza cartella)
  GEO.neContinents = new Map();
  for (const c of GEO.countries){
    if (/seven seas/i.test(c.cont)) continue;
    if (!GEO.neContinents.has(c.cont)) GEO.neContinents.set(c.cont, { name: c.cont, codes: new Set(), first: c.code });
    GEO.neContinents.get(c.cont).codes.add(c.code);
  }
  for (const ne of GEO.neContinents.values()) ne.cap = capOfCodes(ne.codes);
}

// Riunisce i tratti di costa in anelli chiusi (gli estremi coincidono esattamente)
function stitch(lines){
  const key = (pts, k) => pts[k * 4].toFixed(6) + "," + pts[k * 4 + 1].toFixed(6);
  const items = lines.map(l => ({ pts: l.pts, n: l.pts.length / 4, used: false }));
  const byEnd = new Map();
  const add = (k, it) => { if (!byEnd.has(k)) byEnd.set(k, []); byEnd.get(k).push(it); };
  for (const it of items){ add(key(it.pts, 0), it); add(key(it.pts, it.n - 1), it); }
  const rings = [];
  for (const first of items){
    if (first.used) continue;
    first.used = true;
    const out = [];
    const push = (it, reverse) => {
      for (let i = 0; i < it.n; i++){
        const k = reverse ? it.n - 1 - i : i;
        out.push(it.pts[k * 4], it.pts[k * 4 + 1], it.pts[k * 4 + 2], it.pts[k * 4 + 3]);
      }
    };
    push(first, false);
    const start = key(first.pts, 0);
    let end = key(first.pts, first.n - 1);
    while (end !== start){
      const next = (byEnd.get(end) || []).find(it => !it.used);
      if (!next) break;                              // tratto aperto (bordo della mappa)
      next.used = true;
      const rev = key(next.pts, 0) !== end;
      push(next, rev);
      end = rev ? key(next.pts, 0) : key(next.pts, next.n - 1);
    }
    const pts = new Float64Array(out);
    rings.push({ pts, cap: capOf(pts) });
  }
  return rings;
}

// Continenti, zone e popoli: dipendono dalle cartelle del sito
function buildGeoFromSite(){
  FOOT.clear(); ITEMS.sig = null;
  // il paese piu' piccolo con una pagina: decide lo zoom massimo
  GEO.smallestCode = null;
  let smallest = Infinity;
  for (const code of SITE.codePage.keys()){
    const c = GEO.byCode.get(code);
    if (c && c.cap.r < smallest){ smallest = c.cap.r; GEO.smallestCode = code; }
  }
  GEO.continents.clear(); GEO.zones.clear(); GEO.zoneOfCode.clear();
  GEO.continentOfCode.clear(); GEO.peoples.clear();

  for (const folder of SITE.continents){
    const ne = (GEO.cfg.continents || {})[folder.name] || [folder.name];
    const wanted = ne.map(x => x.toLowerCase());
    const codes = new Set(GEO.countries.filter(c => wanted.includes(c.cont.toLowerCase())).map(c => c.code));
    if (!codes.size) continue;
    for (const c of codes) GEO.continentOfCode.set(c, folder);
    GEO.continents.set(folder.path, {
      folder, codes, outline: [],
      cap: viewOverride(folder.name) || capOfCodes(codes),
      fixed: !!viewOverride(folder.name),        // inquadratura scritta a mano: si rispetta
      pts: pointsOfCodes(codes),
    });
  }
  // contorni dei continenti (solo quelli che hanno una cartella)
  const contLines = boundaries((code) => {
    const f = GEO.continentOfCode.get(code);
    return f ? f.path : "ne:" + GEO.byCode.get(code).cont;
  }, SMOOTH.continent);
  for (const c of GEO.continents.values()) c.outline = contLines.filter(l => l.labels.has(c.folder.path));

  // paesi delle zone: prima quelli scritti nella configurazione,
  // poi le pagine dei paesi (una pagina sposta il paese nella sua zona)
  const listed = new Map();
  for (const z of SITE.zones){
    const set = new Set();
    for (const item of ((GEO.cfg.zones || {})[z.name] || [])){
      const code = GEO.byCode.has(item) ? item : codeOfName(item);
      if (code) set.add(code);
    }
    listed.set(z.path, set);
  }
  for (const [path, code] of SITE.pageCode){
    const zone = SITE.parentOf.get(path);
    if (!zone || !listed.has(zone.path) || !GEO.byCode.has(code)) continue;
    for (const s of listed.values()) s.delete(code);
    listed.get(zone.path).add(code);
  }
  for (const z of SITE.zones){
    const codes = listed.get(z.path);
    if (!codes.size) continue;
    for (const c of codes) GEO.zoneOfCode.set(c, z);
    GEO.zones.set(z.path, { folder: z, codes, outline: [], cap: viewOverride(z.name) || capOfCodes(codes),
                            fixed: !!viewOverride(z.name), pts: pointsOfCodes(codes) });
  }
  // contorni delle zone: un confine tra due zone e' una linea sola
  const zoneLines = boundaries((code) => {
    const z = GEO.zoneOfCode.get(code);
    return z ? z.path : "other";
  }, SMOOTH.zone);
  for (const z of GEO.zones.values()) z.outline = zoneLines.filter(l => l.labels.has(z.folder.path));
  // per ogni continente: tutte le linee delle sue zone, senza doppioni
  for (const c of GEO.continents.values()){
    const mine = new Set([...GEO.zones.values()].filter(z => SITE.parentOf.get(z.folder.path) === c.folder).map(z => z.folder.path));
    c.zoneLines = zoneLines.filter(l => [...l.labels].some(x => mine.has(x)));
  }

  // aloni dei popoli: centro medio dei paesi (pesato per superficie)
  const placed = [];
  for (const [key, p] of SITE.peoples){
    const codes = (p.countries || []).map(codeOfName).filter(c => c && GEO.byCode.has(c));
    if (!codes.length) continue;
    let s = [0, 0, 0], area = 0;
    for (const code of codes){
      const c = GEO.byCode.get(code), w = Math.max(c.area, 0.05);
      s[0] += c.cap.vec[0] * w; s[1] += c.cap.vec[1] * w; s[2] += c.cap.vec[2] * w;
      area += c.area;
    }
    let v = norm(s);
    let lon = lonOf(v) / DEG, lat = latOf(v) / DEG;
    // popoli con lo stesso centro: spostati un po' a spirale
    const same = placed.filter(q => Math.abs(q.lon0 - lon) < 0.4 && Math.abs(q.lat0 - lat) < 0.4).length;
    const lon0 = lon, lat0 = lat;
    if (same){
      const a = same * 2.4, d = 0.9 * Math.sqrt(same);
      lon += d * Math.cos(a) / Math.max(0.2, Math.cos(lat * DEG));
      lat += d * Math.sin(a);
      v = vec(lon * DEG, lat * DEG);
    }
    const radius = Math.min(12, Math.max(1.1, Math.sqrt(area) * 0.45)) * DEG;
    const item = { key, name: p.name, path: p.path, codes, vec: v, lon, lat, lon0, lat0, radius };
    placed.push(item);
    GEO.peoples.set(key, item);
  }
}


/* =====================================================================
   5. PROIEZIONE (ortografica: il globo visto da lontano)
   ===================================================================== */
const VIEW = {
  lam: 15 * DEG, phi: 12 * DEG, R: 200,     // centro della vista e raggio del globo (px)
  w: 300, h: 300, cx: 150, cy: 150, dpr: 1,
  sp: 0, cp: 1,                               // sin/cos della latitudine del centro
};
function updateTrig(){ VIEW.sp = Math.sin(VIEW.phi); VIEW.cp = Math.cos(VIEW.phi); }
const viewVec = () => vec(VIEW.lam, VIEW.phi);

// Proietta il punto k di "pts": restituisce visibilita' (coseno) e x, y
const P = { x: 0, y: 0, c: 0 };
function project(pts, k){
  const dl = pts[k * 4] - VIEW.lam, cphi = pts[k * 4 + 2], sphi = pts[k * 4 + 3];
  const cdl = Math.cos(dl);
  P.c = VIEW.sp * sphi + VIEW.cp * cphi * cdl;
  P.x = cphi * Math.sin(dl);
  P.y = VIEW.cp * sphi - VIEW.sp * cphi * cdl;
}
function projectVec(v){
  const lam = lonOf(v), phi = latOf(v);
  const dl = lam - VIEW.lam, cdl = Math.cos(dl), cphi = Math.cos(phi), sphi = Math.sin(phi);
  const c = VIEW.sp * sphi + VIEW.cp * cphi * cdl;
  return {
    visible: c > 0, c,
    x: VIEW.cx + VIEW.R * cphi * Math.sin(dl),
    y: VIEW.cy - VIEW.R * (VIEW.cp * sphi - VIEW.sp * cphi * cdl),
  };
}
// Dallo schermo a longitudine/latitudine (radianti), o null fuori dal globo
function invert(sx, sy){
  const x = (sx - VIEW.cx) / VIEW.R, y = (VIEW.cy - sy) / VIEW.R;
  const rho = Math.hypot(x, y);
  if (rho > 1) return null;
  const c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c);
  const phi = Math.asin(cc * VIEW.sp + (rho ? (y * sc * VIEW.cp) / rho : 0));
  let lam = VIEW.lam + Math.atan2(x * sc, rho * cc * VIEW.cp - y * sc * VIEW.sp);
  lam = ((lam + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return [lam, phi];
}
// Il cerchio "cap" puo' essere visibile?
function capVisible(cap, vv){ return dot(vv, cap.vec) > -Math.sin(Math.min(cap.r, Math.PI / 2)) - 0.02; }


/* =====================================================================
   6. DISEGNO
   ===================================================================== */
const UI = {};                 // elementi del riquadro
let ctx = null;
let COLORS = {};
let STARS = null;
let drawQueued = false;

function readColors(){
  const cs = getComputedStyle(UI.stage);
  const v = (name, def) => (cs.getPropertyValue(name) || "").trim() || def;
  COLORS = {
    bg: v("--map-bg", "#000"), line: v("--map-line", "#fff"),
    people: v("--map-people", "#FFFF00"), stars: v("--map-stars", "#fff"),
    land: parseFloat(v("--map-land", "0.06")) || 0,
    labelOn: v("--map-label-on", "#fff"),           // nome acceso
    labelOff: v("--map-label-off", "#9a9a9a"),      // nome nell'atlante, spento
    labelOther: v("--map-label-other", "#555555"),  // nome non ancora nell'atlante
    labelOutline: v("--map-label-outline", "#000"), // contorno dei nomi
    font: v("--map-font", "600 11px system-ui, sans-serif"),
    genres: v("--map-genres", "#00FF00"), instruments: v("--map-instruments", "#00FFFF"),
    itemFont: v("--map-item-font", "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"),
    dim: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dim")) || 0.55,
  };
}

function requestDraw(){
  if (drawQueued || !STATE.open || !GEO.ready) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

// Stelline: disegnate una volta, poi solo spostate
function makeStars(){
  const w = Math.ceil(VIEW.w), h = Math.ceil(VIEW.h), dpr = VIEW.dpr;
  const cv = document.createElement("canvas");
  cv.width = w * dpr; cv.height = h * dpr;
  const c = cv.getContext("2d");
  c.scale(dpr, dpr);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const n = Math.round((w * h) / 1700);
  c.fillStyle = COLORS.stars;
  for (let i = 0; i < n; i++){
    const big = rnd() < 0.08;
    c.globalAlpha = big ? 0.8 : 0.15 + rnd() * 0.45;
    const s = (big ? 1.4 : 0.5 + rnd() * 0.6) * STAR_SIZE;
    c.beginPath(); c.arc(rnd() * w, rnd() * h, s / 2, 0, 2 * Math.PI); c.fill();
  }
  STARS = cv;
}

function strokeLines(lines, vv){
  ctx.beginPath();
  for (const line of lines){
    if (!capVisible(line.cap, vv)) continue;
    const pts = line.pts, n = pts.length / 4;
    let pen = false;
    for (let k = 0; k < n; k++){
      project(pts, k);
      if (P.c > 0){
        const X = VIEW.cx + VIEW.R * P.x, Y = VIEW.cy - VIEW.R * P.y;
        if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
      } else pen = false;
    }
  }
  ctx.stroke();
}

// Riempimento: i punti dietro il globo vengono portati sul bordo
function addCountryPath(country, vv){
  for (const ring of country.rings){
    if (!capVisible(ring.cap, vv)) continue;
    const pts = ring.pts, n = pts.length / 4;
    for (let k = 0; k < n; k++){
      project(pts, k);
      let x = P.x, y = P.y;
      if (P.c <= 0){ const l = Math.hypot(x, y) || 1; x /= l; y /= l; }
      const X = VIEW.cx + VIEW.R * x, Y = VIEW.cy - VIEW.R * y;
      if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
    ctx.closePath();
  }
}
// Velatura sulle nazioni: piena e uniforme fino al confine,
// con un alone che dal confine sfuma verso l'esterno.
// Si disegna su un foglio a parte (bianco pieno), poi si posa sul globo
// con la trasparenza voluta, cosi' l'interno resta uniforme.
let VEIL = null;
function fillCountries(codes, alpha, vv){
  if (!VEIL) VEIL = document.createElement("canvas");
  if (VEIL.width !== UI.canvas.width || VEIL.height !== UI.canvas.height){
    VEIL.width = UI.canvas.width; VEIL.height = UI.canvas.height;
  }
  const main = ctx, v = VEIL.getContext("2d");
  v.setTransform(1, 0, 0, 1, 0, 0);
  v.clearRect(0, 0, VEIL.width, VEIL.height);
  v.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);

  ctx = v;                                   // addCountryPath disegna su ctx
  ctx.beginPath();
  for (const code of codes){
    const c = GEO.byCode.get(code);
    if (c && capVisible(c.cap, vv)) addCountryPath(c, vv);
  }
  ctx = main;

  const halo = Math.min(12, Math.max(3, VIEW.R * 0.01));   // larghezza dell'alone (px)
  v.fillStyle = v.strokeStyle = COLORS.line;
  v.lineJoin = "round";
  // alone: il contorno, spesso e sfumato (la meta' interna resta coperta dal pieno)
  v.lineWidth = halo * 1.4;
  if ("filter" in v) v.filter = "blur(" + (halo * 0.6 * VIEW.dpr).toFixed(1) + "px)";
  else { v.shadowColor = COLORS.line; v.shadowBlur = halo * VIEW.dpr; }
  v.stroke();
  v.filter = "none"; v.shadowBlur = 0;
  // pieno uniforme fino al confine
  v.fill("evenodd");

  main.save();
  main.setTransform(1, 0, 0, 1, 0, 0);
  main.globalAlpha = alpha;
  main.drawImage(VEIL, 0, 0);
  main.restore();
}

// Tutte le terre, grigio tenue: sagome ricavate dalle coste morbide
// (un solo riempimento, nessun confine visibile, leggero da disegnare)
function fillLand(vv){
  if (!COLORS.land) return;
  ctx.beginPath();
  for (const ring of GEO.land){
    if (!capVisible(ring.cap, vv)) continue;
    const pts = ring.pts, n = pts.length / 4;
    for (let k = 0; k < n; k++){
      project(pts, k);
      let x = P.x, y = P.y;
      if (P.c <= 0){ const l = Math.hypot(x, y) || 1; x /= l; y /= l; }
      const X = VIEW.cx + VIEW.R * x, Y = VIEW.cy - VIEW.R * y;
      if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
    ctx.closePath();
  }
  ctx.globalAlpha = COLORS.land;
  ctx.fillStyle = COLORS.line;
  ctx.fill("evenodd");
}

function glowPx(p){ return Math.max(6, VIEW.R * Math.sin(p.radius)); }

function drawGlow(p, strength, noDot){
  const s = projectVec(p.vec);
  if (!s.visible) return;
  const r = glowPx(p);
  const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
  g.addColorStop(0, COLORS.people);
  g.addColorStop(0.35, COLORS.people);
  g.addColorStop(1, "transparent");
  ctx.globalAlpha = strength * Math.min(1, s.c * 3);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 2 * Math.PI); ctx.fill();
  if (noDot) return;
  // puntino centrale (e' anche il punto da cliccare)
  ctx.globalAlpha = strength > 0.4 ? 1 : 0.75;
  ctx.fillStyle = COLORS.people;
  ctx.beginPath(); ctx.arc(s.x, s.y, strength > 0.4 ? 3 : 2, 0, 2 * Math.PI); ctx.fill();
}

// Scritte, senza sovrapposizioni (vince chi viene prima).
// I nomi cliccabili (continenti, zone, paesi con pagina) si comportano come i pulsanti:
//   spento = grandezza normale, testo grigio chiaro (--map-label-off)
//   acceso = un po' piu' grande, testo bianco (--map-label-on)
// I nomi che non sono ancora nell'atlante sono grigio scuro (--map-label-other).
// Tutti hanno lo stesso contorno (--map-label-outline). Colori in atlas-map.css.
//            (paese selezionato, o mouse sopra al nome o all'area)
// Il passaggio tra i due stati e' graduale.
const LABELS = [];
let LABEL_HITS = [];                 // dove sono stati disegnati i nomi cliccabili (per il mouse)
const LABEL_GLOW = new Map();        // nome -> quanto e' acceso (da 0 a 1)
const LABEL_FADE_MS = 160;           // durata del passaggio spento/acceso
const LABEL_GROW = 1.18;             // quanto si ingrandisce un nome acceso
let labelsT = 0;
function queueLabel(text, v, opts){ LABELS.push({ text, v, ...opts }); }

function rgbOf(c){
  const m = String(c).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1]; if (h.length === 3) h = h.replace(/./g, x => x + x);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function mix(a, b, t){
  const A = rgbOf(a), B = rgbOf(b);
  if (!A || !B) return t < 0.5 ? a : b;
  return "rgb(" + A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(",") + ")";
}
function fontAt(scale){
  return COLORS.font.replace(/(\d+(?:\.\d+)?)px/, (m, n) => (parseFloat(n) * scale).toFixed(1) + "px");
}

// Larghezza delle scritte, misurata una volta sola per testo e grandezza
const TEXT_W = new Map();
function textWidth(text, font){
  const k = font + "|" + text;
  let w = TEXT_W.get(k);
  if (w == null){
    w = ctx.measureText(text).width;
    if (TEXT_W.size > 4000) TEXT_W.clear();
    TEXT_W.set(k, w);
  }
  return w;
}

function drawLabels(){
  const now = performance.now();
  const dt = labelsT ? Math.min(100, now - labelsT) : 1000;
  labelsT = now;
  const step = dt / LABEL_FADE_MS;
  let moving = false;
  const used = [], hits = [], seen = new Set();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.08em";
  LABELS.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const vv = viewVec();
  for (const L of LABELS){
    // quanto e' acceso questo nome (avvicinamento graduale allo stato voluto)
    let g = 0;
    if (L.button){
      const want = L.on ? 1 : 0;
      g = LABEL_GLOW.has(L.button) ? LABEL_GLOW.get(L.button) : want;
      if (g < want) g = Math.min(want, g + step); else if (g > want) g = Math.max(want, g - step);
      if (g !== want) moving = true;
      LABEL_GLOW.set(L.button, g);
      seen.add(L.button);
    }
    if (dot(L.v, vv) < 0.15) continue;           // dietro il globo o troppo sul bordo: scartato subito
    const s = projectVec(L.v);
    const y = s.y + (L.dy || 0);
    const text = L.text.toUpperCase();
    const scale = 1 + (LABEL_GROW - 1) * g;
    ctx.font = scale === 1 ? COLORS.font : fontAt(scale);
    const w = textWidth(text, ctx.font) + 6, h = 14 * scale;
    const box = [s.x - w / 2, y - h / 2, s.x + w / 2, y + h / 2];
    if (box[2] < 0 || box[0] > VIEW.w || box[3] < 0 || box[1] > VIEW.h) continue;
    if (used.some(b => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
    used.push(box);
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
    if (L.button){
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.labelOutline;                  // contorno
      ctx.strokeText(text, s.x, y);
      ctx.fillStyle = mix(COLORS.labelOff, COLORS.labelOn, g); // testo: grigio chiaro -> bianco
      ctx.fillText(text, s.x, y);
      if (L.hit) hits.push({ box, hit: L.hit });
    } else {
      ctx.lineWidth = 3; ctx.strokeStyle = COLORS.labelOutline;
      ctx.strokeText(text, s.x, y);
      ctx.globalAlpha = L.alpha == null ? 1 : L.alpha;
      ctx.fillStyle = L.color || COLORS.line;
      ctx.fillText(text, s.x, y);
    }
  }
  for (const k of LABEL_GLOW.keys()) if (!seen.has(k)) LABEL_GLOW.delete(k);
  LABEL_HITS = hits;
  LABELS.length = 0;
  ctx.font = COLORS.font;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  if (moving) requestDraw();                 // la transizione continua al prossimo fotogramma
  else labelsT = 0;
}

function draw(){
  const { w, h, cx, cy, R } = VIEW;
  updateTrig();
  const vv = viewVec();
  ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  // stelle (scorrono piano quando il globo gira)
  if (STARS){
    const off = (((-VIEW.lam / DEG) * 0.6) % w + w) % w;
    ctx.drawImage(STARS, off - w, 0, w, h);
    ctx.drawImage(STARS, off, 0, w, h);
  }

  // globo
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = COLORS.bg; ctx.globalAlpha = 1; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();

  ctx.strokeStyle = COLORS.line; ctx.lineJoin = "round"; ctx.lineCap = "round";

  const lv = STATE.level;
  const frozen = STATE.frozen;
  const zone = STATE.zone && GEO.zones.get(STATE.zone.path);
  const cont = STATE.continent && GEO.continents.get(STATE.continent.path);
  let hover = frozen ? null : (STATE.preview || STATE.hover);
  // il paese in cui sei non si schiarisce e non mostra il nome al passaggio del mouse
  if (hover && hover.kind === "country" && hover.code === STATE.country) hover = null;

  // terre
  fillLand(vv);

  // velature (al passaggio del mouse e sulla nazione aperta; mai da bloccato)
  if (lv === "world" && hover && hover.kind === "continent"){
    const c = GEO.continents.get(hover.node.path);
    if (c) fillCountries(c.codes, 0.13, vv);
  } else if (lv === "continent" && hover && hover.kind === "zone"){
    const z = GEO.zones.get(hover.node.path);
    if (z) fillCountries(z.codes, 0.13, vv);
  } else if (lv === "zone" || lv === "free"){
    if (hover && hover.kind === "country") fillCountries([hover.code], 0.1, vv);
    if (STATE.hlCountries.size) fillCountries(STATE.hlCountries, 0.16, vv);
  }

  // coste di tutte le terre, tenui
  ctx.globalAlpha = lv === "world" ? 0.32 : 0.25;
  ctx.lineWidth = 0.9;
  strokeLines(GEO.coast, vv);

  // contorni forti: continenti (livello 1) o zone (livelli 2 e 3)
  if (lv === "world"){
    ctx.globalAlpha = 0.95; ctx.lineWidth = 1.2;
    for (const c of GEO.continents.values()) strokeLines(c.outline, vv);
  } else if (lv === "continent" && cont){
    ctx.globalAlpha = 0.95; ctx.lineWidth = 1.3;
    strokeLines(cont.zoneLines, vv);
  } else if (zone && frozen){
    // bloccato: tutte le zone uguali, nessuna in evidenza
    if (cont){ ctx.globalAlpha = 0.95; ctx.lineWidth = 1.3; strokeLines(cont.zoneLines, vv); }
  } else if (zone){
    if (cont){ ctx.globalAlpha = 0.3; ctx.lineWidth = 1; strokeLines(cont.zoneLines, vv); }
    ctx.globalAlpha = 0.95; ctx.lineWidth = 1.6;
    strokeLines(zone.outline, vv);
  }

  // aloni dei popoli: solo con PEOPLES acceso (niente piu' puntini: il nome e' un pulsante)
  ctx.globalCompositeOperation = "screen";
  if (STATE.layer === "PEOPLES"){
    for (const it of currentItems()){
      if (!it.native) continue;
      const hov = hover && hover.kind === "people" && hover.key === it.key;
      const hl = STATE.hlPeoples.has(it.key);
      drawGlow({ vec: it.anchor, radius: it.radius }, hl ? 0.7 : hov ? 0.5 : (STATE.hlPeoples.size ? 0.05 : 0.09), true);
    }
  } else if (lv === "zone" || lv === "free"){
    // popoli chiesti apposta (pagina di un gruppo, "show on map"): l'alone resta
    for (const key of STATE.hlPeoples){
      const p = GEO.peoples.get(key);
      if (p) drawGlow(p, 0.7, true);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();

  // bordo del globo
  ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.strokeStyle = COLORS.line;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();

  // scritte (i nomi cliccabili si accendono se selezionati o col mouse sopra)
  const isHover = (kind, id) => hover && hover.kind === kind &&
    (kind === "country" ? hover.code === id : hover.node && hover.node.path === id);
  if (STATE.layer !== "INFO"){
    // PEOPLES / GENRES / INSTRUMENTS: i loro nomi prendono il posto di quelli dei luoghi;
    // il nome di un luogo compare solo col mouse sopra (o al primo tocco sul telefono)
    const h = STATE.preview || hover;
    let name = null, at = null;
    if (h && (h.kind === "continent" || h.kind === "zone" || h.kind === "country")){
      if (h.kind === "country"){ const c = GEO.byCode.get(h.code); name = h.page ? h.page.title : c && c.name; at = c && c.label; }
      else {
        const g = h.kind === "zone" ? GEO.zones.get(h.node.path) : GEO.continents.get(h.node.path);
        name = h.node.title; at = g && g.cap.vec;
      }
    }
    drawLabels();
    drawItems();
    // il nome del luogo sotto il mouse sta sopra le voci
    if (name && at && dot(at, vv) > 0.15){
      const q = projectVec(at);
      ctx.font = fontAt(LABEL_GROW);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.08em";
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = 1;
      ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = COLORS.labelOutline;
      ctx.strokeText(name.toUpperCase(), q.x, q.y);
      ctx.fillStyle = COLORS.labelOn;
      ctx.fillText(name.toUpperCase(), q.x, q.y);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      ctx.font = COLORS.font;
    }
    return;
  }
  if (lv === "world"){
    for (const c of GEO.continents.values()){
      const id = c.folder.path;
      queueLabel(c.folder.title, labelVec("k:" + id, c.codes, c.cap.vec), { priority: 5, button: "k:" + id,
        on: isHover("continent", id), hit: { kind: "continent", node: c.folder } });
    }
  } else if (lv === "continent"){
    for (const z of GEO.zones.values()){
      if (!cont || SITE.parentOf.get(z.folder.path) !== cont.folder) continue;
      const id = z.folder.path;
      queueLabel(z.folder.title, labelVec("z:" + id, z.codes, z.cap.vec), { priority: 5, button: "z:" + id,
        on: isHover("zone", id), hit: { kind: "zone", node: z.folder } });
    }
  } else {
    const codes = new Set(zone ? zone.codes : []);
    for (const code of STATE.hlCountries) codes.add(code);
    for (const code of codes){
      const c = GEO.byCode.get(code);
      if (!c) continue;
      const page = pageOfCode(code);
      const hl = STATE.hlCountries.has(code);
      if (page){
        const on = hl || isHover("country", code);
        queueLabel(page.title, labelVec("c:" + code, [code], c.label), { priority: on ? 8 : 4, button: "c:" + code,
          on, hit: { kind: "country", code, page } });
      } else {
        queueLabel(c.name, labelVec("c:" + code, [code], c.label), { priority: 2, color: COLORS.labelOther });   // senza pagina: non ancora nell'atlante
      }
    }
  }
  if (SHOW_OUTSIDE_NAMES) queueOutsideLabels(lv, cont, zone);
  drawLabels();
}

// Nomi che seguono il territorio: se il punto del nome e' fuori dallo schermo ma il
// territorio si vede ancora, il nome va al centro della parte visibile.
// A globo fermo il calcolo e' fine; mentre si trascina si rifa' ogni LABEL_FOLLOW_MS
// con una griglia piu' rada, e il nome scivola morbido verso il punto nuovo.
const LABEL_FOLLOW_MS = 110;      // ogni quanto si ricalcola mentre il globo si muove
const LABEL_GLIDE = 0.3;          // quanto si avvicina per fotogramma (0..1)
const LABEL_TARGET = new Map();   // nome -> dove deve andare
const LABEL_SHOWN = new Map();    // nome -> dove e' disegnato adesso
let labelPosSig = "", labelPosT = 0;
function labelVec(id, codes, def){
  const moving = !!STATE.anim || STATE.dragging || spinning();
  const now = performance.now();
  const sig = [VIEW.lam, VIEW.phi, VIEW.R, VIEW.w, VIEW.h].map(x => (+x).toFixed(4)).join();
  if (sig !== labelPosSig && (!moving || now - labelPosT > LABEL_FOLLOW_MS)){
    LABEL_TARGET.clear(); labelPosSig = sig; labelPosT = now;
  }
  if (!LABEL_TARGET.has(id)) LABEL_TARGET.set(id, visiblePoint(codes, def, moving ? 30 : 18));
  const want = LABEL_TARGET.get(id);
  // scivola verso il punto voluto (se e' molto lontano, ci va subito)
  let shown = LABEL_SHOWN.get(id) || want;
  if (angle(shown, want) > 0.6) shown = want;
  else if (angle(shown, want) > 1e-4){
    shown = norm(slerp(shown, want, LABEL_GLIDE));
    requestDraw();
  } else shown = want;
  LABEL_SHOWN.set(id, shown);
  return shown;
}
function visiblePoint(codes, def, step){
  const vv = viewVec();
  const p = projectVec(def);
  const onScreen = dot(def, vv) > 0.15 && p.x > 30 && p.x < VIEW.w - 30 && p.y > 20 && p.y < VIEW.h - 20;
  if (onScreen) return def;
  const list = [...codes].map(c => GEO.byCode.get(c)).filter(Boolean);
  if (!list.some(c => angle(c.cap.vec, vv) < Math.PI / 2 + c.cap.r)) return def;
  const cells = [];
  for (let y = step; y < VIEW.h - 10; y += step){
    for (let x = step; x < VIEW.w - 10; x += step){
      const ll = invert(x, y);
      if (!ll) continue;
      const g = vec(ll[0], ll[1]);
      if (list.some(c => pointInCountry(c, g))) cells.push([x, y, g]);
    }
  }
  if (!cells.length) return def;
  let mx = 0, my = 0;
  for (const [x, y] of cells){ mx += x; my += y; }
  mx /= cells.length; my /= cells.length;
  return cells.reduce((a, b) => (Math.hypot(b[0] - mx, b[1] - my) < Math.hypot(a[0] - mx, a[1] - my) ? b : a))[2];
}

// Nomi fuori dal confine del livello (precedenza piu' bassa: spariscono per primi)
//   mondo:      i continenti senza cartella
//   continente: gli altri continenti (con cartella = grigio chiaro, senza = grigio scuro)
//   zona:       i paesi fuori dalla zona (con pagina altrove = grigio chiaro, senza = grigio scuro)
function queueOutsideLabels(lv, cont, zone){
  if (lv === "world" || lv === "continent"){
    for (const ne of GEO.neContinents.values()){
      const folder = GEO.continentOfCode.get(ne.first);
      if (folder && (lv === "world" || (cont && folder === cont.folder))) continue;   // gia' scritto
      if (folder){
        const c = GEO.continents.get(folder.path);
        queueLabel(folder.title, (c || ne).cap.vec, { priority: 1, color: COLORS.labelOff });
      } else {
        queueLabel(ne.name, ne.cap.vec, { priority: 1, color: COLORS.labelOther });
      }
    }
  } else if (lv === "zone" || lv === "free"){
    const inside = new Set(zone ? zone.codes : []);
    for (const code of STATE.hlCountries) inside.add(code);
    for (const c of GEO.countries){
      if (inside.has(c.code) || c.area < 0.3) continue;      // dentro, o troppo piccolo
      const page = pageOfCode(c.code);
      queueLabel(page ? page.title : c.name, c.label, {
        priority: 1, color: page ? COLORS.labelOff : COLORS.labelOther,
      });
    }
  }
}

/* =====================================================================
   6b. VOCI SUL GLOBO (PEOPLES / GENRES / INSTRUMENTS)
   Un livello alla volta, scelto dall'interruttore dell'info box (AtlasMap.setLayer).
   Le voci sono quelle che l'info box elenca per il luogo aperto.

   UNITA' di riferimento: a WORLD i continenti, in un continente le zone,
   in una zona i paesi. Una pagina di gruppo (es. MANDE) occupa i paesi dei suoi popoli.

   Ogni voce compare UNA volta:
     NATIVA  (ha una patria tra le unita' del livello): dentro la patria;
             se le patrie sono piu' di una, in mezzo.
     CITATA  (la patria non c'e' in questo livello): subito fuori dal confine
             dell'unita' che la cita piu' vicina alla patria, dal lato della patria;
             senza patria: in un punto "a caso", sempre lo stesso per quel nome.
   Aspetto: pulsanti come nell'info box (citata = tono scuro). Grandezza: tutte le
   volte che la voce compare nell'atlante, +1% ciascuna fino a +20% (20 volte);
   oltre, in proporzione fino al piu' citato (+25%), a scatti di mezzo punto.
   Se una voce non trova posto: contatore "+N" sulla sua unita' (clic = zoom).
   ===================================================================== */
const ITEM_FONT_PX = 8;           // grandezza base del testo delle voci (una citazione)
const ITEM_STEP_N = 20;           // fino a quante citazioni si cresce dell'1% ciascuna
const ITEM_MAX_PCT = 25;          // il piu' citato dell'atlante
const ITEM_FADE_MS = 220;         // comparsa di una voce
const HOVER_GROW = 1.1;           // col mouse sopra una voce si ingrandisce un poco
const HOOKS = { onItem: null, onMore: null, onHere: null, onStart: null };
const ITEMS = { sig: null, list: [] };
const PLACED = new Map();         // voce -> dove era (resta ferma mentre il globo si muove)
const ITEM_ALPHA = new Map();     // voce -> quanto e' comparsa (0..1)
const FOOT = new Map();           // pagina -> paesi che occupa
let itemsT = 0;

// Numero "a caso" ma sempre uguale per lo stesso nome (0..1)
function hash01(text){
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function pointInCountry(c, v){
  if (angle(v, c.cap.vec) > c.cap.r + 0.01 && c.rings.length === 1) return false;
  const lam = lonOf(v), phi = latOf(v);
  let inside = false;
  for (const ring of c.rings){
    if (angle(v, ring.cap.vec) > ring.cap.r + 0.01) continue;
    const pts = ring.pts, n = pts.length / 4;
    for (let i = 0, j = n - 1; i < n; j = i++){
      const xi = pts[i * 4], yi = pts[i * 4 + 1], xj = pts[j * 4], yj = pts[j * 4 + 1];
      if ((yi > phi) !== (yj > phi) && lam < ((xj - xi) * (phi - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function inCodes(v, codes){
  for (const code of codes){
    const c = GEO.byCode.get(code);
    if (c && pointInCountry(c, v)) return true;
  }
  return false;
}

// Paesi occupati da una pagina: paese -> se stesso; pagina di un gruppo -> paesi
// dei suoi popoli; pagina di presentazione di una zona o di un continente -> i suoi paesi
function footprint(path){
  if (FOOT.has(path)) return FOOT.get(path);
  const out = new Set();
  const code = SITE.pageCode.get(path);
  if (code) out.add(code);
  else if (SITE.groups.has(path)){
    for (const key of SITE.groups.get(path)){
      const p = SITE.peoples.get(key);
      for (const n of (p && p.countries) || []){ const c = codeOfName(n); if (c) out.add(c); }
    }
  } else {
    const parent = SITE.parentOf.get(path), node = SITE.byPath.get(path);
    if (parent && node && presentationOf(parent) === node){
      const g = GEO.zones.get(parent.path) || GEO.continents.get(parent.path);
      if (g) for (const c of g.codes) out.add(c);
    }
  }
  FOOT.set(path, out);
  return out;
}
const footOf = (pages) => {
  const out = new Set();
  for (const p of pages) for (const c of footprint(p)) out.add(c);
  return out;
};

// Unita' del livello mostrato
function unitsOfLevel(){
  const lv = STATE.level;
  if (lv === "world"){
    return {
      of: (code) => { const f = GEO.continentOfCode.get(code); return f && GEO.continents.has(f.path) ? f.path : null; },
      center: (u) => GEO.continents.get(u).cap.vec,
      codes: (u) => GEO.continents.get(u).codes,
      weight: () => 1,
    };
  }
  if (lv === "continent" && STATE.continent){
    const cont = STATE.continent;
    return {
      of: (code) => { const z = GEO.zoneOfCode.get(code); return z && SITE.parentOf.get(z.path) === cont ? z.path : null; },
      center: (u) => GEO.zones.get(u).cap.vec,
      codes: (u) => GEO.zones.get(u).codes,
      weight: () => 1,
    };
  }
  const zone = STATE.zone && GEO.zones.get(STATE.zone.path);
  const inside = new Set(zone ? zone.codes : []);
  for (const c of STATE.hlCountries) inside.add(c);
  if (STATE.country){                          // livello paese: l'unita' e' solo il paese
    inside.clear(); inside.add(STATE.country);
  }
  return {
    of: (code) => (lv === "free" || inside.has(code)) && GEO.byCode.has(code) ? code : null,
    center: (u) => GEO.byCode.get(u).label,
    codes: (u) => [u],
    weight: (u) => Math.max(GEO.byCode.get(u).area, 0.05),
  };
}

// Lo spazio del luogo aperto (paesi): i citati stanno fuori dal suo confine,
// i nativi possono allargarsi dentro. WORLD: nessuno spazio (null).
function spaceOfPlace(){
  const node = SITE.byPath.get(currentPath());
  if (!node || node === SITE.root) return null;
  if (node.type === "page"){
    const code = SITE.pageCode.get(node.path);
    if (code) return new Set([code]);
    if (SITE.groups.has(node.path)){ const f = footprint(node.path); return f.size ? f : null; }
  }
  let folder = node.type === "folder" ? node : SITE.parentOf.get(node.path);
  if (folder && isSpecial(folder)) folder = SITE.parentOf.get(folder.path);
  const g = folder && (GEO.zones.get(folder.path) || GEO.continents.get(folder.path));
  return g ? new Set(g.codes) : null;
}
function centerOfCodes(codes){
  const list = [...codes].map(c => GEO.byCode.get(c)).filter(Boolean);
  if (list.length === 1) return list[0].label;
  return centroid(list.map(c => c.cap.vec), list.map(c => Math.max(c.area, 0.05)));
}

function centroid(vs, ws){
  const s = [0, 0, 0];
  vs.forEach((v, i) => { const w = ws ? ws[i] : 1; s[0] += v[0] * w; s[1] += v[1] * w; s[2] += v[2] * w; });
  return norm(s);
}

// Le voci del livello acceso, con dove vanno sul globo (si ricalcola solo se cambia qualcosa)
function currentItems(){
  const layer = STATE.layer;
  if (layer === "INFO" || !SITE.index) return [];
  const sig = [layer, currentPath(), STATE.level, STATE.continent && STATE.continent.path, STATE.onlySig,
               STATE.zone && STATE.zone.path, [...STATE.hlCountries].join()].join("|");
  if (ITEMS.sig === sig) return ITEMS.list;
  ITEMS.sig = sig;
  ITEMS.list = buildItems(layer);
  return ITEMS.list;
}

function buildItems(layer){
  const idx = SITE.index;
  const node = SITE.byPath.get(currentPath()) || SITE.root;
  const inScope = node.type === "page" ? (p) => p === node.path
    : node === SITE.root ? () => true : (p) => p.startsWith(node.path + "/");
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

  // voci grezze: nome, pagine dove e' nativa / citata, quante volte compare
  const raw = [];
  if (layer === "GENRES"){
    for (const [key, g] of Object.entries(idx.genres || {})){
      raw.push({ key, name: g.term, native: Object.keys(g.native), cited: Object.keys(g.cited),
                 total: sum(g.native) + sum(g.cited) });
    }
  } else if (layer === "INSTRUMENTS"){
    const m = (idx.instruments && idx.instruments.mentions) || {};
    for (const [key, g] of Object.entries(m)){
      raw.push({ key, name: g.name, native: Object.keys(g.native), cited: Object.keys(g.cited),
                 total: sum(g.native) + sum(g.cited) });
    }
  } else if (layer === "PEOPLES"){
    for (const [key, p] of SITE.peoples){
      const pages = Object.keys(p.pages || {}).filter(x => SITE.pageCode.has(x));   // giallo nei paesi
      const codes = new Set((p.countries || []).map(codeOfName).filter(Boolean));
      for (const c of footOf(pages)) codes.add(c);
      raw.push({ key, name: p.name, path: p.path, codes, cited: [], total: Math.max(1, sum(p.pages)) });
    }
  }
  const max = raw.reduce((m, r) => Math.max(m, r.total), 0);
  const pctOf = (n) => {
    if (n <= ITEM_STEP_N || max <= ITEM_STEP_N) return Math.min(n, ITEM_STEP_N);
    const x = ITEM_STEP_N + (ITEM_MAX_PCT - ITEM_STEP_N) * (n - ITEM_STEP_N) / (max - ITEM_STEP_N);
    return Math.round(x * 2) / 2;
  };

  // nel luogo aperto?
  const scopeCodes = layer === "PEOPLES"
    ? footOf([...SITE.byPath.keys()].filter(p => SITE.byPath.get(p).type === "page" && inScope(p)))
    : null;
  const U = unitsOfLevel();
  const space = layer === "PEOPLES" ? null : spaceOfPlace();
  const spaceCenter = space ? centerOfCodes(space) : null;
  const list = [];
  for (const r of raw){
    let nativeCodes, citedCodes;
    if (layer === "PEOPLES"){
      const here = [...r.codes].some(c => scopeCodes.has(c)) || inScope(r.path);
      if (!here) continue;
      nativeCodes = r.codes; citedCodes = new Set();
    } else {
      if (!r.native.some(inScope) && !r.cited.some(inScope)) continue;
      nativeCodes = footOf(r.native);
      citedCodes = footOf(r.cited.filter(inScope));
    }
    if (layer === "INSTRUMENTS" && STATE.only && !STATE.only.has(r.key)) continue;   // ramo scelto nel catalogo
    const it = { key: r.key, name: r.name, path: r.path, total: r.total, pct: pctOf(r.total) };
    const nUnits = [...new Set([...nativeCodes].map(U.of).filter(Boolean))];
    if (nUnits.length){
      it.native = true;
      it.anchor = (nUnits.length === 1) ? U.center(nUnits[0]) : nearAll(nUnits, U);
      it.inside = new Set(nUnits.flatMap(u => [...U.codes(u)]));
      it.home = nUnits.reduce((a, b) => (U.weight(b) > U.weight(a) ? b : a));
      let area = 0;
      for (const c of it.inside){ const g = GEO.byCode.get(c); if (g) area += g.area; }
      it.radius = Math.min(12, Math.max(1.1, Math.sqrt(area) * 0.45)) * DEG;
    } else {
      const cUnits = [...new Set([...citedCodes].map(U.of).filter(Boolean))];
      if (!cUnits.length) continue;                         // niente da mostrare qui
      const all = [...nativeCodes].map(c => GEO.byCode.get(c)).filter(Boolean);
      const target = all.length ? centroid(all.map(c => c.cap.vec), all.map(c => Math.max(c.area, 0.05))) : null;
      it.native = false;
      if (space){
        // fuori dal confine del luogo aperto, dal lato della patria
        it.home = "out";
        it.center = spaceCenter;
        it.unitCodes = space;
      } else {
        it.home = target
          ? cUnits.reduce((a, b) => (angle(U.center(b), target) < angle(U.center(a), target) ? b : a))
          : cUnits[Math.floor(hash01(r.name) * cUnits.length)];
        it.center = U.center(it.home);
        it.unitCodes = new Set(U.codes(it.home));
      }
      it.bearing = target ? bearingTo(it.center, target) : hash01(r.name + "*") * 2 * Math.PI;
      it.borders = new Map();
      it.anchor = it.center;
    }
    it.homeCenter = it.home === "out" ? null : U.center(it.home);
    it.space = space;
    list.push(it);
  }
  // le unita' fanno a turno: prima il piu' citato di ognuna, poi il secondo di ognuna...
  // (i citati, fuori dal confine, vengono dopo i nativi, dal piu' citato)
  const byWeight = (a, b) => b.pct - a.pct || b.total - a.total || a.name.localeCompare(b.name);
  const groups = new Map();
  for (const it of list.filter(x => x.native)){
    if (!groups.has(it.home)) groups.set(it.home, []);
    groups.get(it.home).push(it);
  }
  for (const g of groups.values()) g.sort(byWeight);
  const queues = [...groups.values()].sort((a, b) => byWeight(a[0], b[0]));
  const out = [];
  for (let i = 0; queues.some(q => i < q.length); i++) for (const q of queues) if (i < q.length) out.push(q[i]);
  return out.concat(list.filter(x => !x.native).sort(byWeight));
}

// Voce nativa di piu' unita': il punto, dentro una di loro, piu' vicino a tutte le altre
// (cade vicino ai confini in comune)
function nearAll(units, U){
  const thin = (a) => a.filter((_, k) => k % Math.max(1, Math.ceil(a.length / 120)) === 0);
  const pts = units.map(u => thin(pointsOfCodes(U.codes(u))));
  let best = null, bestD = Infinity;
  units.forEach((u, i) => {
    for (const p of pts[i]){
      let d = 0;
      units.forEach((v, j) => {
        if (j === i) return;
        let m = Infinity;
        for (const q of pts[j]) m = Math.min(m, angle(p, q));
        d += m;
      });
      if (d < bestD){ bestD = d; best = p; }
    }
  });
  if (!best) return centroid(units.map(U.center), units.map(U.weight));
  // un po' verso l'interno: tra il punto trovato e il centro delle unita'
  return norm(slerp(best, centroid(units.map(U.center), units.map(U.weight)), 0.25));
}

// Est e nord nel punto c (piano tangente)
function tangent(c){
  let e = norm([-c[1], c[0], 0]);
  if (!isFinite(e[0])) e = [1, 0, 0];
  const n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  return [e, n];
}
function bearingTo(c, t){
  const [e, n] = tangent(c);
  return Math.atan2(dot(t, e), dot(t, n));
}
function along(c, bearing, d){
  const [e, n] = tangent(c);
  const dir = [e[0] * Math.sin(bearing) + n[0] * Math.cos(bearing),
               e[1] * Math.sin(bearing) + n[1] * Math.cos(bearing),
               e[2] * Math.sin(bearing) + n[2] * Math.cos(bearing)];
  return norm([c[0] * Math.cos(d) + dir[0] * Math.sin(d), c[1] * Math.cos(d) + dir[1] * Math.sin(d),
               c[2] * Math.cos(d) + dir[2] * Math.sin(d)]);
}
// Punto del confine dell'unita' nella direzione voluta (k = scarto di 25 gradi)
function borderOf(it, k){
  if (it.borders.has(k)) return it.borders.get(k);
  const b = it.bearing + k * 25 * DEG;
  let p = it.center;
  const step = (it.unitCodes.size > 20 ? 1 : 0.4) * DEG;     // continenti: passi piu' lunghi
  for (let d = 0.3 * DEG; d < 80 * DEG; d += step){
    p = along(it.center, b, d);
    if (!inCodes(p, it.unitCodes)) break;
  }
  it.borders.set(k, p);
  return p;
}

// Disegno di un pulsante: fondo nero, bordo e testo colorati (citata = tono scuro);
// acceso = fondo colorato, testo nero
function pillColor(layer){
  return layer === "PEOPLES" ? COLORS.people : layer === "GENRES" ? COLORS.genres : COLORS.instruments;
}
function darker(color, k){
  const [r, g, b] = rgbOf(color);
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}
function roundRectPath(x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function drawPill(text, cx, cy, size, color, lit, alpha){
  ctx.font = `500 ${size.font.toFixed(1)}px ${COLORS.itemFont}`;
  ctx.globalAlpha = alpha;
  roundRectPath(cx - size.w / 2, cy - size.h / 2, size.w, size.h, size.h / 2);
  ctx.fillStyle = lit ? color : COLORS.bg;
  ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();   // acceso: bordo del colore del riempimento
  ctx.fillStyle = lit ? COLORS.bg : color;
  ctx.fillText(text, cx, cy + 0.5);
}
function pillSize(text, pct, shrink){
  const k = (1 + pct / 100) * (shrink || 1);
  const font = ITEM_FONT_PX * k;
  const w = textWidth(text, `500 ${font.toFixed(1)}px ${COLORS.itemFont}`) + 14 * k;
  return { font, w, h: font + 9 * k };
}

const LAYOUT = { items: null, t: 0, placed: [], counters: [] };
const LAYOUT_MS = 350;            // mentre il globo si muove, la disposizione si rifa' al massimo cosi' spesso

// Posizioni da provare per una voce nativa: tutto attorno al suo punto, dalla piu' vicina
// (le voci sono larghe: ci si allarga piu' in orizzontale che in verticale)
const MASK_PX = 8;
// Righe sfalsate (come i mattoni): prima si riempie la riga del punto, poi quelle sopra
// e sotto. Le righe sono alte quanto l'etichetta: ce ne entrano di piu' e in ordine.
const ROWS = new Map();
function rowsFor(h){
  const k = Math.round(h);
  if (ROWS.has(k)) return ROWS.get(k);
  const out = [];
  const step = k + 3;
  for (let r = -14; r <= 14; r++){
    for (let dx = -360; dx <= 360; dx += 5){
      if (!r && !dx) continue;
      out.push([dx, r * step, Math.abs(dx) / 2.2 + Math.abs(r) * step]);
    }
  }
  out.sort((a, b) => a[2] - b[2]);
  const list = out.map(([dx, dy]) => [dx, dy]);
  ROWS.set(k, list);
  return list;
}

const NEAR = (() => {
  const out = [];
  for (let dy = -200; dy <= 200; dy += 7){
    for (let dx = -320; dx <= 320; dx += 12){
      if (dx || dy) out.push([dx, dy, Math.hypot(dx / 1.8, dy)]);
    }
  }
  out.sort((a, b) => a[2] - b[2]);
  return out.map(([dx, dy]) => [dx, dy]);
})();

function drawItems(){
  const items = currentItems();
  const now = performance.now();
  const dt = itemsT ? Math.min(100, now - itemsT) : 0;
  itemsT = now;
  const layer = STATE.layer;
  const color = pillColor(layer);
  const dimColor = darker(color, COLORS.dim);
  const vv = viewVec();
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.08em";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  // la disposizione si rifa' solo se il globo si e' mosso (o sono cambiate le voci);
  // mentre si muove, al massimo ogni LAYOUT_MS
  const moving = !!STATE.anim || STATE.dragging || spinning();
  const view = [VIEW.lam, VIEW.phi, VIEW.R, VIEW.w, VIEW.h, STATE.lit].join();
  const same = LAYOUT.items === items && LAYOUT.view === view;
  const fresh = LAYOUT.items === items && now - LAYOUT.t < LAYOUT_MS;
  if (!same && !(moving && fresh)){ layoutItems(items, vv); LAYOUT.view = view; }

  // disegno (le posizioni sono punti del globo: seguono il globo che si muove)
  let fading = false;
  const seen = new Set();
  const top = UI.bar ? UI.bar.offsetHeight * 0.6 : 0;
  for (const p of LAYOUT.placed){
    if (dot(p.geo, vv) < 0.15) continue;
    const q = projectVec(p.geo);
    const key = p.it.key;
    seen.add(key);
    let al = ITEM_ALPHA.has(key) ? ITEM_ALPHA.get(key) : 0;
    al = Math.min(1, al + (dt || 16) / ITEM_FADE_MS);
    if (al < 1) fading = true;
    ITEM_ALPHA.set(key, al);
    const hov = STATE.hover && STATE.hover.key === key;            // col mouse sopra: un po' piu' grande
    const ps = hov ? { font: p.s.font * HOVER_GROW, w: p.s.w * HOVER_GROW, h: p.s.h * HOVER_GROW } : p.s;
    drawPill(p.text, q.x, q.y, ps, p.it.native ? color : dimColor, STATE.lit === key, al);
    const b = [q.x - p.s.w / 2 - 2, q.y - p.s.h / 2 - 2, q.x + p.s.w / 2 + 2, q.y + p.s.h / 2 + 2];
    const hit = layer === "PEOPLES" ? { kind: "people", key, path: p.it.path }
      : { kind: "item", layer, key, rect: canvasRect(b) };
    if (b[1] >= top) LABEL_HITS.push({ box: b, hit });
  }
  for (const k of [...ITEM_ALPHA.keys()]) if (!seen.has(k)) ITEM_ALPHA.delete(k);
  for (const c of LAYOUT.counters){
    if (dot(c.geo, vv) < 0.15) continue;
    const q = projectVec(c.geo);
    const hov = STATE.hover && STATE.hover.kind === "more" && STATE.hover.id === c.id;
    const cs = hov ? { font: c.s.font * HOVER_GROW, w: c.s.w * HOVER_GROW, h: c.s.h * HOVER_GROW } : c.s;
    drawPill(c.text, q.x, q.y, cs, color, STATE.lit === c.id, 1);
    const b = [q.x - c.s.w / 2 - 2, q.y - c.s.h / 2 - 2, q.x + c.s.w / 2 + 2, q.y + c.s.h / 2 + 2];
    LABEL_HITS.push({ box: b, hit: { kind: "more", layer, id: c.id, keys: c.keys, rect: canvasRect(b) } });
  }
  ctx.globalAlpha = 1;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.font = COLORS.font;
  if (fading) requestDraw(); else itemsT = 0;
}

// Dove va ogni voce (si rifa' da fermo, o al massimo ogni LAYOUT_MS mentre il globo si muove)
function layoutItems(items, vv){
  const top = 0, bottom = 0;
  // i pulsanti agli angoli del globo (<, ×, luogo, +/-) non si coprono mai
  const used = [];
  const cr = UI.canvas.getBoundingClientRect();
  for (const e of [UI.back, UI.toggle, UI.here, UI.zoomCorner]){
    if (!e || e.hidden || !e.offsetParent) continue;
    const r = e.getBoundingClientRect();
    if (r.width) used.push([r.left - cr.left - 4, r.top - cr.top - 4, r.right - cr.left + 4, r.bottom - cr.top + 4]);
  }
  const fits = (b) => b[0] >= 2 && b[2] <= VIEW.w - 2 && b[1] >= top && b[3] <= VIEW.h - bottom &&
    !used.some(u => u[0] < b[2] && u[2] > b[0] && u[1] < b[3] && u[3] > b[1]);
  const boxAt = (x, y, s) => [x - s.w / 2 - 2, y - s.h / 2 - 2, x + s.w / 2 + 2, y + s.h / 2 + 2];
  const geoAt = (x, y) => { const ll = invert(x, y); return ll ? vec(ll[0], ll[1]) : null; };
  const placed = [], hidden = new Map();
  const hide = (it) => { if (!hidden.has(it.home)) hidden.set(it.home, []); hidden.get(it.home).push(it); };
  // dentro / fuori un gruppo di paesi, punto per punto dello schermo (a quadretti, con memoria)
  const masks = new Map();
  const roomHas = (room, x, y) => {
    let m = masks.get(room);
    if (!m){ m = new Map(); masks.set(room, m); }
    const k = Math.round(x / MASK_PX) * 100000 + Math.round(y / MASK_PX);
    if (!m.has(k)){
      const g = geoAt(Math.round(x / MASK_PX) * MASK_PX, Math.round(y / MASK_PX) * MASK_PX);
      m.set(k, !!g && inCodes(g, room));
    }
    return m.get(k);
  };

  for (const it of items){
    if (dot(it.anchor, vv) < 0.15){ continue; }           // dietro il globo
    const text = it.name.toUpperCase();
    // dove puo' stare una nativa: col suo centro dentro la sua unita' (paese, zona,
    // continente); l'etichetta puo' stare a cavallo del confine
    const room = it.native ? it.inside : null;
    let done = null;
    for (const shrink of [1, 0.85]){
      const s = pillSize(text, it.pct, shrink);
      const tries = [];
      const prev = PLACED.get(it.key);
      if (prev && shrink === 1 && dot(prev, vv) > 0.15){ const q = projectVec(prev); tries.push([q.x, q.y, true]); }
      if (it.native){
        // dal punto della patria verso l'esterno, a passi di qualche pixel: il primo
        // posto libero dentro il luogo aperto (popoli: dentro i loro paesi)
        const a = projectVec(it.anchor);
        tries.push([a.x, a.y, true]);
        for (const [dx, dy] of rowsFor(s.h)){
          const x = a.x + dx, y = a.y + dy;
          if (x < s.w / 2 || x > VIEW.w - s.w / 2 || y < s.h / 2 || y > VIEW.h - s.h / 2) continue;
          tries.push([x, y, false]);
        }
      } else {
        const c = projectVec(it.center);
        for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7]){
          const B = borderOf(it, k);
          if (dot(B, vv) < 0.15) continue;
          const p = projectVec(B);
          let dx = p.x - c.x, dy = p.y - c.y;
          const L = Math.hypot(dx, dy);
          if (L < 0.5){ dx = 0; dy = -1; } else { dx /= L; dy /= L; }
          const off = Math.abs(dx) * s.w / 2 + Math.abs(dy) * s.h / 2 + 3;
          tries.push([p.x + dx * off, p.y + dy * off, true]);
          tries.push([p.x + dx * (off + s.h * 1.1), p.y + dy * (off + s.h * 1.1), true]);   // un po' piu' in la'
        }
      }
      for (const [x, y, free] of tries){
        const b = boxAt(x, y, s);
        if (!fits(b)) continue;
        if (!free && room && !roomHas(room, x, y)) continue;
        used.push(b);
        done = { x, y, s, b, text };
        break;
      }
      if (done) break;
    }
    if (!done){ hide(it); continue; }
    placed.push({ it, ...done });
  }

  // contatori "+N": per i nativi sulla loro unita', per i citati vicino al bordo.
  // Se non trovano posto prendono quello della voce meno importante della stessa unita'.
  const counters = [];
  const OFFS = [[0, 0], [0, 1.2], [0, -1.2], [1.2, 0], [-1.2, 0], [1.2, 1.2], [-1.2, -1.2],
                [1.2, -1.2], [-1.2, 1.2], [0, 2.4], [0, -2.4], [2.2, 0], [-2.2, 0]];
  for (const [unit, list] of hidden){
    const first = list[0];
    const cv = unit === "out" ? borderOf(first, 0) : first.homeCenter;
    if (!cv || dot(cv, vv) < 0.15) continue;
    let ok = false;
    while (!ok){
      const text = "+" + list.length, s = pillSize(text, 0);
      const a = projectVec(cv);
      // prima vicinissimo al suo punto, poi un po' piu' in la' (entro ~120 px)
      const spots = OFFS.map(([ox, oy]) => [a.x + ox * s.w, a.y + oy * s.h])
        .concat(NEAR.filter(([dx, dy]) => Math.abs(dx) < 140 && Math.abs(dy) < 90).map(([dx, dy]) => [a.x + dx, a.y + dy]));
      for (const [x, y] of spots){
        const b = boxAt(x, y, s);
        if (!fits(b)) continue;
        used.push(b);
        counters.push({ x, y, s, text, id: "+" + unit, list });
        ok = true;
        break;
      }
      if (ok) break;
      let i = placed.length - 1;
      while (i >= 0 && placed[i].it.home !== unit) i--;
      if (i < 0) break;
      const [gone] = placed.splice(i, 1);
      used.splice(used.indexOf(gone.b), 1);
      PLACED.delete(gone.it.key);
      list.push(gone.it);
    }
  }

  LAYOUT.items = items;
  LAYOUT.t = performance.now();
  LAYOUT.placed = [];
  for (const p of placed){
    const g = geoAt(p.x, p.y);
    if (!g) continue;
    PLACED.set(p.it.key, g);
    LAYOUT.placed.push({ it: p.it, geo: g, s: p.s, text: p.text });
  }
  LAYOUT.counters = [];
  for (const c of counters){
    const g = geoAt(c.x, c.y);
    if (!g) continue;
    const keys = c.list.slice().sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
      .map(it => ({ key: it.key, name: it.name, native: !!it.native }));
    LAYOUT.counters.push({ geo: g, s: c.s, text: c.text, id: c.id, keys });
  }
}

// Riquadro di una voce in coordinate della pagina (per il fumetto di app.js)
function canvasRect(b){
  const r = UI.canvas.getBoundingClientRect();
  return { left: r.left + b[0], top: r.top + b[1], right: r.left + b[2], bottom: r.top + b[3],
           width: b[2] - b[0], height: b[3] - b[1] };
}

function pageOfCode(code){
  return SITE.codePage.get(code) || null;
}


/* =====================================================================
   7. LIVELLI, STATI, ANIMAZIONI, SINCRONIA CON L'INDIRIZZO

   Il globo ha due stati:
     BLOCCATO (di partenza)  gira allo zoom del livello, senza evidenziazioni,
                             con EXPLORE al centro; tocchi e rotellina non lo
                             muovono (la rotellina scorre la pagina).
                             Tiene il segno: ricorda dove sei nel sito.
     ATTIVO                  si ottiene toccando il globo; vola dove sei nel sito;
                             funzionano collegamenti, trascinamento e zoom.
                             Si blocca di nuovo toccando un punto vuoto.

   TARGET  = dove sei nel sito (o cosa ha chiesto "show on map")
   STATE   = cosa disegna il globo in questo momento
   ===================================================================== */
const STATE = {
  open: false,
  frozen: true,
  level: "world",            // world | continent | zone | free
  continent: null,           // cartella
  zone: null,                // cartella
  hlCountries: new Set(),    // paesi evidenziati
  hlPeoples: new Set(),      // popoli evidenziati
  layer: "INFO",             // cosa mostra il globo: INFO (luoghi) | PEOPLES | GENRES | INSTRUMENTS
  only: null,                // INSTRUMENTS: solo queste voci (ramo scelto nel catalogo), null = tutte
  onlySig: "",
  country: null,             // livello paese: il paese inquadrato (codice)
  preview: null,             // telefono, PEOPLES/GENRES/INSTRUMENTS: luogo toccato una volta (nome visibile)
  lit: null,                 // voce accesa (genere col fumetto aperto)
  baseR: 200,                // raggio del globo all'inquadratura del livello
  hover: null,
  anim: null,
  dragging: false,
  visible: true,
};
let TARGET = { level: "world" };

function radiusForCap(cap){
  const base = Math.min(VIEW.w, VIEW.h) / 2 * 0.9;
  const r = Math.min(cap.r * 1.08, 80 * DEG);
  return Math.min(base * 25, Math.max(base, base / Math.sin(r)));
}
function worldR(){ return Math.min(VIEW.w, VIEW.h) / 2 * 0.88; }

// Inquadratura di un continente o di una zona: il RETTANGOLO che la contiene
// riempie il riquadro (in larghezza e in altezza), sotto la barra in alto.
const FRAME_PAD = 14;        // margine in pixel attorno alla zona inquadrata
const FRAME_BOTTOM = 46;     // spazio in basso per il luogo e +/-
function boxFrame(pts, start){
  if (!pts || pts.length < 3) return null;
  let c = start;
  let box = null;
  for (let it = 0; it < 3; it++){
    // piano tangente nel centro: est e nord
    let e = norm([-c[1], c[0], 0]);
    if (!isFinite(e[0])) e = [1, 0, 0];
    const n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts){
      if (dot(p, c) <= 0.05) continue;
      const x = dot(p, e), y = dot(p, n);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x0 > x1) return null;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const z = Math.sqrt(Math.max(0, 1 - mx * mx - my * my));
    box = { e, n, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 };
    c = norm([c[0] * z + e[0] * mx + n[0] * my, c[1] * z + e[1] * mx + n[1] * my, c[2] * z + e[2] * mx + n[2] * my]);
  }
  const top = (UI.bar ? UI.bar.offsetHeight : 50);
  const bottom = FRAME_BOTTOM;                    // in basso: il luogo e +/-
  const w = Math.max(40, VIEW.w - 2 * FRAME_PAD), h = Math.max(40, VIEW.h - top - bottom);
  const base = Math.min(VIEW.w, VIEW.h) / 2 * 0.9;
  let R = Math.min(w / (2 * Math.max(box.hw, 1e-3)), h / (2 * Math.max(box.hh, 1e-3)));
  R = Math.min(base * 120, Math.max(base, R));
  // la zona sta tra la barra in alto e i pulsanti in basso
  const t = Math.max(-0.5, Math.min(0.5, (top - bottom) / 2 / R));
  const e = norm([-c[1], c[0], 0]);
  const n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  const z = Math.sqrt(1 - t * t);
  const v = norm([c[0] * z + n[0] * t, c[1] * z + n[1] * t, c[2] * z + n[2] * t]);
  return { vec: v, R };
}

// Inquadratura di un obiettivo: centro e raggio allo zoom normale
function frameOf(t){
  let cap = t.focus || null;
  if (!cap && t.country && GEO.byCode.has(t.country)){       // livello paese (provvisorio)
    const f = boxFrame(pointsOfCodes([t.country]), GEO.byCode.get(t.country).cap.vec);
    if (f) return f;
  }
  if (!cap && (t.level === "continent" || t.level === "zone")){
    const g = t.level === "zone" ? GEO.zones.get(t.zone.path) : GEO.continents.get(t.continent.path);
    if (g && !g.fixed){
      const f = boxFrame(g.pts, g.cap.vec);
      if (f) return f;
    }
  }
  if (!cap && t.level === "continent"){ const c = GEO.continents.get(t.continent.path); cap = c && c.cap; }
  if (!cap && t.level === "zone"){ const z = GEO.zones.get(t.zone.path); cap = z && z.cap; }
  if (!cap && t.level === "free") cap = t.cap;
  if (!cap) return { vec: vec(VIEW.lam, 12 * DEG), R: worldR() };
  return { vec: cap.vec, R: radiusForCap(cap) };
}

function flyTo(target, animate, ms){
  if (!animate || !STATE.open){
    VIEW.lam = lonOf(target.vec); VIEW.phi = latOf(target.vec); VIEW.R = target.R;
    STATE.anim = null; requestDraw(); tick(); updateControls(); return;
  }
  STATE.anim = { from: { vec: viewVec(), R: VIEW.R }, to: target, t0: performance.now(), ms: ms || FLY_MS };
  tick();
  updateControls();                              // + e - sanno dove arrivera' lo zoom
}

function slerp(a, b, t){
  const th = angle(a, b);
  if (th < 1e-6) return b;
  const s = Math.sin(th), k1 = Math.sin((1 - t) * th) / s, k2 = Math.sin(t * th) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Un solo ciclo di animazione: voli, zoom e rotazione da bloccato
let ticking = false;
function tick(){
  if (ticking) return;
  ticking = true;
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(100, now - last); last = now;
    let more = false;
    if (STATE.anim){
      const a = STATE.anim, t = Math.min(1, (now - a.t0) / a.ms), e = ease(t);
      const v = slerp(a.from.vec, a.to.vec, e);
      VIEW.lam = lonOf(v); VIEW.phi = latOf(v);
      VIEW.R = Math.exp(Math.log(a.from.R) + (Math.log(a.to.R) - Math.log(a.from.R)) * e);
      if (t >= 1) STATE.anim = null;
      more = true;
    } else if (spinning()){
      // stessa velocita' percepita a ogni zoom
      VIEW.lam += SPIN_DEG_S * DEG * (worldR() / VIEW.R) * dt / 1000;
      more = true;
    }
    if (STATE.open && GEO.ready) draw();
    if (more && STATE.open) requestAnimationFrame(step);
    else ticking = false;
  };
  requestAnimationFrame(step);
}
function spinning(){
  return STATE.frozen && STATE.open && GEO.ready && STATE.visible && !document.hidden;
}

// Mostra un obiettivo (con o senza evidenziazioni) e ci vola
function display(t, highlights, animate){
  STATE.level = t.level;
  STATE.continent = t.continent || null;
  STATE.zone = t.zone || null;
  STATE.country = t.country || null;
  STATE.preview = null;
  STATE.hlCountries = new Set(highlights ? t.countries || [] : []);
  STATE.hlPeoples = new Set(highlights ? t.peoples || [] : []);
  STATE.hover = null;
  updateControls();
  if (!GEO.ready) return;
  const f = frameOf(highlights ? t : { ...t, focus: null });
  STATE.baseR = f.R;
  flyTo(f, animate);
}

// Dove sei nel sito (cartella o pagina aperta)
function targetFromAddress(){
  const { node, continent, zone } = placeOf(currentPath());
  if (!node || !continent || !GEO.continents.has(continent.path)) return { level: "world" };
  const countries = [], peoples = [];
  if (node.type === "page"){
    const code = SITE.pageCode.get(node.path);
    if (code) countries.push(code);
    for (const key of (SITE.groups.get(node.path) || [])) peoples.push(key);
  }
  const country = node.type === "page" ? SITE.pageCode.get(node.path) || null : null;
  if (zone && GEO.zones.has(zone.path)) return { level: "zone", continent, zone, countries, peoples, country };
  return { level: "continent", continent };
}

// L'indirizzo e' cambiato: da attivo il globo segue, da bloccato prende nota
function syncFromAddress(animate){
  if (!SITE.root || !GEO.ready) return;
  if (isWelcome() && !STATE.frozen){             // tornati al benvenuto (titolo): il globo riparte a girare
    STATE.frozen = true;
    TARGET = { level: "world" };
    display(TARGET, false, animate);
    updateState();
    return;
  }
  TARGET = targetFromAddress();
  if (STATE.frozen){ updateControls(); return; }
  if (sameLevel(TARGET)) refocus(TARGET, animate);    // stesso livello: lo zoom resta
  else display(TARGET, true, animate);                // livello diverso: inquadratura nuova
}

// Il nuovo obiettivo e' sullo stesso livello di quello mostrato? (es. da Nigeria a Benin)
function sameLevel(t){
  return t.level === STATE.level && (t.zone || null) === STATE.zone &&
         (t.continent || null) === STATE.continent && (t.country || null) === STATE.country && !t.focus;
}

// Stesso livello: cambiano solo le evidenziazioni; se e' zoomato,
// il globo scivola per centrare il paese o i popoli scelti, senza cambiare zoom
function refocus(t, animate){
  STATE.preview = null;
  STATE.hlCountries = new Set(t.countries || []);
  STATE.hlPeoples = new Set(t.peoples || []);
  STATE.hover = null;
  updateControls();
  let center = null;
  const zoomed = targetR() > STATE.baseR * 1.05;      // l'utente aveva zoomato: lo zoom resta
  if (zoomed){
    const c = (t.countries || []).map(code => GEO.byCode.get(code)).find(Boolean);
    if (c) center = c.cap.vec;
    else {
      const ps = (t.peoples || []).map(k => GEO.peoples.get(k)).filter(Boolean);
      if (ps.length){
        const s = [0, 0, 0];
        for (const p of ps){ s[0] += p.vec[0]; s[1] += p.vec[1]; s[2] += p.vec[2]; }
        center = norm(s);
      }
    }
  }
  if (center) flyTo({ vec: center, R: targetR() }, animate, FLY_MS * 0.7);
  else requestDraw();
}

function freeze(){
  STATE.frozen = true;
  TARGET = targetFromAddress();                // torna dove sei nel sito
  display(TARGET, false, true);
  updateState();
}
function unfreeze(){
  STATE.frozen = false;
  display(TARGET, true, true);
  updateState();
}
// EXPLORE: sul benvenuto fa partire la navigazione da WORLD, altrove sblocca e basta
function explore(){
  if (isWelcome() && HOOKS.onStart){
    STATE.frozen = false;
    updateState();
    HOOKS.onStart();                           // app.js va su WORLD: il globo segue
    return;
  }
  unfreeze();
}

function go(path){
  const hash = "#" + encodePath(path);
  if (location.hash === hash) syncFromAddress(true);
  else location.hash = encodePath(path);
}

// Zoom a scatti (3 per livello), sempre con una transizione.
// Con (sx, sy) lo zoom va verso quel punto dello schermo (rotellina, pizzico):
// il punto sotto il mouse resta fermo e il resto si ingrandisce attorno a lui.
// Senza (pulsanti + e -) lo zoom va verso il centro.
// Centro con cui, al raggio toR, il punto p resta nella posizione (sx, sy) dello schermo
function centerKeeping(p, sx, sy, start, fromR, toR){
  const keep = { lam: VIEW.lam, phi: VIEW.phi, R: VIEW.R };
  let c = norm(slerp(start, p, 1 - fromR / toR));       // prima stima
  VIEW.R = toR;
  for (let i = 0; i < 4; i++){                           // correzioni successive
    VIEW.lam = lonOf(c); VIEW.phi = latOf(c); updateTrig();
    const q = invert(sx, sy);
    if (!q) break;
    const qv = vec(q[0], q[1]);
    c = norm([c[0] + p[0] - qv[0], c[1] + p[1] - qv[1], c[2] + p[2] - qv[2]]);
  }
  VIEW.lam = keep.lam; VIEW.phi = keep.phi; VIEW.R = keep.R; updateTrig();
  return c;
}

// Zoom unico, uguale a tutti i livelli: dal mondo intero fino al paese piu' piccolo
// dell'atlante (ZOOM_MAX_EXTRA volte la sua inquadratura). Zoomare non cambia pagina.
function targetR(){ return STATE.anim ? STATE.anim.to.R : VIEW.R; }
function minZoomR(){ return worldR(); }
function maxZoomR(){
  const c = GEO.smallestCode && GEO.byCode.get(GEO.smallestCode);
  const f = c ? boxFrame(pointsOfCodes([c.code]), c.cap.vec) : null;
  const r = f ? f.R : worldR() * 25;
  return Math.max(r * ZOOM_MAX_EXTRA, STATE.baseR * 1.5);
}
function zoomBy(delta, sx, sy, factor){
  if (STATE.frozen || !GEO.ready) return;
  const f = Math.pow(factor || ZOOM_FACTOR, delta);
  const fromR = targetR();
  const toR = Math.max(minZoomR(), Math.min(maxZoomR(), fromR * f));
  if (Math.abs(toR - fromR) / fromR < 0.01) return;
  let center = STATE.anim ? STATE.anim.to.vec : viewVec();
  const ll = sx == null ? null : invert(sx, sy);
  if (ll) center = centerKeeping(vec(ll[0], ll[1]), sx, sy, center, fromR, toR);
  flyTo({ vec: center, R: toR }, true, ZOOM_MS);
  updateControls();
}

// "show on map" dal testo: non cambia la pagina aperta, sblocca il globo
async function show(text){
  const t = lookup(text);
  if (!t) return;
  await openBox(true);
  if (!GEO.ready) return;
  bringIntoView();

  let target = null;
  if (t.kind === "continent") target = { level: "continent", continent: t.node };
  else if (t.kind === "zone"){
    const { continent } = placeOf(t.node.path);
    target = { level: "zone", continent, zone: t.node };
  } else if (t.kind === "people"){
    const p = SITE.peoples.get(t.key), g = GEO.peoples.get(t.key);
    const { continent, zone } = placeOf(p.path);
    const keys = g ? [t.key] : (SITE.groups.get(p.path) || []);
    if (zone && GEO.zones.has(zone.path)){
      const z = GEO.zones.get(zone.path);
      // se l'alone esce dalla zona, allarga l'inquadratura
      let focus = null;
      if (g && angle(g.vec, z.cap.vec) + g.radius > z.cap.r) focus = capOfCodes(new Set([...z.codes, ...g.codes]));
      target = { level: "zone", continent, zone, peoples: keys, focus };
    } else if (g) target = { level: "free", peoples: keys, cap: { vec: g.vec, r: g.radius * 2.5 } };
  } else if (t.kind === "country"){
    const code = t.code || SITE.pageCode.get(t.page.path);
    const c = code && GEO.byCode.get(code);
    if (c){
      const zone = GEO.zoneOfCode.get(code);
      if (zone){
        const { continent } = placeOf(zone.path);
        target = { level: "zone", continent, zone, countries: [code] };
      } else target = { level: "free", countries: [code], cap: c.cap };
    }
  }
  if (!target) return;
  TARGET = target;
  STATE.frozen = false;
  display(TARGET, true, true);
  updateState();
}


/* =====================================================================
   8. MOUSE E DITA
   Bloccato: un tocco qualsiasi sblocca.
   Attivo:   clic su un collegamento = ci va;  clic sul vuoto = blocca;
             trascinare = spostare;  rotellina, pizzico, +/- = zoom.
   ===================================================================== */
function hitTest(sx, sy){
  const ll = invert(sx, sy);
  if (!ll) return null;
  const lv = STATE.level;

  // nomi cliccabili (continenti, zone, paesi): valgono come l'area
  for (let i = LABEL_HITS.length - 1; i >= 0; i--){
    const { box, hit } = LABEL_HITS[i];
    if (sx >= box[0] && sx <= box[2] && sy >= box[1] && sy <= box[3]) return hit;
  }

  const country = countryAt(ll);
  if (!country) return null;
  const code = country.code;
  if (lv === "world"){
    const folder = GEO.continentOfCode.get(code);
    return folder ? { kind: "continent", node: folder } : null;
  }
  const zone = GEO.zoneOfCode.get(code);
  if (lv === "continent"){
    if (zone && SITE.parentOf.get(zone.path) === STATE.continent) return { kind: "zone", node: zone };
    const folder = GEO.continentOfCode.get(code);
    if (folder && folder !== STATE.continent) return { kind: "continent", node: folder };
    return null;
  }
  // zona
  if (zone && zone === STATE.zone){
    const page = pageOfCode(code);
    return page ? { kind: "country", code, page } : null;   // paese senza pagina = vuoto
  }
  if (zone) return { kind: "zone", node: zone };
  return null;
}

function countryAt([lam, phi]){
  const p = vec(lam, phi);
  for (const c of GEO.countries){
    if (angle(p, c.cap.vec) > c.cap.r + 0.01 && c.rings.length === 1) continue;
    let inside = false;
    for (const ring of c.rings){
      if (angle(p, ring.cap.vec) > ring.cap.r + 0.01) continue;
      const pts = ring.pts, n = pts.length / 4;
      for (let i = 0, j = n - 1; i < n; j = i++){
        const xi = pts[i * 4], yi = pts[i * 4 + 1], xj = pts[j * 4], yj = pts[j * 4 + 1];
        if ((yi > phi) !== (yj > phi) && lam < ((xj - xi) * (phi - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return c;
  }
  return null;
}

function onClick(sx, sy, touch){
  if (STATE.frozen) return isWelcome() ? null : unfreeze();   // benvenuto: solo EXPLORE
  const hit = hitTest(sx, sy);
  if (!hit){ STATE.preview = null; return freeze(); }      // punto vuoto
  // telefono, con PEOPLES / GENRES / INSTRUMENTS: primo tocco su un luogo = nome e
  // schiarita; secondo tocco sullo stesso luogo = ci va
  const area = hit.kind === "continent" || hit.kind === "zone" || hit.kind === "country";
  if (touch && area && STATE.layer !== "INFO" &&
      JSON.stringify(hitKey(STATE.preview)) !== JSON.stringify(hitKey(hit))){
    STATE.preview = hit;
    requestDraw();
    return;
  }
  STATE.preview = null;
  if (hit.kind === "continent" || hit.kind === "zone") return go(hit.node.path);
  if (hit.kind === "people") return go(hit.path);
  if (hit.kind === "item") return HOOKS.onItem && HOOKS.onItem(hit.layer, hit.key, hit.rect);
  if (hit.kind === "more") return HOOKS.onMore ? HOOKS.onMore(hit.layer, hit.keys, hit.rect, hit.id) : zoomBy(+1, sx, sy);
  if (hit.kind === "country") return go(hit.page.path);
}

function setupPointer(cv){
  const pointers = new Map();          // dita (o mouse) appoggiati
  let down = null, moved = false, pinch = null;
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };

  cv.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const [x, y] = pos(ev);
    pointers.set(ev.pointerId, [x, y]);
    if (pointers.size === 2 && !STATE.frozen){          // inizia un pizzico
      pinch = { d0: spread() };
      moved = true; STATE.dragging = false;
      return;
    }
    down = { x, y, lam: VIEW.lam, phi: VIEW.phi, id: ev.pointerId };
    moved = false;
  });

  cv.addEventListener("pointermove", (ev) => {
    const [x, y] = pos(ev);
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [x, y]);
    if (pinch && pointers.size === 2){
      const ratio = spread() / pinch.d0;
      const [p1, p2] = [...pointers.values()];
      const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;   // punto fra le due dita
      if (ratio > 1.3){ zoomBy(+1, mx, my); pinch.d0 = spread(); }
      else if (ratio < 0.77){ zoomBy(-1, mx, my); pinch.d0 = spread(); }
      return;
    }
    if (down && ev.pointerId === down.id){
      if (STATE.frozen) return;                         // bloccato: niente trascinamento
      const dx = x - down.x, dy = y - down.y;
      if (!moved && Math.hypot(dx, dy) > 5){
        moved = true; STATE.dragging = true; STATE.anim = null;
        try { cv.setPointerCapture(ev.pointerId); } catch {}
      }
      if (moved){
        VIEW.lam = down.lam - dx / VIEW.R;
        VIEW.phi = Math.max(-80 * DEG, Math.min(80 * DEG, down.phi + dy / VIEW.R));
        requestDraw();
      }
      return;
    }
    if (ev.pointerType === "mouse"){
      if (STATE.frozen){ cv.style.cursor = "pointer"; return; }
      const hit = hitTest(x, y);
      cv.style.cursor = hit ? "pointer" : "grab";
      const same = JSON.stringify(hitKey(hit)) === JSON.stringify(hitKey(STATE.hover));
      if (!same){ STATE.hover = hit; requestDraw(); }
    }
  });

  const end = (ev) => {
    pointers.delete(ev.pointerId);
    if (pinch){ if (pointers.size < 2) pinch = null; down = null; STATE.dragging = false; return; }
    if (!down || ev.pointerId !== down.id) return;
    const [x, y] = pos(ev);
    if (!moved && ev.type === "pointerup") onClick(x, y, ev.pointerType !== "mouse");
    const was = STATE.dragging;
    down = null; STATE.dragging = false;
    if (was) requestDraw();                      // a globo fermo i nomi si rifanno precisi
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", () => { if (!down && STATE.hover){ STATE.hover = null; requestDraw(); } });

  // Rotellina e trackpad (anche il pizzico del trackpad): solo da attivo
  let wheelSum = 0, wheelAt = 0;
  cv.addEventListener("wheel", (ev) => {
    if (STATE.frozen || !STATE.open) return;          // bloccato: scorre la pagina
    ev.preventDefault();
    const now = performance.now();
    if (now - wheelAt > 300) wheelSum = 0;
    wheelSum += ev.deltaY * (ev.deltaMode === 1 ? 30 : 1);
    if (Math.abs(wheelSum) > 40 && now - wheelAt > ZOOM_MS * 0.35){
      const r = cv.getBoundingClientRect();
      zoomBy(wheelSum < 0 ? +1 : -1, ev.clientX - r.left, ev.clientY - r.top, WHEEL_FACTOR);
      wheelSum = 0; wheelAt = now;
    }
  }, { passive: false });
}
function hitKey(h){ return h ? [h.kind, h.node && h.node.path, h.code, h.key, h.id] : null; }


/* =====================================================================
   9. RIQUADRO E AVVIO
   In index.html il riquadro contiene gia' la barra con il percorso:
     <div id="mapBox"> <div class="mapBar"> <div class="mapBarLeft">
       <div id="crumbs"> ... </div> </div> <div id="mapControls"></div> </div> </div>
   Qui si aggiungono: livello precedente, MAP, +/-, globo, EXPLORE.
   ===================================================================== */
let LABEL = { ...DEFAULT_LABELS };
let loading = null;

function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(cls, text, onClick){
  const b = el("button", "btn " + cls, text);
  b.type = "button";
  b.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(); });
  return b;
}

function buildBox(){
  const box = document.getElementById("mapBox");
  if (!box) return false;
  box.classList.add("mapBox");
  UI.box = box;

  // barra (se index.html non la ha, la crea)
  UI.bar = box.querySelector(".mapBar");
  if (!UI.bar){ UI.bar = el("div", "mapBar"); box.prepend(UI.bar); }
  UI.left = UI.bar.querySelector(".mapBarLeft");
  if (!UI.left){ UI.left = el("div", "mapBarLeft"); UI.bar.prepend(UI.left); }
  UI.controls = UI.bar.querySelector("#mapControls");
  if (!UI.controls){ UI.controls = el("div", "mapControls"); UI.controls.id = "mapControls"; UI.bar.append(UI.controls); }

  // globo aperto: freccia in alto a sinistra (nera, si accende solo mentre la premi);
  // il luogo in basso a sinistra (bianco; nero col globo fermo). Clic sul luogo:
  // torna allo stato iniziale del luogo (app.js); col globo fermo lo sblocca.
  UI.level = el("div", "mapLevel");
  UI.back = button("mapBack mapZoom", "<", () => {
    flash(UI.back);
    const up = upLevel();
    if (STATE.frozen){ STATE.frozen = false; updateState(); }
    if (up) go(up.path);
  });
  UI.here = button("mapHere", "", () => {
    if (STATE.frozen) return unfreeze();
    if (HOOKS.onHere) HOOKS.onHere();
  });
  UI.level.append(UI.back);
  UI.left.prepend(UI.level);

  UI.toggle = button("mapToggle", LABEL.map, () => (STATE.open ? closeBox() : openBox(false, true)));
  UI.toggle.setAttribute("aria-expanded", "false");
  UI.zoomIn = button("mapZoom", "+", () => zoomBy(+1));
  UI.zoomOut = button("mapZoom", "−", () => zoomBy(-1));
  UI.zoomIn.setAttribute("aria-label", "Zoom in");
  UI.zoomOut.setAttribute("aria-label", "Zoom out");
  const zoom = el("div", "mapZoomBox");
  zoom.append(UI.zoomIn, UI.zoomOut);
  UI.controls.append(UI.toggle);

  UI.stage = el("div", "mapStage");
  UI.canvas = el("canvas", "mapCanvas");
  UI.canvas.setAttribute("aria-label", "Interactive globe");
  UI.explore = button("mapExplore", LABEL.explore, () => explore());
  UI.msg = el("div", "mapMsg", "");
  UI.corner = el("div", "mapCorner");          // in basso a sinistra: il luogo
  UI.corner.append(UI.here);
  UI.zoomCorner = el("div", "mapZoomCorner");  // in basso a destra: + e -
  UI.zoomCorner.append(zoom);
  UI.stage.append(UI.canvas, UI.explore, UI.msg, UI.corner, UI.zoomCorner);
  box.append(UI.stage);
  box.classList.add("ready", "frozen");

  ctx = UI.canvas.getContext("2d");
  setupPointer(UI.canvas);
  UI.stage.addEventListener("click", (ev) => ev.stopPropagation());

  // altezza della barra: e' l'altezza del riquadro chiuso
  const barSize = () => box.style.setProperty("--bar-h", UI.bar.offsetHeight + "px");
  new ResizeObserver(barSize).observe(UI.bar);
  barSize();
  new ResizeObserver(resize).observe(UI.canvas);
  if ("IntersectionObserver" in window){
    new IntersectionObserver((entries) => {
      STATE.visible = entries[0].isIntersecting;
      if (STATE.visible) tick();
    }).observe(UI.stage);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  updateState();
  return true;
}

// Dove sei, come dice il percorso del sito: la pagina o la cartella aperta
// (le pagine dentro PEOPLES valgono come la cartella che le contiene)
function hereNode(){
  const node = SITE.byPath.get(currentPath());
  if (!node) return SITE.root;
  const chain = chainOf(node);
  const sp = chain.findIndex(isSpecial);
  return sp > 0 ? chain[sp - 1] : node;
}

// Livello sopra quello in cui sei (stesso percorso del sito, non i livelli del globo)
function upLevel(){
  if (!SITE.root) return null;
  const here = hereNode();
  return here ? SITE.parentOf.get(here.path) || null : null;
}

// La freccia si accende per un attimo quando la premi (anche col dito)
function flash(b){
  b.classList.add("flash");
  clearTimeout(b._flash);
  b._flash = setTimeout(() => b.classList.remove("flash"), 160);
}

// Pulsanti: livello precedente, livello attuale e zoom
function updateControls(){
  if (!UI.back) return;
  const up = upLevel();
  const here = hereNode();
  UI.back.hidden = !up;
  if (up){
    UI.back.title = up.title;                          // col mouse sopra: dove porta
    UI.back.setAttribute("aria-label", "Back to " + up.title);
  }
  UI.box.classList.toggle("welcome", isWelcome());
  UI.here.hidden = !here || isWelcome();
  if (isWelcome()) UI.back.hidden = true;           // benvenuto: solo EXPLORE e ×
  if (here) UI.here.textContent = here.type === "page" ? here.title : here.name;
  UI.here.classList.remove("sel");                  // sul globo il luogo e' nero, come gli altri pulsanti
  const r = targetR();
  UI.zoomIn.disabled = r >= maxZoomR() * 0.99;
  UI.zoomOut.disabled = r <= minZoomR() * 1.01;
}

// Classi del riquadro: aperto/chiuso, bloccato/attivo (lo stile e' in atlas-map.css)
function updateState(){
  if (!UI.box) return;
  UI.box.classList.toggle("open", STATE.open);
  UI.box.classList.toggle("frozen", STATE.frozen);
  UI.box.classList.toggle("loaded", GEO.ready);
  document.body.classList.toggle("mapOpen", STATE.open && !UI.box.classList.contains("broken"));
  // aperto: X tonda nera per chiudere;  chiuso: MAP spento (bianco su nero)
  UI.toggle.textContent = STATE.open ? "×" : LABEL.map;   // × nera, "spenta", come gli altri
  UI.toggle.classList.toggle("mapZoom", STATE.open);
  UI.toggle.setAttribute("aria-label", STATE.open ? "Close map" : "Open map");
  UI.toggle.setAttribute("aria-expanded", String(STATE.open));
  UI.explore.tabIndex = STATE.open && STATE.frozen ? 0 : -1;
  try { sessionStorage.setItem(FROZEN_KEY, STATE.frozen ? "1" : "0"); } catch {}
  updateControls();
}

function resize(){
  const r = UI.canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const oldMin = Math.min(VIEW.w, VIEW.h);
  VIEW.w = r.width; VIEW.h = r.height; VIEW.cx = r.width / 2; VIEW.cy = r.height / 2;
  VIEW.dpr = Math.min(2, window.devicePixelRatio || 1);
  UI.canvas.width = Math.round(r.width * VIEW.dpr);
  UI.canvas.height = Math.round(r.height * VIEW.dpr);
  const k = Math.min(VIEW.w, VIEW.h) / (oldMin || 1);
  VIEW.R *= k; STATE.baseR *= k;
  readColors();
  makeStars();
  requestDraw();
}

// Durata delle transizioni in millisecondi (da --ui-time in styles.css)
function transitionMs(){
  const v = getComputedStyle(document.documentElement).getPropertyValue("--ui-time").trim();
  const n = parseFloat(v) || 0;
  return v.endsWith("ms") ? n : n * 1000;
}

// Porta il riquadro in vista, se non lo e' gia' tutto
function bringIntoView(){
  const r = UI.box.getBoundingClientRect();
  const h = UI.canvas.getBoundingClientRect().height;
  if (r.top >= 0 && r.top + h <= window.innerHeight) return;
  window.scrollTo({ top: window.scrollY + r.top - 12, behavior: "smooth" });
}

async function loadGeo(){
  if (loading) return loading;
  loading = (async () => {
    const [world, cfg] = await Promise.all([
      fetch(WORLD_FILE).then(r => { if (!r.ok) throw new Error(WORLD_FILE); return r.json(); }),
      fetch(CONFIG_FILE, { cache: "no-cache" }).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    GEO.cfg = cfg || {};
    LABEL = { ...DEFAULT_LABELS, ...(GEO.cfg.labels || {}) };
    if (!STATE.open) UI.toggle.textContent = LABEL.map;   // aperta resta la X
    UI.explore.textContent = LABEL.explore;
    // i calcoli pesanti partono dopo l'apertura del riquadro, cosi' la transizione resta fluida
    await new Promise(r => setTimeout(r, transitionMs() + 50));
    decodeWorld(world);
    buildStatic();
    await indexReady;
    buildGeoFromSite();
    GEO.ready = true;
  })();
  return loading;
}

// fromText: aperta da "show on map";  byUser: aperta col pulsante MAP
async function openBox(fromText, byUser){
  if (STATE.open){ await loading; return; }
  STATE.open = true;
  if (byUser && !isWelcome()) STATE.frozen = false;   // premendo MAP il globo si apre gia' attivo (non sul benvenuto)
  try { localStorage.setItem(STORE_KEY, "1"); } catch {}
  UI.box.classList.remove("broken");
  updateState();
  if (byUser) bringIntoView();
  UI.msg.textContent = GEO.ready ? "" : LABEL.loading;
  try {
    await loadGeo();
  } catch {
    UI.msg.textContent = LABEL.error;
    UI.box.classList.add("broken");             // mappa rotta: i pulsanti tornano
    document.body.classList.remove("mapOpen");
    loading = null;
    return;
  }
  UI.msg.textContent = "";
  resize();
  if (!STATE.open) return;                      // richiusa mentre caricava
  updateState();
  if (!fromText){                               // dal testo ci pensa show()
    TARGET = targetFromAddress();
    display(TARGET, !STATE.frozen, false);      // attivo: con le evidenziazioni
  }
  tick();
}

function closeBox(){
  STATE.open = false;
  STATE.anim = null;
  try { localStorage.setItem(STORE_KEY, "0"); } catch {}
  updateState();
}

function boot(){
  try { STATE.frozen = sessionStorage.getItem(FROZEN_KEY) !== "0"; } catch {}
  if (isWelcome()) STATE.frozen = true;          // apertura del sito: gira, si parte da EXPLORE
  if (!buildBox()) return;
  window.addEventListener("hashchange", () => syncFromAddress(STATE.open));
  let wantOpen = false;
  try { wantOpen = localStorage.getItem(STORE_KEY) === "1"; } catch {}
  if (wantOpen) openBox(false, false);
}

window.AtlasMap = {
  setIndex,
  // PEOPLES / GENRES / INSTRUMENTS / INFO: quale livello mostra il globo
  setLayer(name){
    const n = String(name || "INFO").toUpperCase();
    if (n === STATE.layer) return;
    STATE.layer = n; STATE.lit = null; STATE.hover = null;
    ITEMS.sig = null; PLACED.clear(); ITEM_ALPHA.clear(); LAYOUT.items = null;
    requestDraw();
  },
  // clic su una voce del globo: app.js decide cosa fare (fumetto, scheda)
  set onItem(fn){ HOOKS.onItem = fn; },
  set onMore(fn){ HOOKS.onMore = fn; },        // clic su "+N": fumetto con le voci mancanti
  set onHere(fn){ HOOKS.onHere = fn; },        // clic sul luogo: stato iniziale del luogo
  set onStart(fn){ HOOKS.onStart = fn; },      // EXPLORE sul benvenuto
  // voce accesa mentre il suo fumetto e' aperto (null = nessuna)
  setLit(key){ STATE.lit = key || null; requestDraw(); },
  // INSTRUMENTS: il ramo scelto nel catalogo vale anche sul globo (null = tutti)
  setOnly(keys){
    STATE.only = keys ? new Set(keys) : null;
    STATE.onlySig = keys ? [...STATE.only].sort().join() : "";
    PLACED.clear(); LAYOUT.items = null;
    requestDraw();
  },
  knows: (text) => !!lookup(text),
  represents: (node) => !!node && SITE.onMap.has(node.path),
  show: (text) => { show(text); },
  get label(){ return LABEL.showOnMap; },
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

})();