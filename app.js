/* =====================================================================
   MUSICAL ATLAS - app.js

   Sezioni:
     1. IMPOSTAZIONI
     2. REGOLE DI FORMATTAZIONE   <- qui si aggiungono le regole nuove
     3. Strumenti per le regole
     4. Indice del sito (atlas-index.json)
     5. Indirizzi e navigazione
     6. Disegno di percorso, pulsanti, PEOPLES / GENRES / INSTRUMENTS
        6b. GENRES e INSTRUMENTS (liste generate dai testi)
        6c. Titolo dell'info box (apre e chiude il testo)
        6d. Catalogo degli strumenti (griglia di immagini)
     7. Apertura di una pagina
     8. Menu a comparsa (al clic su una parola)
        8b. Scheda dello strumento
     9. Ricerca
    10. Avvio
   ===================================================================== */
(() => {
"use strict";


/* =====================================================================
   1. IMPOSTAZIONI
   ===================================================================== */
const INDEX_FILE = "atlas-index.json";      // creato da _build_index.py
const SITE_TITLE = "Musical Atlas";         // titolo della scheda del browser
const INFO_LABEL = "INFO";                  // pulsante del testo della pagina, nell'info box

// PULSANTI UNITI (prova della versione 4.5): percorso, pagine sotto il percorso,
// rami di INSTRUMENTS e "< luogo" del globo diventano blocchi unici, con gli
// archetti solo alle estremita'. Per tornare ai pulsanti singoli: false.
const JOINED_LABELS = true;
const WELCOME_TEXT = `Welcome!`;

// Cartelle mostrate come interruttori a destra, non come pulsanti normali
const SPECIAL_FOLDERS = ["INSTRUMENTS", "PEOPLES"];

// Interruttori nell'intestazione dell'info box, in quest'ordine.
// GENRES e INSTRUMENTS non sono cartelle: le loro liste nascono dai testi (vedi sezione 6b).
const TOGGLE_ORDER = ["PEOPLES", "GENRES", "INSTRUMENTS"];
const GENRES = "GENRES";
const INSTRUMENTS = "INSTRUMENTS";


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

   scheda:  (facoltativo) se restituisce uno strumento, il clic apre la sua
            scheda invece del menu (vedi sezione 8b).

   azioni:  cosa compare nel menu al clic. Riceve il testo e restituisce
            un elenco di voci. Voci disponibili:
              vaiA(etichetta, percorso)   -> "go to ..."
              cercaSulWeb(testo)          -> "search the web"
              conMappa(voci, testo)       -> aggiunge "show on map" alle voci,
                                             se la mappa conosce quel nome
            Elenco vuoto [] = il testo resta normale, non cliccabile.

   Il formato confronta un "tratto": un pezzo di testo continuo con
   la stessa formattazione. Vale la prima regola che corrisponde.
   Per aggiungere una regola: copia un blocco { ... }, incollalo
   prima di "];" e modificalo.
   ===================================================================== */
const REGOLE = [

  // 1. Grassetto (non maiuscolo) -> vai alla pagina o cartella con quel nome + mostra sulla mappa
  {
    formato: { grassetto: true, corsivo: false, sottolineato: false, maiuscolo: false, colore: "nessuno" },
    azioni: (testo) => {
      const dest = trovaPaginaOCartella(testo);
      return conMappa(dest ? [ vaiA(dest.title, dest.path) ] : [], testo);
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

  // 5. Giallo + grassetto + sottolineato + MAIUSCOLO -> e' un POPOLO: vai alla sua pagina + mostra sulla mappa
  {
    formato: { grassetto: true, corsivo: false, sottolineato: true, maiuscolo: true, colore: "yellow" },
    azioni: (testo) => {
      const pop = trovaPopolo(testo);
      const pagina = pop ? APP.byPath.get(pop.path) : null;
      return conMappa(pagina ? [ vaiA(pagina.title, pagina.path) ] : [], testo);
    }
  },

  // 6. Corsivo + MAIUSCOLO + azzurro -> STRUMENTO NATIVO: apre la sua scheda
  //    (se non e' nel dizionario _INSTRUMENTS.csv: menu con "search the web")
  {
    formato: { grassetto: false, corsivo: true, sottolineato: false, maiuscolo: true, colore: "cyan" },
    scheda: (testo) => trovaStrumento(testo),
    azioni: (testo) => [ cercaSulWeb(testo) ]
  },

  // 7. Corsivo + MAIUSCOLO senza colore -> STRUMENTO CITATO: apre la sua scheda
  {
    formato: { grassetto: false, corsivo: true, sottolineato: false, maiuscolo: true, colore: "nessuno" },
    scheda: (testo) => trovaStrumento(testo),
    azioni: (testo) => [ cercaSulWeb(testo) ]
  },

];


/* =====================================================================
   3. STRUMENTI PER LE REGOLE
   ===================================================================== */

// Voce di menu "go to ..."
// "go to" dei fumetti: si arriva sul luogo con INFO acceso (il suo testo), non col
// pulsante ricordato; il globo si centra sul luogo come sempre
function vaiA(etichetta, percorso){
  return { etichetta: "go to " + etichetta, fai: () => { APP.memory = null; go(percorso, "doc"); } };
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

// Aggiunge la voce "show on map" se la mappa conosce quel nome
function conMappa(voci, testo){
  const mappa = window.AtlasMap;
  if (!mappa || !mappa.knows(testo)) return voci;
  return [ ...voci, { etichetta: mappa.label, fai: () => mappa.show(testo) } ];
}

// Popolo con quel nome, da atlas-index.json (null se non c'e')
function trovaPopolo(testo){
  const key = normalizeKey(testo.replace(/^[\s"'(\[‘“]+|[\s"'.,;:!?)\]’”]+$/g, ""));
  return (APP.index.peoples || {})[key] || null;
}

// Strumento con quel nome o nome alternativo, dal dizionario (null se non c'e')
function trovaStrumento(testo){
  const key = normalizeKey(testo.replace(/^[\s"'(\[‘“]+|[\s"'.,;:!?)\]’”]+$/g, ""));
  const ins = APP.index.instruments;
  return (ins && ins.names && ins.names[key]) || null;
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

// Chiave per confrontare i nomi (identica a quella di _build_index.py)
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

// Regola generale: ogni menu finisce con "search the web"
function conRicerca(azioni, testo){
  if (azioni.some(a => a.etichetta === "search the web")) return azioni;
  return [ ...azioni, cercaSulWeb(testo) ];
}

// Applica le regole alla pagina appena aperta
function applicaRegole(root){
  for (const tratto of trovaTratti(root)){
    const regola = REGOLE.find(r => formatoCorrisponde(r.formato, tratto));
    if (!regola) continue;
    const scheda = regola.scheda ? regola.scheda(tratto.testo) : null;
    const azioni = conRicerca(regola.azioni(tratto.testo), tratto.testo);
    for (const n of tratto.nodi){
      const span = document.createElement("span");
      span.className = "atlasLink";
      n.parentNode.replaceChild(span, n);
      span.appendChild(n);
      span.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (scheda) apriScheda(scheda);
        else mostraMenu(span, azioni);
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
  subRows:   $("#specialSubRows"),
  doc:       $("#docContent"),
  catalog:   $("#catalog"),
  frame:     $(".docFrame"),
  info:      $("#infoBox"),
  infoTitle: $("#infoTitle"),
  infoBody:  $(".infoBody"),
  popup:     $("#hoverCard"),
  card:      $("#instrumentCard"),
  cardBody:  $("#cardContent"),
  cardClose: $("#cardClose"),
};

const APP = {
  index: null,            // contenuto di atlas-index.json
  root: null,             // cartella principale (WORLD)
  byPath: new Map(),      // percorso -> cartella o pagina
  parentOf: new Map(),    // percorso -> cartella che lo contiene
  byName: new Map(),      // nome normalizzato -> cartella o pagina (regola 1)
  openSpecial: null,      // interruttore acceso (cartella PEOPLES, oppure GENRES / INSTRUMENTS) o null
  infoOpen: true,         // testo dell'info box aperto (si chiude cliccando il titolo)
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

  // la mappa usa lo stesso indice
  if (window.AtlasMap) window.AtlasMap.setIndex(APP.index);
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
// scorri: dove portare la vista quando la pagina e' pronta
//   "doc" = inizio dell'info box (link interni "go to ...")
//   "hit" = prima parola trovata (risultati della ricerca)
//   niente = la pagina resta ferma (pulsanti, percorso, mappa)
function go(path, scorri){
  hidePopup();
  APP.scrollTo = scorri || null;
  if (path === currentPath()) { render(); return; }
  if (path) location.hash = encodePath(path);
  else {
    history.pushState(null, "", location.pathname + location.search);
    render();
    window.dispatchEvent(new HashChangeEvent("hashchange"));   // anche il globo torna al benvenuto
  }
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
  // cartella con dentro solo la sua pagina: vale come una pagina (resta accesa nella riga
  // sotto, il percorso non si sposta). Appena ha altre pagine diventa una cartella normale.
  if (isLeafFolder(node) && APP.parentOf.get(node.path)){
    return { context: APP.parentOf.get(node.path), special: null, selected: null,
             docPath: (presentationOf(node) || {}).path || null, leaf: node };
  }
  return { context: node, special: null, selected: null, docPath: (presentationOf(node) || {}).path || null };
}

function isLeafFolder(folder){
  return folder.type === "folder" && !isSpecial(folder) &&
    !subfolders(folder).some(f => !isSpecial(f)) && !extraPages(folder).length;
}

// Disegna tutto in base all'indirizzo attuale
function render(){
  hidePopup();
  tieniPagina();
  if (el.results.innerHTML) conTransizione(el.results, () => { el.results.innerHTML = ""; });
  const path = currentPath();
  APP.renderedPath = path;
  const view = path ? computeView(path) : null;
  APP.view = view;
  // il pulsante scelto l'ultima volta (GENRES, INSTRUMENTS, PEOPLES) resta acceso
  // cambiando luogo, se il luogo nuovo ce l'ha; altrimenti INFO
  APP.openSpecial = view ? schedaRicordata() : null;
  chiudiCatalogo(true);            // cambiando luogo il catalogo riparte da capo (ALL)
  setInfoOpen(APP.openSpecial === null || APP.openSpecial === INSTRUMENTS);

  renderCrumbs();
  renderChoices();
  renderToggles();
  renderSpecialRow();

  if (view && view.docPath){
    openDoc(view.docPath);
  } else {
    showMessage(WELCOME_TEXT);
  }
  if (APP.openSpecial === INSTRUMENTS) apriCatalogo();
  renderTitle();
  document.title = APP.docTitle && view ? `${SITE_TITLE} - ${APP.docTitle}` : SITE_TITLE;
}

// Porta in vista l'obiettivo, solo se l'azione lo ha chiesto (vedi go)
function scorriSeServe(){
  const dove = APP.scrollTo;
  APP.scrollTo = null;
  if (!dove) return;
  // si aspetta che i box abbiano finito di cambiare altezza
  setTimeout(() => {
    const hit = dove === "hit" ? el.doc.querySelector(".searchHit") : null;
    if (hit){ hit.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const top = el.info.getBoundingClientRect().top;
    if (top >= 0 && top < window.innerHeight * 0.4) return;      // gia' in vista
    window.scrollTo({ top: window.scrollY + top - 12, behavior: "smooth" });
  }, durataTransizione());
}

// Durata delle transizioni in millisecondi (da --ui-time in styles.css)
function durataTransizione(){
  const v = getComputedStyle(document.documentElement).getPropertyValue("--ui-time").trim();
  const n = parseFloat(v) || 0;
  return v.endsWith("ms") ? n : n * 1000;
}

/* ---------------------------------------------------------------------
   LA PAGINA RESTA FERMA
   Quando un box si accorcia (testo -> catalogo, ramo diverso, testo che si chiude...)
   il browser, se eri sceso piu' giu' del nuovo fondo, riporterebbe su la pagina di
   colpo. Qui la pagina non si accorcia: tiene l'altezza che aveva, e lo spazio in
   piu' in fondo se ne va da solo mano a mano che risali.
   --------------------------------------------------------------------- */
function tieniPagina(){
  const root = document.documentElement;
  const h = root.scrollHeight;
  const ora = parseFloat(root.style.minHeight) || 0;
  if (h > ora) root.style.minHeight = h + "px";
  if (!APP.lasciaPagina){
    APP.lasciaPagina = () => {
      const min = parseFloat(root.style.minHeight) || 0;
      if (!min) return;
      const serve = Math.ceil(window.scrollY + window.innerHeight);
      if (serve < min) root.style.minHeight = serve + "px";
    };
    window.addEventListener("scroll", APP.lasciaPagina, { passive: true });
    window.addEventListener("resize", APP.lasciaPagina, { passive: true });
  }
}

// Cambia il contenuto di un box facendogli cambiare altezza con la transizione
function conTransizione(box, cambia){
  tieniPagina();
  const transizione = box.style.transition;
  box.style.transition = "none";               // misure esatte: transizioni sospese per un istante
  const prima = box.getBoundingClientRect().height;
  box.style.height = "";
  cambia();
  const dopo = box.getBoundingClientRect().height;
  box.style.height = prima + "px";
  void box.offsetHeight;                       // il browser registra l'altezza di partenza
  box.style.transition = transizione;
  if (Math.abs(dopo - prima) < 1){ box.style.height = ""; return; }
  box.style.height = dopo + "px";
  clearTimeout(box._fine);
  const fine = () => { box.style.height = ""; box.removeEventListener("transitionend", fine); };
  box.addEventListener("transitionend", fine);
  box._fine = setTimeout(fine, durataTransizione() + 100);   // per sicurezza
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

// Riempie una riga di pulsanti.
// Regola generale: le righe con la classe "animRow" si aprono, si chiudono e cambiano
// altezza con la stessa transizione di tutti i box (--ui-time / --ui-ease in styles.css).
function setRow(row, buttons){
  const fill = () => {
    row.innerHTML = "";
    for (const b of buttons) row.appendChild(b);
    row.classList.toggle("collapsed", buttons.length === 0);
    unisciRiga(row);
  };
  if (row.classList.contains("animRow")) conTransizione(row, fill);
  else fill();
}

/* ---------------------------------------------------------------------
   PULSANTI UNITI (vedi JOINED_LABELS): le righe con la classe "joined"
   diventano un blocco solo. Le righe si dividono in modo equilibrato
   (niente 4 + 1: piuttosto 3 + 2) e il contorno segue la loro lunghezza:
   un angolo e' arrotondato solo se e' un angolo esterno del blocco.
   --------------------------------------------------------------------- */
function unisciRiga(row){
  if (!JOINED_LABELS || !row.classList.contains("joined")) return;
  for (const x of row.querySelectorAll(".rowBreak")) x.remove();
  const btns = [...row.children].filter(b => b.classList.contains("btn"));
  for (const b of btns) b.classList.remove("jTL", "jTR", "jBL", "jBR", "jLitUp");
  const avail = row.clientWidth - 4;
  if (!btns.length || avail <= 0) return;

  // righe equilibrate: la larghezza piu' piccola che non aumenta il numero di righe
  const w = btns.map(b => b.getBoundingClientRect().width - 2);
  const lines = (limit) => {
    const out = [[]];
    let used = 0;
    w.forEach((x, i) => {
      if (used && used + x > limit){ out.push([]); used = 0; }
      out[out.length - 1].push(i);
      used += x;
    });
    return out;
  };
  const need = lines(avail).length;
  let lo = Math.max(...w), hi = avail;
  if (need > 1){
    for (let k = 0; k < 20; k++){
      const mid = (lo + hi) / 2;
      if (lines(mid).length > need) lo = mid; else hi = mid;
    }
  }
  const rows = need > 1 ? lines(hi) : [btns.map((_, i) => i)];
  rows.slice(1).forEach(r => {
    const br = document.createElement("div");
    br.className = "rowBreak";
    row.insertBefore(br, btns[r[0]]);
  });

  // accesi sotto un acceso: riga nera tra i due
  rows.forEach((r, i) => {
    if (!i) return;
    for (const k of r){
      const b = btns[k];
      if (!b.classList.contains("sel")) continue;
      const me = b.getBoundingClientRect();
      const above = rows[i - 1].some(j => {
        const o = btns[j];
        if (!o.classList.contains("sel")) return false;
        const q = o.getBoundingClientRect();
        return q.left < me.right - 1 && q.right > me.left + 1;
      });
      b.classList.toggle("jLitUp", above);
    }
  });

  // angoli: arrotondati solo dove il blocco finisce
  const ext = rows.map(r => {
    const a = btns[r[0]].getBoundingClientRect(), b = btns[r[r.length - 1]].getBoundingClientRect();
    return { l: a.left, r: b.right };
  });
  rows.forEach((r, i) => {
    const first = btns[r[0]], last = btns[r[r.length - 1]];
    const up = ext[i - 1], down = ext[i + 1], me = ext[i];
    // arrotondato, tranne dove la riga vicina finisce nello stesso punto
    if (!up || Math.abs(up.l - me.l) > 1) first.classList.add("jTL");
    if (!down || Math.abs(down.l - me.l) > 1) first.classList.add("jBL");
    if (!up || Math.abs(up.r - me.r) > 1) last.classList.add("jTR");
    if (!down || Math.abs(down.r - me.r) > 1) last.classList.add("jBR");
  });
}

// Se cambia la larghezza (finestra, telefono girato, mappa che si chiude) si rifanno
function osservaRigheUnite(){
  if (!JOINED_LABELS || !("ResizeObserver" in window)) return;
  const ro = new ResizeObserver((entries) => {
    for (const e of entries){
      const r = e.target;
      if (Math.abs((r._w || 0) - e.contentRect.width) < 1) continue;
      r._w = e.contentRect.width;
      unisciRiga(r);
    }
  });
  for (const r of [el.crumbs, el.choices, el.special]) ro.observe(r);
  APP.righeRO = ro;                // le righe dei sotto-rami si aggiungono quando nascono
}

// Percorso in alto: WORLD > AFRICA > WEST AFRICA, fino alla cartella in cui sei.
// Su una pagina (es. Mali) il percorso si ferma alla sua cartella: la pagina
// e' accesa nella riga sotto, tra le sue sorelle.
function renderCrumbs(){
  if (!APP.view){
    // benvenuto: solo WORLD, non selezionato
    setRow(el.crumbs, [ makeButton(APP.root.name, () => go(APP.root.path)) ]);
    return;
  }
  const chain = chainOf(APP.view.context);
  setRow(el.crumbs, chain.map((f, i) => makeButton(i ? nomeBreve(f.name, chain[i - 1].name) : f.name,
    () => (f.path === currentPath() ? statoIniziale(f.path) : go(f.path)), "sel")));
}

// Nome senza il livello sopra, se lo contiene per intero (solo percorso e riga sotto):
// WEST AFRICA sotto AFRICA -> WEST.  Parole intere: AFRICAN non e' AFRICA.
function nomeBreve(name, parent){
  const w = String(name).trim().split(/\s+/), pw = String(parent || "").trim().split(/\s+/);
  const up = (x) => x.toUpperCase();
  for (let i = 0; i + pw.length <= w.length; i++){
    if (pw.every((x, j) => up(x) === up(w[i + j]))){
      const rest = w.slice(0, i).concat(w.slice(i + pw.length));
      return rest.length ? rest.join(" ") : name;
    }
  }
  return name;
}

// Pulsanti della cartella in cui sei: sottocartelle (tranne PEOPLES) e pagine.
// Stanno nella striscia della mappa chiusa, sotto il percorso. Su una pagina
// (es. Mali) si vedono le sue sorelle e la pagina aperta e' accesa.
function renderChoices(){
  const here = APP.byPath.get(currentPath());
  if (!APP.view || !here || isSpecial(here) || APP.view.special) { setRow(el.choices, []); return; }
  const folder = APP.view.context;
  const buttons = [];
  for (const f of subfolders(folder)){
    if (isSpecial(f)) continue;
    const here = f.path === currentPath();        // cartella "foglia" aperta: accesa qui
    buttons.push(makeButton(nomeBreve(f.name, folder.name),
      () => (here ? statoIniziale(f.path) : go(f.path)), (here ? "sel " : "") + sullaMappa(f)));
  }
  for (const p of extraPages(folder)){
    const here = APP.view.docPath === p.path;
    buttons.push(makeButton(nomeBreve(p.title, folder.name),
      () => (here ? statoIniziale(p.path) : go(p.path)),
      (here ? "sel " : "") + sullaMappa(p)));
  }
  setRow(el.choices, buttons);
}

// "onMap" = la mappa mostra gia' questa cartella o pagina:
// il pulsante si nasconde quando la mappa e' aperta (vedi map/atlas-map.css)
function sullaMappa(node){
  return window.AtlasMap && window.AtlasMap.represents(node) ? "onMap" : "";
}

// Interruttori nell'intestazione (PEOPLES / GENRES / INSTRUMENTS), uno alternativo all'altro
function renderToggles(){
  if (!APP.view) { setRow(el.toggles, []); return; }
  const folders = subfolders(APP.view.context).filter(isSpecial);
  const buttons = [];
  for (const name of TOGGLE_ORDER){
    let key = null;
    if (name === GENRES){ if (genresInScope().length) key = GENRES; }
    else if (name === INSTRUMENTS){ if (instrumentsInScope().length) key = INSTRUMENTS; }
    else key = folders.find(f => f.name.toUpperCase() === name) || null;
    if (!key) continue;
    const on = APP.openSpecial === key;
    buttons.push(makeButton(typeof key === "string" ? key : key.name,
      () => attivaScheda(on ? null : key),       // riclic sul pulsante acceso = torna INFO
      toggleClass(key) + (on ? " sel" : "")));
  }
  setRow(el.toggles, buttons);
}

// GENRES / INSTRUMENTS sono nomi (testo), PEOPLES e' una cartella
/* ---------------------------------------------------------------------
   GRUPPO INFO / PEOPLES / GENRES / INSTRUMENTS: se ne accende uno solo.
     INFO (openSpecial = null): testo della pagina aperto.
     PEOPLES / GENRES: la loro riga; INFO si spegne e il testo si chiude.
     INSTRUMENTS: la riga dei rami e il catalogo al posto del testo.
     Riclic sul pulsante acceso: si spegne e torna INFO.
     INFO acceso e ricliccato: si chiude anche lui (resta solo l'intestazione).
   Il pulsante scelto (APP.memory) resta acceso cambiando luogo; lo dimenticano
   INFO, il luogo in cui sei (percorso, pagina accesa, pulsante sul globo).
   --------------------------------------------------------------------- */
function attivaScheda(key){
  hidePopup();
  APP.openSpecial = key;
  APP.memory = key ? (typeof key === "string" ? key : key.name.toUpperCase()) : null;
  renderToggles();
  renderSpecialRow();
  if (key === INSTRUMENTS) apriCatalogo();
  else { chiudiCatalogo(false); setInfoOpen(!key); }
  renderTitle();                                  // INFO acceso solo se nessun altro lo e'
}

// Il pulsante ricordato, se il luogo aperto ce l'ha (altrimenti null = INFO)
function schedaRicordata(){
  const m = APP.memory;
  if (!m || !APP.view) return null;
  if (m === GENRES) return genresInScope().length ? GENRES : null;
  if (m === INSTRUMENTS) return instrumentsInScope().length ? INSTRUMENTS : null;
  return subfolders(APP.view.context).find(f => isSpecial(f) && f.name.toUpperCase() === m) || null;
}

// Torna allo stato iniziale del luogo (INFO acceso, nessun pulsante ricordato)
function statoIniziale(path){
  APP.memory = null;
  go(path);
}

function toggleClass(folder){
  return "toggle-" + (typeof folder === "string" ? folder : folder.name).toLowerCase();
}

// Livello mostrato dal globo: lo stesso interruttore dell'info box
// (nessuno acceso = INFO, cioe' i luoghi)
function livelloGlobo(){
  const sp = APP.openSpecial;
  return !sp ? "INFO" : typeof sp === "string" ? sp : sp.name.toUpperCase();
}

// Riga sotto: contenuto dell'interruttore acceso
function renderSpecialRow(){
  if (window.AtlasMap && window.AtlasMap.setLayer) window.AtlasMap.setLayer(livelloGlobo());
  const sp = APP.openSpecial;
  el.special.classList.toggle("joined", sp === INSTRUMENTS);   // uniti solo i rami di INSTRUMENTS
  renderSottoRami();
  if (!sp) { setRow(el.special, []); return; }
  if (sp === GENRES) { setRow(el.special, genreButtons()); return; }
  if (sp === INSTRUMENTS) { setRow(el.special, catalogButtons()); return; }
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
   6b. GENRES e INSTRUMENTS (dai testi, senza cartelle)
   Stessa logica per entrambi (elencoInScope); cambia solo cosa fa il clic:
     GENRES      -> menu "go to" le pagine dove e' nativo + "search the web"
     INSTRUMENTS -> scheda dello strumento (sezione 8b)
   Strumento = corsivo + MAIUSCOLO (lo raccoglie _build_instruments.py dal dizionario
   INSTRUMENTS/_INSTRUMENTS.csv): azzurro = NATIVO, senza colore = CITATO.

   GENRES
   Genere = grassetto + corsivo + MAIUSCOLO (lo raccoglie _build_index.py):
     con evidenziazione verde = NATIVO del luogo, senza = CITATO (nativo altrove).
   La lista vale per il luogo aperto: una pagina, o tutte le pagine di una cartella.
   Ordine: prima i nativi (prima quelli nativi in piu' pagine), poi i citati
   (prima i piu' citati); a parita', in ordine alfabetico.
   Aspetto: spenti; nativi in verde, citati in verde scuro (classe "dim");
   un genere si accende mentre il suo menu e' aperto.
   Clic: "go to" le pagine dove e' nativo (in ordine alfabetico) + "search the web".
   ===================================================================== */
// Voci (generi o strumenti) presenti nel luogo aperto, nell'ordine dei pulsanti
// (lo stesso per GENRES e INSTRUMENTS).
// tutti: { chiave: { native: {pagina: volte}, cited: {pagina: volte}, ... } }
// nome:  come leggere il nome di una voce (per l'ordine alfabetico)
function elencoInScope(tutti, nome){
  if (!tutti) return [];
  const node = APP.byPath.get(currentPath()) || APP.root;
  const inScope = node.type === "page"
    ? (p) => p === node.path
    : (p) => p.startsWith(node.path + "/");
  const list = [];
  for (const [key, g] of Object.entries(tutti)){
    const nativeN = Object.keys(g.native).filter(inScope).length;
    let citedN = 0;
    for (const [p, n] of Object.entries(g.cited)) if (inScope(p)) citedN += n;
    if (nativeN || citedN) list.push({ key, g, nativeN, citedN });
  }
  // prima i nativi del luogo, poi i citati; in ciascun gruppo dal piu' citato
  // nell'atlante intero (tutte le volte, anche ripetute nella stessa pagina);
  // a parita', in ordine alfabetico
  for (const x of list) x.total = citazioniTotali(x.g);
  list.sort((a, b) =>
    (b.nativeN > 0) - (a.nativeN > 0) || b.total - a.total ||
    nome(a.g).localeCompare(nome(b.g)));
  return list;
}

// Quante volte una voce compare in tutto l'atlante (nativa + citata)
function citazioniTotali(g){
  let n = 0;
  for (const v of Object.values(g.native || {})) n += v;
  for (const v of Object.values(g.cited || {})) n += v;
  return n;
}

function genresInScope(){
  return elencoInScope(APP.index && APP.index.genres, (g) => g.term);
}

function genreButtons(){
  return genresInScope().map(({ g, nativeN }) => {
    const b = makeButton(g.term, () => {
      const wasOpen = APP.menuOwner === b;
      hidePopup();
      if (wasOpen) return;                       // secondo clic: richiude il menu
      b.classList.add("sel");                    // acceso mentre il suo menu e' aperto
      APP.menuOwner = b;
      mostraMenu(b, azioniGenere(g));
    }, "toggle-genres" + (nativeN ? "" : " dim"));   // nativo: verde;  citato: verde scuro
    return b;
  });
}

function azioniGenere(g){
  const pages = Object.keys(g.native).map(p => APP.byPath.get(p)).filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
  return conRicerca(pages.map(p => vaiA(p.title, p.path)), g.term);
}

// INSTRUMENTS: stessa logica dei generi; aperto mostra il catalogo (sezione 6d)
function instrumentsInScope(){
  const ins = APP.index && APP.index.instruments;
  return elencoInScope(ins && ins.mentions, (g) => g.name);
}


/* =====================================================================
   6c. PULSANTE INFO DELL'INFO BOX (apre e chiude il testo della pagina)
   ===================================================================== */
function renderTitle(){
  el.infoTitle.innerHTML = "";
  if (APP.docTitle){
    // INFO: il testo della pagina (dove sei lo dicono il percorso e la riga delle pagine)
    const on = !APP.openSpecial && APP.infoOpen;
    el.infoTitle.appendChild(makeButton(INFO_LABEL, () => {
      if (APP.openSpecial) attivaScheda(null);     // un altro e' acceso: torna INFO
      else setInfoOpen(!APP.infoOpen);              // INFO stesso: apre / chiude il testo
    }, on ? "sel" : ""));
  }
  // niente titolo e niente interruttori (pagina di benvenuto): l'intestazione sparisce
  el.info.classList.toggle("bare", !APP.docTitle && !el.toggles.children.length);
}

// Apre o chiude il testo con la transizione (resta solo l'intestazione)
function setInfoOpen(open){
  if (APP.infoOpen === open) return;
  tieniPagina();
  APP.infoOpen = open;
  const body = el.infoBody;
  clearTimeout(body._fine);
  if (!open){
    body.style.height = body.scrollHeight + "px";
    void body.offsetHeight;
    el.info.classList.add("closed");
    body.style.height = "";                     // la classe "closed" lo porta a 0
  } else {
    el.info.classList.remove("closed");
    const h = body.scrollHeight;
    body.style.height = "0px";
    void body.offsetHeight;
    body.style.height = h + "px";
    body._fine = setTimeout(() => { body.style.height = ""; }, durataTransizione() + 60);
  }
  renderTitle();
}

// Cambia il testo: con la transizione se e' aperto, subito se e' chiuso
function cambiaTesto(cambia){
  if (APP.infoOpen) conTransizione(el.frame, cambia);
  else cambia();
}


/* =====================================================================
   6d. CATALOGO DEGLI STRUMENTI
   Con INSTRUMENTS acceso, al posto del testo compare la griglia degli strumenti
   del luogo aperto (nativi e citati; a WORLD anche quelli mai citati, se hanno
   l'immagine). Nella riga sotto l'intestazione: i rami della gerarchia del CSV
   (ALL > CHORDOPHONES > ...), col numero di strumenti; cliccandoli la griglia
   si restringe. Griglia a mattoncini, in ordine casuale, CATALOG_BATCH alla
   volta: le altre arrivano scorrendo. Clic su un riquadro = scheda (8b).
   ===================================================================== */
const CATALOG_BATCH = 24;          // riquadri caricati alla volta (si divide per 2, 3, 4, 6)
const CATALOG_MIN_COL = 180;       // larghezza minima di una colonna, in pixel
const ALL_LABEL = "ALL";

APP.catalog = null;                // { items, path, shown } mentre il catalogo e' aperto

// Ordine del catalogo (dentro ogni gruppo): nativi dal piu' citato (poi alfabetico); ogni CATALOG_EVERY nativi
// un citato, dal piu' citato; finiti i nativi, i citati rimasti. Vale anche dentro i rami.
const CATALOG_EVERY = 4;
// Prima gli strumenti con l'immagine, poi quelli senza; in ciascun gruppo la regola sotto.
function ordineCatalogo(items){
  const con = items.filter(x => x.it.image), senza = items.filter(x => !x.it.image);
  return ordineGruppo(con).concat(ordineGruppo(senza));
}
function ordineGruppo(items){
  const peso = (x) => citazioniTotali(x.it);
  const cmp = (a, b) => peso(b) - peso(a) || a.it.name.localeCompare(b.it.name);
  const nat = items.filter(x => x.native).sort(cmp);
  const cit = items.filter(x => !x.native).sort(cmp);
  const out = [];
  nat.forEach((x, i) => {
    out.push(x);
    if ((i + 1) % CATALOG_EVERY === 0 && cit.length) out.push(cit.shift());
  });
  return out.concat(cit);
}

async function apriCatalogo(){
  let dati;
  try { dati = await caricaStrumenti(); }
  catch { dati = { items: {} }; }
  if (APP.openSpecial !== INSTRUMENTS) return;        // nel frattempo e' stato chiuso

  const items = [];
  const seen = new Set();
  for (const { key, g, nativeN } of instrumentsInScope()){
    const it = dati.items[key] || { name: g.name, paths: [], image: null };
    items.push({ key, it, native: nativeN > 0 });
    seen.add(key);
  }
  const here = APP.byPath.get(currentPath());
  if (!here || here === APP.root){                     // WORLD: anche i mai citati con immagine
    for (const [key, it] of Object.entries(dati.items)){
      if (!seen.has(key) && it.image) items.push({ key, it, native: false });
    }
  }
  APP.catalog = { items: ordineCatalogo(items), path: [], shown: 0 };
  ramoObbligato(APP.catalog);
  renderSpecialRow();
  setInfoOpen(true);
  cambiaTesto(() => {
    el.doc.hidden = true;
    el.catalog.hidden = false;
    el.frame.classList.add("catalogOn");
    disegnaCatalogo();
  });
}

function chiudiCatalogo(subito){
  if (!APP.catalog && el.catalog.hidden) return;
  APP.catalog = null;
  ramoSulGlobo();
  renderSottoRami();
  const via = () => {
    el.catalog.hidden = true;
    el.catalog.innerHTML = "";
    el.doc.hidden = false;
    el.frame.classList.remove("catalogOn");
  };
  if (subito) via(); else cambiaTesto(via);
}

// Il ramo scelto nel catalogo vale anche sul globo
function ramoSulGlobo(){
  if (!window.AtlasMap || !window.AtlasMap.setOnly) return;
  const cat = APP.catalog;
  window.AtlasMap.setOnly(cat && cat.path.length
    ? cat.items.filter(x => nelRamo(x, cat.path)).map(x => x.key) : null);
}

// Strumenti che stanno nel ramo scelto (path = [] vuol dire tutti)
function nelRamo(item, path){
  if (!path.length) return true;
  return (item.it.paths || []).some(p => path.every((v, i) => p[i] === v));
}

/* Righe dei rami (una riga per livello della gerarchia del CSV):
     riga 1: ALL e i rami principali presenti nel luogo (CHORDOPHONES, IDIOPHONES...)
     riga 2: i sotto-rami del ramo scelto (LUTES, HARPS...), e cosi' via.
   In ogni riga restano tutti i rami: si accende quello scelto, gli altri restano spenti.
   Riclic sul ramo acceso: si spegne e si torna al livello sopra (in riga 1: ALL).
   Rami assenti nel luogo: non compaiono. Se in una riga c'e' un ramo solo e contiene
   tutti gli strumenti mostrati, e' gia' acceso e ALL (o il riclic) non serve. */

// Rami figli di "path" tra gli strumenti del catalogo: [[nome, Set di chiavi], ...]
// dal piu' numeroso (a parita', in ordine alfabetico)
function ramiFigli(cat, path){
  const next = new Map();
  for (const x of cat.items){
    for (const p of (x.it.paths || [])){
      if (p.length > path.length && path.every((v, i) => p[i] === v)){
        const v = p[path.length];
        if (!next.has(v)) next.set(v, new Set());
        next.get(v).add(x.key);
      }
    }
  }
  return [...next.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
}

// Livelli che non lasciano scelta: un ramo solo che contiene tutti gli strumenti del
// livello sopra. Si accendono da soli (es. NIGERIA: solo CHORDOPHONES -> niente ALL).
function ramoUnico(cat, path){
  const figli = ramiFigli(cat, path);
  if (figli.length !== 1) return null;
  const tutti = cat.items.filter(x => nelRamo(x, path)).length;
  return figli[0][1].size === tutti ? figli[0][0] : null;
}
function ramoObbligato(cat){
  for (let v; (v = ramoUnico(cat, cat.path)); ) cat.path = [...cat.path, v];
}

// Pulsanti della riga "livello" (0 = riga dei rami principali)
function rigaRami(livello){
  const cat = APP.catalog;
  if (!cat || livello > cat.path.length) return [];
  const sopra = cat.path.slice(0, livello);
  const figli = ramiFigli(cat, sopra);
  if (!figli.length) return [];
  const obbligato = ramoUnico(cat, sopra);
  const scegli = (path) => () => {
    hidePopup();
    cat.path = path;
    ramoObbligato(cat);
    ramoSulGlobo();
    tieniPagina();
    renderSpecialRow();
    cambiaTesto(disegnaCatalogo);
  };
  const buttons = [];
  // ALL acceso solo se non e' scelto nessun ramo (come tutti gli altri pulsanti)
  if (livello === 0 && !obbligato){
    buttons.push(makeButton(ALL_LABEL, scegli([]),
                            "toggle-instruments" + (cat.path.length ? "" : " sel")));
  }
  for (const [v] of figli){
    const acceso = cat.path[livello] === v;
    const azione = acceso
      ? (obbligato ? () => {} : scegli(sopra))      // riclic: si spegne, si torna su
      : scegli([...sopra, v]);
    buttons.push(makeButton(v, azione, "toggle-instruments" + (acceso ? " sel" : "")));
  }
  return buttons;
}

function catalogButtons(){ return rigaRami(0); }

// Righe dei sotto-rami, sotto la riga di INSTRUMENTS (nascono e spariscono a tendina)
function renderSottoRami(){
  const box = el.subRows;
  if (!box) return;
  const righe = [];
  if (APP.openSpecial === INSTRUMENTS && APP.catalog){
    for (let k = 1; k <= APP.catalog.path.length; k++) righe.push(rigaRami(k));
  }
  while (righe.length && !righe[righe.length - 1].length) righe.pop();
  // le righe in piu' si chiudono (restano vuote), quelle che mancano nascono chiuse
  while (box.children.length < righe.length){
    const r = crea("div", "choicesRow animRow collapsed" + (JOINED_LABELS ? " joined" : ""));
    box.appendChild(r);
    if (APP.righeRO) APP.righeRO.observe(r);
  }
  [...box.children].forEach((r, k) => setRow(r, righe[k] || []));
}

// Disegna la griglia da capo (primo blocco); gli altri blocchi arrivano scorrendo
function disegnaCatalogo(){
  const cat = APP.catalog;
  const box = el.catalog;
  if (!cat) return;
  if (box._osservaFondo) box._osservaFondo.disconnect();
  if (box._osservaLarghezza) box._osservaLarghezza.disconnect();
  box.innerHTML = "";
  cat.list = ordineCatalogo(cat.items.filter(x => nelRamo(x, cat.path)));   // stesso ordine anche nei rami
  cat.shown = 0;
  if (!cat.list.length){
    box.appendChild(crea("p", "catalogEmpty", "No instruments here."));
    return;
  }
  const grid = crea("div", "catalogGrid");
  const fondo = crea("div", "catalogEnd");
  box.append(grid, fondo);
  cat.grid = grid;
  cat.cols = [];
  impostaColonne();
  altriRiquadri();

  // in fondo alla griglia: arriva il blocco successivo
  if ("IntersectionObserver" in window){
    box._osservaFondo = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) altriRiquadri();
    }, { rootMargin: "600px 0px" });
    box._osservaFondo.observe(fondo);
  }
  // se cambia la larghezza (es. telefono girato) le colonne si rifanno
  if ("ResizeObserver" in window){
    let w = grid.clientWidth;
    box._osservaLarghezza = new ResizeObserver(() => {
      if (Math.abs(grid.clientWidth - w) < 2 || !APP.catalog) return;
      w = grid.clientWidth;
      const n = cat.shown;
      impostaColonne();
      cat.shown = 0;
      while (cat.shown < n) altriRiquadri();
    });
    box._osservaLarghezza.observe(grid);
  }
}

// Colonne della griglia: tante quante ne stanno (almeno 2)
function impostaColonne(){
  const cat = APP.catalog;
  const n = Math.max(2, Math.floor(cat.grid.clientWidth / CATALOG_MIN_COL));
  cat.grid.innerHTML = "";
  cat.cols = [];
  for (let i = 0; i < n; i++){
    const c = crea("div", "catalogCol");
    c._h = 0;                                   // altezza stimata (le misure sono note)
    cat.grid.appendChild(c);
    cat.cols.push(c);
  }
}

// Aggiunge il blocco successivo, ogni riquadro nella colonna piu' corta
function altriRiquadri(){
  const cat = APP.catalog;
  if (!cat || !cat.list || cat.shown >= cat.list.length) return;
  const end = Math.min(cat.shown + CATALOG_BATCH, cat.list.length);
  for (; cat.shown < end; cat.shown++){
    const x = cat.list[cat.shown];
    const col = cat.cols.reduce((a, b) => (b._h < a._h ? b : a));
    col.appendChild(riquadro(x));
    col._h += x.it.image ? x.it.image.h / x.it.image.w + 0.25 : 0.4;
  }
}

function riquadro({ key, it, native }){
  const b = crea("button", "catalogTile" + (it.image ? "" : " noImage"));
  b.type = "button";
  if (it.image){
    const img = crea("img");
    img.src = it.image.thumb;
    img.width = it.image.w;                     // misure note: la griglia non salta
    img.height = it.image.h;
    img.alt = it.name;
    img.loading = "lazy";
    img.decoding = "async";
    b.appendChild(img);
  }
  b.appendChild(crea("span", "catalogName" + (native ? "" : " dim"), it.name));
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    hidePopup();
    apriScheda(key);
  });
  return b;
}


/* =====================================================================
   7. APERTURA DI UNA PAGINA
   ===================================================================== */
function showMessage(text){
  APP.docTitle = "";
  ++APP.loadToken;                               // annulla una pagina che stava arrivando
  cambiaTesto(() => {
    el.doc.innerHTML = "";
    const div = document.createElement("div");
    div.className = "welcomeMsg";
    div.textContent = text;
    el.doc.appendChild(div);
  });
  scorriSeServe();
}

// La pagina vecchia resta visibile finche' arriva la nuova:
// poi l'info box cambia altezza con la transizione, senza sobbalzi
async function openDoc(path){
  const token = ++APP.loadToken;
  const node = APP.byPath.get(path);
  APP.docTitle = node ? node.title : "";
  try {
    const res = await fetch("./" + encodePath(path), { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const html = await res.text();
    if (token !== APP.loadToken) return;          // nel frattempo e' stata aperta un'altra pagina
    cambiaTesto(() => {
      el.doc.innerHTML = html;
      applicaRegole(el.doc);
      highlightQuery(el.doc, APP.query);
    });
    scorriSeServe();
  } catch {
    if (token === APP.loadToken) showMessage("Could not open document.");
  }
}


/* =====================================================================
   8. MENU A COMPARSA
   ===================================================================== */
function hidePopup(){
  if (el.shade) el.shade.classList.remove("on");
  if (APP.menuOwner){ APP.menuOwner.classList.remove("sel"); APP.menuOwner = null; }
  if (APP.globeLit){ APP.globeLit = null; if (window.AtlasMap) window.AtlasMap.setLit(null); }
  el.popup.style.display = "none";
  el.popup.innerHTML = "";
}

function mostraMenu(anchor, azioni){
  if (azioni) el.popup.innerHTML = "";               // null = contenuto gia' pronto (es. "+N")
  for (const a of (azioni || [])){
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
  el.popup.style.maxHeight = "";
  el.popup.style.overflowY = "";
  el.popup.classList.remove("below");

  // posizione: sopra la parola; se sopra non c'e' posto, sotto. Mai sopra la parola stessa:
  // se il fumetto e' troppo lungo, scorre al suo interno.
  const r = anchor.getBoundingClientRect();
  const pad = 10, gap = 14;
  const above = r.top - gap - pad, below = window.innerHeight - r.bottom - gap - pad;
  let c = el.popup.getBoundingClientRect();
  let y;
  if (c.height <= above || above >= below){
    if (c.height > above){ el.popup.style.maxHeight = above + "px"; el.popup.style.overflowY = "auto"; c = el.popup.getBoundingClientRect(); }
    y = r.top - c.height - gap;
  } else {
    if (c.height > below){ el.popup.style.maxHeight = below + "px"; el.popup.style.overflowY = "auto"; c = el.popup.getBoundingClientRect(); }
    y = r.bottom + gap;
    el.popup.classList.add("below");
  }
  let x = r.left + r.width / 2 - c.width / 2;
  x = Math.max(pad, Math.min(x, window.innerWidth - c.width - pad));
  el.popup.style.left = x + "px";
  el.popup.style.top = y + "px";
}

// Fumetti del globo: lo sfondo si scurisce, un clic fuori chiude solo il fumetto
function ombraGlobo(){
  if (!el.shade){
    el.shade = document.createElement("div");
    el.shade.id = "popupShade";
    el.shade.addEventListener("click", (ev) => { ev.stopPropagation(); hidePopup(); });
    for (const t of ["pointerdown", "pointerup", "wheel", "touchstart"]){
      el.shade.addEventListener(t, (ev) => ev.stopPropagation(), { passive: true });
    }
    document.body.appendChild(el.shade);
  }
  el.shade.classList.add("on");
}


/* =====================================================================
   8b. SCHEDA DELLO STRUMENTO
   Si apre cliccando uno strumento nel testo o un pulsante di INSTRUMENTS.
   Riquadro sopra la pagina (che si scurisce e si sfoca). Si chiude con la ×,
   cliccando fuori, con Esc o col tasto "indietro" del browser / telefono.
   Contenuto: immagine, nome, nomi alternativi, descrizione, classificazione,
   pagine dove e' nativo (tranne quella aperta), fonte, "search the web".
   I dati completi stanno in instruments.json: si caricano al primo clic.
   ===================================================================== */
let datiStrumenti = null;          // promessa del caricamento di instruments.json

function caricaStrumenti(){
  if (!datiStrumenti){
    const file = (APP.index.instruments && APP.index.instruments.file) || "instruments.json";
    datiStrumenti = fetch("./" + file, { cache: "no-cache" })
      .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
      .catch(err => { datiStrumenti = null; throw err; });   // al prossimo clic riprova
  }
  return datiStrumenti;
}

// Piccolo aiuto per creare elementi: crea("p", "classe", "testo")
function crea(tag, classe, testo){
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

async function apriScheda(key, owner){
  hidePopup();
  let it = null;
  try {
    const dati = await caricaStrumenti();
    it = dati.items[key] || null;
  } catch {}
  if (!it){
    const m = APP.index.instruments && APP.index.instruments.mentions[key];
    it = { name: m ? m.name : key.toUpperCase(), aliases: [], description: "", source: "",
           paths: [], native: m ? m.native : {}, cited: {}, image: null };
  }
  disegnaScheda(it);
  mostraScheda(owner);
}

function disegnaScheda(it){
  const box = el.cardBody;
  box.innerHTML = "";
  el.card.querySelector(".cardTitle").textContent = it.name;

  if (it.image){
    const fig = crea("div", "cardImage");
    const img = crea("img");
    img.src = it.image.large;
    img.width = it.image.lw;                 // misure note: niente sobbalzi mentre arriva
    img.height = it.image.lh;
    img.alt = it.name;
    img.decoding = "async";
    fig.appendChild(img);
    box.appendChild(fig);
  }

  const text = crea("div", "cardText");
  if (it.aliases && it.aliases.length){
    text.appendChild(crea("p", "cardAka", "also known as: " + it.aliases.join(", ")));
  }
  if (it.description){
    const desc = crea("div", "cardDesc");
    for (const par of it.description.split(/\n+/)) desc.appendChild(crea("p", null, par));
    text.appendChild(desc);
  }
  if (it.paths && it.paths.length){
    const row = crea("div", "cardRow");
    for (const path of it.paths) row.appendChild(crea("p", "cardPath", path.join(" > ")));
    text.appendChild(row);
  }

  // Pagine dove e' nativo, tranne quella aperta
  const here = APP.view && APP.view.docPath;
  const pages = Object.keys(it.native || {}).map(p => APP.byPath.get(p)).filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
  const others = pages.filter(p => p.path !== here);
  if (others.length){
    const row = crea("p", "cardRow cardNative");
    row.appendChild(crea("span", "cardLabel",
      (others.length < pages.length ? "Also native to: " : "Native to: ")));
    others.forEach((p, i) => {
      if (i) row.appendChild(document.createTextNode(" · "));
      const a = crea("a", "cardLink", p.title);
      a.href = "#" + encodePath(p.path);
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        chiudiScheda(() => statoIniziale(p.path));   // INFO acceso; la pagina resta ferma, si muovono globo e testo
      });
      row.appendChild(a);
    });
    text.appendChild(row);
  }

  if (it.image && it.source) text.appendChild(crea("p", "cardSource", "Image: " + it.source));

  const web = crea("a", "cardLink cardWeb", "search the web");
  web.href = "https://www.google.com/search?q=" + encodeURIComponent(it.name + " musical instrument");
  web.target = "_blank";
  web.rel = "noopener";
  text.appendChild(web);

  box.appendChild(text);
}

function mostraScheda(owner){
  const card = el.card;
  if (APP.cardOwner) APP.cardOwner.classList.remove("sel");
  APP.cardOwner = owner || null;
  if (owner) owner.classList.add("sel");             // il pulsante resta acceso finche' e' aperta
  card.querySelector(".cardPanel").scrollTop = 0;
  if (!APP.cardOpen){
    APP.cardOpen = true;
    APP.cardFocus = document.activeElement;
    // una voce nella cronologia: il tasto "indietro" chiude la scheda invece di lasciare la pagina
    history.pushState({ atlasCard: true }, "", location.href);
    card.hidden = false;
    document.documentElement.classList.add("cardOpen");
    void card.offsetHeight;                          // poi parte la transizione
    card.classList.add("open");
    card.querySelector(".cardPanel").focus({ preventScroll: true });   // Tab porta alla ×
  }
}

// Chiude la scheda; "poi" (facoltativo) parte quando e' chiusa (es. "go to")
function chiudiScheda(poi){
  if (!APP.cardOpen){ if (poi) poi(); return; }
  APP.afterCard = poi || null;
  if (history.state && history.state.atlasCard) history.back();   // -> popstate -> nascondiScheda
  else nascondiScheda();
}

function nascondiScheda(){
  if (!APP.cardOpen) return;
  APP.cardOpen = false;
  const card = el.card;
  card.classList.remove("open");
  document.documentElement.classList.remove("cardOpen");
  if (APP.cardOwner){ APP.cardOwner.classList.remove("sel"); APP.cardOwner = null; }
  clearTimeout(card._fine);
  card._fine = setTimeout(() => { if (!APP.cardOpen) card.hidden = true; }, durataTransizione());
  if (APP.cardFocus && APP.cardFocus.focus) APP.cardFocus.focus({ preventScroll: true });
  const poi = APP.afterCard;
  APP.afterCard = null;
  if (poi) poi();
}


// Cosa fa una voce del globo (o del fumetto "+N")
function azioneVoce(layer, key, rect, litId){
  if (layer === GENRES){
    const g = APP.index.genres && APP.index.genres[key];
    if (!g) return;
    mostraMenu({ getBoundingClientRect: () => rect }, azioniGenere(g));
    ombraGlobo();
    APP.globeLit = litId;
    window.AtlasMap.setLit(litId);
  } else if (layer === INSTRUMENTS){
    apriScheda(key);
  } else if (layer === "PEOPLES"){
    const p = (APP.index.peoples || {})[key];
    if (p) go(p.path);
  }
}

// Fumetto del "+N": le voci mancanti come piccoli pulsanti (nativi accesi, citati scuri)
function mostraElenco(rect, layer, keys){
  el.popup.innerHTML = "";
  const box = document.createElement("div");
  box.className = "moreList";
  const cls = layer === GENRES ? "toggle-genres" : layer === INSTRUMENTS ? "toggle-instruments" : "toggle-peoples";
  for (const k of keys){
    const b = makeButton(k.name, () => {
      hidePopup();
      azioneVoce(layer, k.key, rect, null);
    }, cls + (k.native ? "" : " dim"));
    box.appendChild(b);
  }
  el.popup.appendChild(box);
  mostraMenu({ getBoundingClientRect: () => rect }, null);
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
  if (!words.length) { conTransizione(el.results, () => { el.results.innerHTML = ""; }); return; }

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
  conTransizione(el.results, disegnaRisultati);
}
function disegnaRisultati(){
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
        go(target, isDoc ? "hit" : "doc");
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
  // righe che si aprono "a tendina" (contenuto di PEOPLES / GENRES / INSTRUMENTS)
  el.special.classList.add("animRow");
  if (JOINED_LABELS){
    document.body.classList.add("joinedLabels");
    el.crumbs.classList.add("joined");
    el.choices.classList.add("joined");
    osservaRigheUnite();
  }

  el.title.addEventListener("click", () => { APP.memory = null; go(""); });

  el.search.addEventListener("input", () => doSearch(el.search.value));
  el.search.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape"){
      el.search.value = "";
      doSearch("");
    }
  });

  el.popup.addEventListener("click", (ev) => ev.stopPropagation());
  document.addEventListener("click", hidePopup);

  // clic su una voce del globo: genere = fumetto (la voce resta accesa finche' e' aperto),
  // strumento = scheda
  if (window.AtlasMap){
    // voce sul globo: genere = fumetto (riclic = lo chiude), strumento = scheda
    window.AtlasMap.onItem = (layer, key, rect) => {
      const was = APP.globeLit;
      hidePopup();
      if (was === key) return;
      azioneVoce(layer, key, rect, key);
    };
    // "+N": fumetto con le voci che non stanno sul globo (riclic = lo chiude)
    window.AtlasMap.onMore = (layer, keys, rect, id) => {
      const was = APP.globeLit;
      hidePopup();
      if (was === id) return;
      mostraElenco(rect, layer, keys);
      ombraGlobo();
      APP.globeLit = id;
      window.AtlasMap.setLit(id);
    };
    // pulsante del luogo sul globo: stato iniziale del luogo
    window.AtlasMap.onHere = () => statoIniziale(currentPath());
    // EXPLORE sul benvenuto: si parte da WORLD
    window.AtlasMap.onStart = () => go(APP.root.path);
  }

  // scheda dello strumento: la × e il clic fuori dal riquadro la chiudono
  el.cardClose.addEventListener("click", (ev) => { ev.stopPropagation(); chiudiScheda(); });
  el.card.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (ev.target === el.card) chiudiScheda();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && APP.cardOpen) chiudiScheda();
  });
  document.addEventListener("scroll", hidePopup, { passive: true });
  // indietro/avanti del browser e indirizzi scritti a mano
  const onAddressChange = () => {
    if (APP.cardOpen && !(history.state && history.state.atlasCard)){ nascondiScheda(); return; }
    if (currentPath() !== APP.renderedPath) render();
  };
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