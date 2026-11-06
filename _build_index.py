# -*- coding: utf-8 -*-
"""
MUSICAL ATLAS - _build_index.py

Rilegge la cartella World e scrive  atlas-index.json  con queste parti:
  - "tree"        l'albero del menu (cartelle e pagine)
  - "search"      il testo semplice di ogni pagina, per la ricerca
  - "definitions" i termini definiti -> pagina che li definisce
  - "peoples"     i popoli: dizionario PEOPLES/_PEOPLES.csv + schede PEOPLES/NOME.html
                  (li prepara _build_peoples.py)
  - "geoNames"    nomi e alias dei paesi -> codice (per la mappa)
  - "map"         continenti, zone e pagine dei paesi che compaiono sulla mappa
  - "instruments" nomi e pagine degli strumenti (il resto in instruments.json,
                  lo prepara _build_instruments.py)

Si esegue da solo tramite _anteprima.bat. Non serve installare niente
(solo per le immagini degli strumenti serve Pillow: la installa da solo
_build_instruments.py la prima volta).
"""

import json
import re
import sys
import unicodedata
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

# ------------------------------------------------------------
#  IMPOSTAZIONI
# ------------------------------------------------------------
ROOT_FOLDER = "World"                 # cartella con le pagine
OUTPUT_FILE = "atlas-index.json"     # file generato (non modificarlo a mano)
PAGE_EXTENSIONS = (".html", ".htm")  # maiuscole o minuscole, indifferente

SITE_DIR = Path(__file__).resolve().parent

# --- Mappa ---
MAP_WORLD = "map/world.json"         # confini dei paesi (se manca, la mappa e' ignorata)
MAP_CONFIG = "map/map-config.json"   # alias dei nomi e zone (modificabile a mano)
SPECIAL_FOLDERS = ("INSTRUMENTS", "PEOPLES")   # come in app.js: non sono zone

# Vecchie cartelle PEOPLES dentro World (pagine di gruppo): non vanno piu' sul sito.
# I popoli ora hanno le loro schede nella cartella PEOPLES accanto a World.
OLD_PEOPLES_FOLDER = "PEOPLES"
SKIPPED_FOLDERS = []                 # quelle trovate (le elenca il riassunto)


# ------------------------------------------------------------
#  TESTI E CONFRONTI
# ------------------------------------------------------------
def normalize_key(text):
    """Chiave per confrontare i termini (identica a quella di app.js):
    spazi ai bordi tolti, apostrofi e virgolette tipografiche resi semplici,
    tutto minuscolo."""
    s = unicodedata.normalize("NFC", str(text).strip())
    s = re.sub("[‘’‚‛´`]", "'", s)
    s = re.sub("[“”„‟″]", '"', s)
    return s.lower()


def geo_key(text):
    """Chiave per i nomi geografici (identica a geoKey di map/atlas-map.js):
    come normalize_key, ma senza accenti e con gli spazi doppi ridotti.
    Cosi' "Algerie" = "Algérie" e "Côte d’Ivoire" = "Cote d'Ivoire"."""
    s = unicodedata.normalize("NFD", normalize_key(text))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip()


def is_all_caps(text):
    """Vero se il testo ha almeno 2 lettere e sono tutte MAIUSCOLE."""
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 2 and all(c.isupper() for c in letters)


def sort_key(name):
    """Ordine alfabetico che ignora maiuscole e accenti (CÔTE vicino a COTE)."""
    plain = unicodedata.normalize("NFD", name)
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return plain.casefold()


def page_title(filename):
    """Titolo = nome del file senza estensione, così com'è."""
    return Path(filename).stem


# ------------------------------------------------------------
#  LETTURA DI UNA PAGINA
#  Divide il testo in "tratti" con la stessa formattazione
#  (grassetto, corsivo, sottolineato, colore).
# ------------------------------------------------------------
class PageReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.bold = 0
        self.italic = 0
        self.underline = 0
        self.marks = []          # colori dei <mark> aperti
        self.runs = []           # [(formato, testo), ...]
        self.words = []          # testo semplice della pagina

    def current_format(self):
        return (self.bold > 0, self.italic > 0, self.underline > 0,
                self.marks[-1] if self.marks else None)

    def end_run(self):
        self.runs.append((None, ""))   # separatore: chiude il tratto in corso

    def handle_starttag(self, tag, attrs):
        if tag in ("b", "strong"):
            self.bold += 1
        elif tag in ("i", "em"):
            self.italic += 1
        elif tag == "u":
            self.underline += 1
        elif tag == "mark":
            self.marks.append((dict(attrs).get("class") or "").strip())
        elif tag in ("p", "br"):
            self.end_run()
            self.words.append(" ")

    def handle_endtag(self, tag):
        if tag in ("b", "strong"):
            self.bold = max(0, self.bold - 1)
        elif tag in ("i", "em"):
            self.italic = max(0, self.italic - 1)
        elif tag == "u":
            self.underline = max(0, self.underline - 1)
        elif tag == "mark":
            if self.marks:
                self.marks.pop()
        elif tag == "p":
            self.end_run()
            self.words.append(" ")

    def handle_data(self, data):
        self.words.append(data)
        fmt = self.current_format()
        if self.runs and self.runs[-1][0] == fmt:
            self.runs[-1] = (fmt, self.runs[-1][1] + data)   # stesso formato: unisce
        else:
            self.runs.append((fmt, data))

    def plain_text(self):
        return re.sub(r"\s+", " ", "".join(self.words)).strip()

    def defined_terms(self):
        """Regola DEFINIZIONE: grassetto + corsivo + MAIUSCOLO + verde,
        senza sottolineato."""
        terms = []
        for fmt, text in self.runs:
            if fmt is None:
                continue
            bold, italic, underline, mark = fmt
            term = text.strip()
            if bold and italic and not underline and mark == "green" and is_all_caps(term):
                terms.append(term)
        return terms

    def paragraphs(self):
        """I tratti divisi per paragrafo (o per a capo)."""
        pars, cur = [], []
        for fmt, text in self.runs:
            if fmt is None:
                if cur:
                    pars.append(cur)
                cur = []
            else:
                cur.append((fmt, text))
        if cur:
            pars.append(cur)
        return pars

    def genres(self):
        """Regola GENERE: grassetto + corsivo + MAIUSCOLO, senza sottolineato.
        Con evidenziazione verde = genere NATIVO, senza colore = genere CITATO
        (nativo di altri luoghi). Restituisce [(termine, nativo), ...]."""
        found = []
        for fmt, text in self.runs:
            if fmt is None:
                continue
            bold, italic, underline, mark = fmt
            term = text.strip().strip(",;:.()").strip()
            if bold and italic and not underline and mark in (None, "green") and is_all_caps(term):
                found.append((term, mark == "green"))
        return found


def read_page(file_path):
    reader = PageReader()
    reader.feed(file_path.read_text(encoding="utf-8-sig"))
    reader.close()
    return reader


# ------------------------------------------------------------
#  LETTURA DELLE CARTELLE
# ------------------------------------------------------------
def scan_folder(folder, rel_path, pages_in_order):
    """Restituisce il nodo della cartella, oppure None se non contiene pagine
    (le cartelle vuote non vanno online su GitHub, quindi non le mostriamo)."""
    entries = [e for e in folder.iterdir() if not e.name.startswith(".")]
    subfolders = sorted([e for e in entries if e.is_dir()], key=lambda e: sort_key(e.name))
    files = sorted([e for e in entries if e.is_file()
                    and e.suffix.lower() in PAGE_EXTENSIONS], key=lambda e: sort_key(e.name))

    children = []
    for sub in subfolders:
        if sub.name.upper() == OLD_PEOPLES_FOLDER:
            SKIPPED_FOLDERS.append(rel_path + "/" + sub.name)
            continue
        node = scan_folder(sub, rel_path + "/" + sub.name, pages_in_order)
        if node:
            children.append(node)
    for f in files:
        node = {"type": "page", "name": f.name, "title": page_title(f.name),
                "path": rel_path + "/" + f.name}
        children.append(node)
        pages_in_order.append((node, f))

    if not children:
        return None
    return {"type": "folder", "name": folder.name, "title": folder.name,
            "path": rel_path, "children": children}


# ------------------------------------------------------------
#  MAPPA
#  Continenti = cartelle dentro World con il nome di un continente
#  Zone       = sottocartelle di un continente (tranne INSTRUMENTS e PEOPLES)
#  Pagine dei paesi = pagine direttamente dentro una zona
#                     (tranne la pagina di presentazione della zona)
# ------------------------------------------------------------
def map_contents(tree, world, config, geo_names):
    """Restituisce (info per la mappa, pagine di paesi non riconosciute)."""
    special = {s.upper() for s in SPECIAL_FOLDERS}
    not_countries = {geo_key(n) for n in (config.get("notCountries") or [])}
    continents_cfg = config.get("continents") or {}
    zones_cfg = config.get("zones") or {}
    ne_continents = {c["c"].lower() for c in world["countries"]}
    codes = {c["a"] for c in world["countries"]}

    info = {"continents": [], "zones": [], "countryPages": {}}
    unknown = []
    folders = lambda n: [c for c in n["children"]
                         if c["type"] == "folder" and c["name"].upper() not in special]
    for cont in folders(tree):
        wanted = [x.lower() for x in continents_cfg.get(cont["name"], [cont["name"]])]
        if not any(w in ne_continents for w in wanted):
            continue
        info["continents"].append(cont["path"])
        for zone in folders(cont):
            listed = [z for z in zones_cfg.get(zone["name"], [])
                      if z in codes or geo_key(z) in geo_names]
            has_countries = bool(listed)
            for p in zone["children"]:
                if p["type"] != "page" or p["title"].lower() == zone["name"].lower():
                    continue
                key = geo_key(p["title"])
                if key in not_countries:
                    continue
                code = geo_names.get(key)
                if code:
                    info["countryPages"][p["path"]] = code
                    has_countries = True
                else:
                    unknown.append(p)
            if has_countries:
                info["zones"].append(zone["path"])
    return info, unknown


# ------------------------------------------------------------
#  PROGRAMMA
# ------------------------------------------------------------
def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    root = SITE_DIR / ROOT_FOLDER
    if not root.is_dir():
        print(f"ERRORE: non trovo la cartella {ROOT_FOLDER} accanto a _build_index.py")
        return 1

    pages = []                       # nell'ordine del menu
    tree = scan_folder(root, ROOT_FOLDER, pages)
    if not tree:
        print(f"ERRORE: la cartella {ROOT_FOLDER} non contiene pagine")
        return 1

    # Ordine del menu = cartelle prima delle pagine, a ogni livello.
    # Serve per scegliere la "prima" definizione di un termine.
    order = []
    def walk(node):
        for ch in node["children"]:
            if ch["type"] == "folder":
                walk(ch)
        for ch in node["children"]:
            if ch["type"] == "page":
                order.append(ch["path"])
    walk(tree)
    position = {p: i for i, p in enumerate(order)}
    pages.sort(key=lambda item: position[item[0]["path"]])

    search = []
    readers = []        # (pagina, lettore): servono anche agli strumenti
    definitions = {}
    genres = {}         # genere -> {"term", "native": {pagina: volte}, "cited": {pagina: volte}}
    errors = []
    for node, file_path in pages:
        try:
            reader = read_page(file_path)
        except Exception as e:
            errors.append(f"{node['path']}: {e}")
            continue
        readers.append((node, reader))
        search.append({"path": node["path"], "title": node["title"],
                       "text": reader.plain_text()})
        for term, native in reader.genres():
            g = genres.setdefault(normalize_key(term), {"term": term, "native": {}, "cited": {}})
            side = g["native"] if native else g["cited"]
            side[node["path"]] = side.get(node["path"], 0) + 1
            if native and not g.get("_named"):
                g["term"] = term; g["_named"] = True      # il nome come scritto dove e' nativo
        for term in reader.defined_terms():
            key = normalize_key(term)
            if key not in definitions:          # vale la prima nell'ordine del menu
                definitions[key] = {"term": term, "path": node["path"]}

    # --- Nomi dei paesi per la mappa (nome o alias -> codice del paese) ---
    geo_names = {}
    world = None
    config = {}
    world_file = SITE_DIR / MAP_WORLD
    if world_file.is_file():
        world = json.loads(world_file.read_text(encoding="utf-8"))
        for c in world["countries"]:
            for n in [c["n"]] + c.get("alt", []):
                geo_names.setdefault(geo_key(n), c["a"])
        config_file = SITE_DIR / MAP_CONFIG
        if config_file.is_file():
            try:
                config = json.loads(config_file.read_text(encoding="utf-8-sig"))
            except ValueError as e:
                print(f"ATTENZIONE, {MAP_CONFIG} ha un errore di scrittura "
                      f"(riga {getattr(e, 'lineno', '?')}): alias e zone ignorati.")
                print("  Di solito e' una virgola mancante o in piu', o una virgoletta.")
                config = {}
            for alias, code in (config.get("aliases") or {}).items():
                geo_names[geo_key(alias)] = code       # gli alias scritti a mano vincono

    # --- Cosa compare sulla mappa: continenti, zone, pagine dei paesi ---
    map_info, unknown_pages = (map_contents(tree, world, config, geo_names)
                               if world else (None, []))

    # --- Strumenti (dizionario, pagine, immagini): _build_instruments.py ---
    instruments, instruments_summary = None, []
    try:
        import _build_instruments
        instruments, instruments_summary = _build_instruments.build(
            SITE_DIR, readers, normalize_key, is_all_caps)
    except ImportError:
        instruments_summary = ["ATTENZIONE: manca _build_instruments.py accanto a "
                               "_build_index.py: strumenti saltati."]
    except Exception as e:
        instruments_summary = [f"ATTENZIONE, strumenti non preparati per un errore: {e}"]

    # --- Popoli (dizionario, schede, controllo): _build_peoples.py ---
    peoples, peoples_summary = None, []
    try:
        import _build_peoples
        peoples, peoples_summary = _build_peoples.build(
            SITE_DIR, readers, normalize_key, is_all_caps, read_page,
            geo_key, geo_names, (map_info or {}).get("countryPages", {}))
    except ImportError as e:
        peoples_summary = [f"ATTENZIONE: popoli saltati: {e}"]
    except Exception as e:
        peoples_summary = [f"ATTENZIONE, popoli non preparati per un errore: {e}"]

    # Schede dei popoli: le loro definizioni e i loro generi valgono come quelli delle
    # pagine (dopo le pagine: a parita' di termine vince la pagina). "go to" apre la scheda.
    for it in ((peoples or {}).get("items") or {}).values():
        if not it.get("page"):
            continue
        try:
            reader = read_page(SITE_DIR / it["page"])
        except Exception:
            continue
        for term, native in reader.genres():
            g = genres.setdefault(normalize_key(term), {"term": term, "native": {}, "cited": {}})
            side = g["native"] if native else g["cited"]
            side[it["page"]] = side.get(it["page"], 0) + 1
            if native and not g.get("_named"):
                g["term"] = term; g["_named"] = True
        for term in reader.defined_terms():
            definitions.setdefault(normalize_key(term), {"term": term, "path": it["page"]})

    data = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "tree": tree,
        "search": search,
        "definitions": definitions,
        "peoples": peoples,
        "genres": genres,
        "geoNames": geo_names,
        "map": map_info,
        "instruments": instruments,
    }
    out = SITE_DIR / OUTPUT_FILE
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Pagine lette:        {len(search)}")
    print(f"Termini definiti:    {len(definitions)}")
    for g in genres.values():
        g.pop("_named", None)
    native_n = sum(1 for g in genres.values() if g["native"])
    print(f"Generi:              {len(genres)} ({native_n} nativi, {len(genres) - native_n} solo citati)")
    for line in instruments_summary + peoples_summary:
        print(line)
    if SKIPPED_FOLDERS:
        print("ATTENZIONE, vecchie cartelle PEOPLES dentro World: non vanno piu' sul sito")
        print("(i popoli ora hanno le schede nella cartella PEOPLES accanto a World).")
        print("Quando hai spostato i loro testi nelle schede, cancellale:")
        for f in SKIPPED_FOLDERS:
            print(f"  {f}")
    if unknown_pages:
        print("ATTENZIONE, pagine di paesi che la mappa non riconosce")
        print("(aggiungi un alias in " + MAP_CONFIG + ", oppure, se non e' un paese,")
        print(" scrivi il nome nell'elenco \"notCountries\"):")
        for p in unknown_pages:
            print(f"  {p['path']}  ->  \"{p['title']}\"")
    for e in errors:
        print(f"ATTENZIONE, pagina non letta: {e}")
    print(f"Scritto {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
