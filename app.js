/* =====================================================================
   MUSICAL ATLAS - app.js

   Sezioni:
     1. IMPOSTAZIONI
     2. REGOLE DI FORMATTAZIONE   <- qui si aggiungono le regole nuove
     3. Strumenti per le regole
     4. Indice del sito (atlas-index.json)
     5. Indirizzi e navigazione
     6. Disegno di percorso, pulsanti, INSTRUMENTS / PEOPLES
     7. Apertura di una pagina
     8. Menu a comparsa (al clic su una parola)
     9. Ricerca
    10. Avvio
   ===================================================================== */
(() => {
"use strict";


/* =====================================================================
   1. IMPOSTAZIONI
   ===================================================================== */
const INDEX_FILE = "atlas-index.json";      // creato da build_index.py
const SITE_TITLE = "Musical Atlas";         // titolo della scheda del browser
const WELCOME_TEXT = `Welcome!
Click WORLD to explore the Atlas
or search from the bar above.`;

// Cartelle mostrate come interruttori a destra, non come pulsanti normali
const SPECIAL_FOLDERS = ["INSTRUMENTS", "PEOPLES"];


/* =====================================================================
   2. REGOLE DI FORMATTAZIONE

   Ogni regola ha due parti:

   formato: come deve essere scritto il testo. Per ogni voce:
              true  = deve esserci
              false = non deve esserci
              (voce assente) = indifferente
            colore: "nessuno", oppure il colore del <mark>
                    (yellow, cyan, green, red, magenta, blue, white)
            maiuscolo: true = tutto MAIUSCOLO (almeno 2 lettere)

   azioni:  cosa compare nel menu al clic. Riceve il testo e restituisce
            un elenco di voci. Voci disponibili:
              vaiA(etichetta, percorso)   -> "go to ..."
              cercaSulWeb(testo)          -> "search the web"
            Elenco vuoto [] = il testo resta normale, non cliccabile.

   Il formato confronta un "tratto": un pezzo di testo continuo con
   la stessa formattazione. Vale la prima regola che corrisponde.
   Per aggiungere una regola: copia un blocco { ... }, incollalo
   prima di "];" e modificalo.
   ===================================================================== */
const REGOLE = [

  // 1. Grassetto (non maiuscolo) -> vai alla pagina o cartella con quel nome
  {
    formato: { grassetto: true, corsivo: false, sottolineato: false, maiuscolo: false, colore: "nessuno" },
    azioni: (testo) => {
      const dest = trovaPaginaOCartella(testo);
      return dest ? [ vaiA(dest.title, dest.path) ] : [];
    }
  },

  // 2. Grassetto + sottolineato (non maiuscolo) -> cerca sul web
  {
    formato: { grassetto: true, corsivo: false, sottolineato: true, maiuscolo: false, colore: "nessuno" },
    azioni: (testo) => [ cercaSulWeb(testo) ]
  },

  // 3. Grassetto + corsivo + MAIUSCOLO + verde -> e' una DEFINIZIONE: cerca sul web
  {
    formato: { grassetto: true, corsivo: true, sottolineato: false, maiuscolo: true, colore: "green" },
    azioni: (testo) => [ cercaSulWeb(testo) ]
  },

  // 4. Grassetto + corsivo + MAIUSCOLO senza colore -> vai alla definizione + cerca sul web
  {
    formato: { grassetto: true, corsivo: true, sottolineato: false, maiuscolo: true, colore: "nessuno" },
    azioni: (testo) => {
      const def = trovaDefinizione(testo);
      return def ? [ vaiA(def.term, def.path), cercaSulWeb(testo) ] : [ cercaSulWeb(testo) ];
    }
  },

];


/* =====================================================================
   3. STRUMENTI PER LE REGOLE
   ===================================================================== */

// Voce di menu "go to ..."
function vaiA(etichetta, percorso){
  return { etichetta: "go to " + etichetta, fai: () => go(percorso) };
}

// Voce di menu "search the web" (cerca il testo + il titolo della pagina aperta)
function cercaSulWeb(testo){
  return {
    etichetta: "search the web",
    fai: () => {
      const q = `${testo} ${APP.docTitle}`.trim();
      window.open("https://www.google.com/search?q=" + encodeURIComponent(q), "_blank", "noopener");
    }
  };
}

// Pagina o cartella con lo stesso nome del testo (null se non c'e')
function trovaPaginaOCartella(testo){
  const key = normalizeKey(testo.replace(/^[\s"'(\[‘“]+|[\s"'.,;:!?)\]’”]+$/g, ""));
  return APP.byName.get(key) || null;
}

// Definizione di un termine, da atlas-index.json (null se non c'e')
function trovaDefinizione(testo){
  return (APP.index.definitions || {})[normalizeKey(testo)] || null;
}

// Chiave per confrontare i nomi (identica a quella di build_index.py)
function normalizeKey(s){
  return String(s || "").trim().normalize("NFC")
    .replace(/[‘’‚‛´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .toLowerCase();
}

// Vero se ci sono almeno 2 lettere e sono tutte MAIUSCOLE
function isAllCaps(text){
  const letters = [...text].filter(c => c.toLowerCase() !== c.toUpperCase());
  return letters.length >= 2 && letters.every(c => c === c.toUpperCase());
}

// Il formato di un tratto corrisponde a quello richiesto dalla regola?
function formatoCorrisponde(richiesto, tratto){
  const reale = {
    grassetto: tratto.b, corsivo: tratto.i, sottolineato: tratto.u,
    maiuscolo: isAllCaps(tratto.testo),
    colore: tratto.colore || "nessuno",
  };
  return Object.keys(richiesto).every(k => richiesto[k] === reale[k]);
}

// Formato di un pezzo di testo, guardando i tag che lo contengono
function formatoDi(textNode, root){
  const f = { b: false, i: false, u: false, colore: "" };
  for (let el = textNode.parentElement; el && el !== root; el = el.parentElement){
    const tag = el.tagName;
    if (tag === "B" || tag === "STRONG") f.b = true;
    else if (tag === "I" || tag === "EM") f.i = true;
    else if (tag === "U") f.u = true;
    else if (tag === "MARK" && !f.colore) f.colore = (el.className || "").trim();
  }
  return f;
}

// Divide la pagina in tratti di testo con la stessa formattazione
function trovaTratti(root){
  const tratti = [];
  let corrente = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()){
    const n = walker.currentNode;
    if (n.nodeType === 1){
      if (n.tagName === "P" || n.tagName === "BR") corrente = null;   // nuovo paragrafo / a capo
      continue;
    }
    const f = formatoDi(n, root);
    const chiave = `${f.b}|${f.i}|${f.u}|${f.colore}`;
    if (corrente && corrente.chiave === chiave){
      corrente.nodi.push(n);
      corrente.testo += n.nodeValue;
    } else {
      corrente = { chiave, ...f, nodi: [n], testo: n.nodeValue };
      tratti.push(corrente);
    }
  }
  for (const t of tratti) t.testo = t.testo.trim();
  return tratti.filter(t => t.testo);
}

// Applica le regole alla pagina appena aperta
function applicaRegole(root){
  for (const tratto of trovaTratti(root)){
    const regola = REGOLE.find(r => formatoCorrisponde(r.formato, tratto));
    if (!regola) continue;
    const azioni = regola.azioni(tratto.testo);
    if (!azioni.length) continue;
    for (const n of tratto.nodi){
      const span = document.createElement("span");
      span.className = "atlasLink";
      n.parentNode.replaceChild(span, n);
      span.appendChild(n);
      span.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        mostraMenu(span, azioni);
      });
    }
  }
}


/* =====================================================================
   4. INDICE DEL SITO
   ===================================================================== */
const $ = (sel) => document.querySelector(sel);
const el = {
  title:     $("#headerTitle"),
  search:    $("#searchInput"),
  results:   $("#resultsRow"),
  crumbs:    $("#crumbs"),
  toggles:   $("#specialToggles"),
  choices:   $("#choicesRow"),
  special:   $("#specialButtonsRow"),
  doc:       $("#docContent"),
  popup:     $("#hoverCard"),
};

const APP = {
  index: null,            // contenuto di atlas-index.json
  root: null,             // cartella principale (WORLD)
  byPath: new Map(),      // percorso -> cartella o pagina
  parentOf: new Map(),    // percorso -> cartella che lo contiene
  byName: new Map(),      // nome normalizzato -> cartella o pagina (regola 1)
  openSpecial: null,      // interruttore acceso (cartella INSTRUMENTS / PEOPLES) o null
  view: null,             // cosa si sta mostrando
  renderedPath: null,     // ultimo indirizzo disegnato
  docTitle: "",           // titolo della pagina aperta
  loadToken: 0,           // evita che una pagina lenta sovrascriva quella nuova
  query: "",              // ricerca in corso
  searchMap: new Map(),
  hits: [],
  hitsOffset: 0,
};

const stem = (name) => String(name).replace(/\.[^.]+$/, "");
const isSpecial = (node) => node && node.type === "folder" && SPECIAL_FOLDERS.includes(node.name.toUpperCase());
const subfolders = (folder) => folder.children.filter(c => c.type === "folder");

// Pagina di presentazione: la pagina con lo stesso nome della cartella
function presentationOf(folder){
  if (!folder) return null;
  const want = folder.name.toLowerCase();
  return folder.children.find(c => c.type === "page" && stem(c.name).toLowerCase() === want) || null;
}

// Pagine di una cartella, esclusa quella di presentazione
function extraPages(folder){
  const pres = presentationOf(folder);
  return folder.children.filter(c => c.type === "page" && c !== pres);
}

async function loadIndex(){
  const res = await fetch("./" + INDEX_FILE, { cache: "no-cache" });
  if (!res.ok) throw new Error(INDEX_FILE + " not found");
  APP.index = await res.json();
  APP.root = APP.index.tree;

  (function walk(node, parent){
    APP.byPath.set(node.path, node);
    if (parent) APP.parentOf.set(node.path, parent);
    if (node.type === "folder"){
      for (const ch of node.children) walk(ch, node);
    }
  })(APP.root, null);

  // Nomi per la regola 1: cartelle, poi pagine (non quelle di presentazione)
  for (const node of APP.byPath.values()){
    if (node.type === "folder") APP.byName.set(normalizeKey(node.title), node);
  }
  for (const node of APP.byPath.values()){
    if (node.type !== "page") continue;
    if (presentationOf(APP.parentOf.get(node.path)) === node) continue;
    const key = normalizeKey(node.title);
    if (!APP.byName.has(key)) APP.byName.set(key, node);
  }

  buildSearchMap();
}


/* =====================================================================
   5. INDIRIZZI E NAVIGAZIONE
   L'indirizzo dopo # e' il percorso del file o della cartella,
   es.  #WORLD/AFRICA/WEST AFRICA/BENIN.HTML
   ===================================================================== */
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

function currentPath(){
  try { return decodeURIComponent(location.hash.slice(1)); }
  catch { return ""; }
}

// Va a un percorso (cartella o pagina). Percorso vuoto = benvenuto.
function go(path){
  hidePopup();
  if (path === currentPath()) { render(); return; }
  if (path) location.hash = encodePath(path);
  else { history.pushState(null, "", location.pathname + location.search); render(); }
}

// Catena di cartelle dalla principale fino a "node" compreso
function chainOf(node){
  const chain = [];
  for (let n = node; n; n = APP.parentOf.get(n.path)) chain.unshift(n);
  return chain;
}

// Calcola cosa mostrare per un percorso
function computeView(path){
  const node = APP.byPath.get(path);
  if (!node) return null;
  const chain = chainOf(node);
  const special = chain.find(isSpecial);

  if (special){
    // Dentro INSTRUMENTS / PEOPLES: il percorso resta sulla cartella sopra
    const context = APP.parentOf.get(special.path);
    const selected = node === special ? null : chain[chain.indexOf(special) + 1];
    const docPath = node.type === "page" ? node.path
      : (presentationOf(node) || presentationOf(context) || {}).path || null;
    return { context, special, selected: selected ? selected.path : null, docPath };
  }
  if (node.type === "page"){
    return { context: APP.parentOf.get(node.path), special: null, selected: null, docPath: node.path };
  }
  return { context: node, special: null, selected: null, docPath: (presentationOf(node) || {}).path || null };
}

// Disegna tutto in base all'indirizzo attuale
function render(){
  hidePopup();
  el.results.innerHTML = "";
  const path = currentPath();
  APP.renderedPath = path;
  const view = path ? computeView(path) : null;
  APP.view = view;
  APP.openSpecial = view ? view.special : null;

  renderCrumbs();
  renderChoices();
  renderToggles();
  renderSpecialRow();

  if (view && view.docPath){
    openDoc(view.docPath);
  } else {
    showMessage(WELCOME_TEXT);
  }
  document.title = APP.docTitle && view ? `${SITE_TITLE} - ${APP.docTitle}` : SITE_TITLE;
  window.scrollTo(0, 0);
}


/* =====================================================================
   6. PERCORSO, PULSANTI, INSTRUMENTS / PEOPLES
   ===================================================================== */
function makeButton(label, onClick, classes){
  const b = document.createElement("button");
  b.className = "btn" + (classes ? " " + classes : "");
  b.textContent = String(label).toUpperCase();
  b.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(); });
  return b;
}

function setRow(row, buttons){
  row.innerHTML = "";
  for (const b of buttons) row.appendChild(b);
  row.classList.toggle("collapsed", buttons.length === 0);
}

// Percorso in alto: WORLD > AFRICA > WEST AFRICA
function renderCrumbs(){
  if (!APP.view){
    // benvenuto: solo WORLD, non selezionato
    setRow(el.crumbs, [ makeButton(APP.root.name, () => go(APP.root.path)) ]);
    return;
  }
  setRow(el.crumbs, chainOf(APP.view.context).map(f => makeButton(f.name, () => go(f.path), "sel")));
}

// Pulsanti della cartella: sottocartelle (tranne INSTRUMENTS/PEOPLES) e pagine
function renderChoices(){
  if (!APP.view) { setRow(el.choices, []); return; }
  const folder = APP.view.context;
  const buttons = [];
  for (const f of subfolders(folder)){
    if (isSpecial(f)) continue;
    buttons.push(makeButton(f.name, () => go(f.path)));
  }
  for (const p of extraPages(folder)){
    buttons.push(makeButton(p.title, () => go(p.path), APP.view.docPath === p.path ? "sel" : ""));
  }
  setRow(el.choices, buttons);
}

// Interruttori a destra (INSTRUMENTS / PEOPLES), uno alternativo all'altro
function renderToggles(){
  if (!APP.view) { setRow(el.toggles, []); return; }
  const buttons = subfolders(APP.view.context).filter(isSpecial).map(f => {
    const on = APP.openSpecial === f;
    return makeButton(f.name, () => {
      hidePopup();
      APP.openSpecial = on ? null : f;
      renderToggles();
      renderSpecialRow();
    }, toggleClass(f) + (on ? " sel" : ""));
  });
  setRow(el.toggles, buttons);
}

function toggleClass(folder){
  return "toggle-" + folder.name.toLowerCase();
}

// Riga sotto: contenuto dell'interruttore acceso
function renderSpecialRow(){
  const sp = APP.openSpecial;
  if (!sp) { setRow(el.special, []); return; }
  const buttons = [];
  for (const f of subfolders(sp)){
    const sel = APP.view.selected === f.path;
    buttons.push(makeButton(f.name, () => go(f.path), toggleClass(sp) + (sel ? " sel" : "")));
  }
  for (const p of extraPages(sp)){
    const sel = APP.view.docPath === p.path;
    buttons.push(makeButton(p.title, () => go(p.path), toggleClass(sp) + (sel ? " sel" : "")));
  }
  setRow(el.special, buttons);
}


/* =====================================================================
   7. APERTURA DI UNA PAGINA
   ===================================================================== */
function showMessage(text){
  APP.docTitle = "";
  el.doc.innerHTML = "";
  const div = document.createElement("div");
  div.className = "welcomeMsg";
  div.textContent = text;
  el.doc.appendChild(div);
}

async function openDoc(path){
  const token = ++APP.loadToken;
  const node = APP.byPath.get(path);
  APP.docTitle = node ? node.title : "";
  el.doc.innerHTML = "";
  try {
    const res = await fetch("./" + encodePath(path), { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const html = await res.text();
    if (token !== APP.loadToken) return;          // nel frattempo e' stata aperta un'altra pagina
    el.doc.innerHTML = html;
    applicaRegole(el.doc);
    highlightQuery(el.doc, APP.query);
  } catch {
    if (token === APP.loadToken) showMessage("Could not open document.");
  }
}


/* =====================================================================
   8. MENU A COMPARSA
   ===================================================================== */
function hidePopup(){
  el.popup.style.display = "none";
  el.popup.innerHTML = "";
}

function mostraMenu(anchor, azioni){
  el.popup.innerHTML = "";
  for (const a of azioni){
    const item = document.createElement("div");
    item.className = "hoverAction";
    item.textContent = a.etichetta;
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      hidePopup();
      a.fai();
    });
    el.popup.appendChild(item);
  }
  el.popup.style.display = "block";

  // posizione: sopra la parola, dentro lo schermo
  const r = anchor.getBoundingClientRect();
  const c = el.popup.getBoundingClientRect();
  const pad = 10;
  let x = r.left + r.width / 2 - c.width / 2;
  let y = r.top - c.height - 14;
  x = Math.max(pad, Math.min(x, window.innerWidth - c.width - pad));
  y = Math.max(pad, y);
  el.popup.style.left = x + "px";
  el.popup.style.top = y + "px";
}


/* =====================================================================
   9. RICERCA (funzionamento come nella versione precedente)
   ===================================================================== */
const RESULTS_PER_PAGE = 5;
const MAX_RESULTS = 50;

function buildSearchMap(){
  APP.searchMap.clear();
  (APP.index.search || []).forEach((it, idx) => {
    const words = (it.title + " " + it.text).toLowerCase().split(/\s+/).filter(w => w.length > 2);
    for (const w of new Set(words)){
      if (!APP.searchMap.has(w)) APP.searchMap.set(w, new Set());
      APP.searchMap.get(w).add(idx);
    }
  });
}

function doSearch(q){
  const query = String(q || "").trim().toLowerCase();
  APP.query = query;
  APP.hits = [];
  APP.hitsOffset = 0;
  const words = query.split(/\s+/).filter(w => w.length > 2);
  if (!words.length) { el.results.innerHTML = ""; return; }

  let found = null;
  for (const w of words){
    const set = APP.searchMap.get(w) || new Set();
    found = found ? new Set([...found].filter(i => set.has(i))) : new Set(set);
    if (!found.size) break;
  }
  APP.hits = [...found].map(i => APP.index.search[i]).slice(0, MAX_RESULTS);
  renderResults();
}

function renderResults(){
  el.results.innerHTML = "";
  for (const it of APP.hits.slice(APP.hitsOffset, APP.hitsOffset + RESULTS_PER_PAGE)){
    const item = document.createElement("div");
    item.className = "resultItem";
    const line = document.createElement("div");
    line.className = "pathContainer";

    const parts = it.path.split("/");
    // si salta la cartella principale (WORLD); l'ultimo pezzo e' la pagina
    for (let i = 1; i < parts.length; i++){
      if (i > 1){
        const arrow = document.createElement("span");
        arrow.className = "pathArrow";
        arrow.textContent = ">";
        line.appendChild(arrow);
      }
      const isDoc = i === parts.length - 1;
      const target = parts.slice(0, i + 1).join("/");
      const b = makeButton(isDoc ? stem(parts[i]) : parts[i], () => {
        el.search.blur();
        go(target);
      }, "pathBtn" + (isDoc ? " docBtn" : ""));
      line.appendChild(b);
    }
    item.appendChild(line);
    el.results.appendChild(item);
  }
  if (APP.hitsOffset + RESULTS_PER_PAGE < APP.hits.length){
    el.results.appendChild(makeButton("Load more results", () => {
      APP.hitsOffset += RESULTS_PER_PAGE;
      renderResults();
    }, "loadMoreBtn"));
  }
}

// Evidenzia nella pagina il testo cercato
function highlightQuery(root, query){
  if (!query) return;
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes){
    const text = n.nodeValue;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(re, (m, pos) => {
      frag.appendChild(document.createTextNode(text.slice(last, pos)));
      const hit = document.createElement("span");
      hit.className = "searchHit";
      hit.textContent = m;
      frag.appendChild(hit);
      last = pos + m.length;
      return m;
    });
    frag.appendChild(document.createTextNode(text.slice(last)));
    n.parentNode.replaceChild(frag, n);
  }
}


/* =====================================================================
   10. AVVIO
   ===================================================================== */
async function boot(){
  el.title.addEventListener("click", () => go(""));

  el.search.addEventListener("input", () => doSearch(el.search.value));
  el.search.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape"){
      el.search.value = "";
      doSearch("");
    }
  });

  el.popup.addEventListener("click", (ev) => ev.stopPropagation());
  document.addEventListener("click", hidePopup);
  document.addEventListener("scroll", hidePopup, { passive: true });
  // indietro/avanti del browser e indirizzi scritti a mano
  const onAddressChange = () => { if (currentPath() !== APP.renderedPath) render(); };
  window.addEventListener("hashchange", onAddressChange);
  window.addEventListener("popstate", onAddressChange);

  try {
    await loadIndex();
  } catch {
    showMessage(`Index not found (${INDEX_FILE}).`);
    return;
  }
  render();
}

boot();

})();
