# -*- coding: utf-8 -*-
"""
MUSICAL ATLAS - _build_index.py

Rilegge la cartella World e scrive  atlas-index.json  con queste parti:
  - "tree"        l'albero del menu (cartelle e pagine)
  - "search"      il testo semplice di ogni pagina, per la ricerca
  - "definitions" i termini definiti -> pagina che li definisce
  - "peoples"     i popoli delle cartelle PEOPLES -> pagina e paesi
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
PEOPLES_FOLDER = "PEOPLES"           # cartelle dove si leggono i popoli
SPECIAL_FOLDERS = ("INSTRUMENTS", "PEOPLES")   # come in app.js: non sono zone


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

    def people_marks(self):
        """Popoli evidenziati in giallo in QUALSIASI pagina (grassetto + sottolineato
        + MAIUSCOLO + giallo): dicono dove il popolo e' nativo. Restituisce [nome, ...]."""
        found = []
        for fmt, text in self.runs:
            if fmt is None:
                continue
            bold, italic, underline, mark = fmt
            t = text.strip().strip(",;:.()").strip()
            if bold and underline and not italic and mark == "yellow" and is_all_caps(t):
                found.append(t)
        return found

    def peoples(self):
        """Regola POPOLO: giallo + grassetto + sottolineato + MAIUSCOLO.
        Regola PAESI DEL POPOLO: un paragrafo fatto solo di nomi in grassetto
        separati da ; o , (es.  Benin; Nigeria) appartiene ai popoli
        del paragrafo con popoli piu' vicino sopra di lui.
        Restituisce [(popolo, [paesi]), ...] (paesi vuoto se non ha elenco)."""
        found = {}                 # popolo -> elenco paesi (ordine di lettura)
        waiting = []               # popoli dell'ultimo paragrafo con popoli
        for par in self.paragraphs():
            names = []
            for (bold, italic, underline, mark), text in par:
                t = text.strip().strip(",;:.").strip()
                if bold and underline and not italic and mark == "yellow" and is_all_caps(t):
                    names.append(t)
            if names:
                for n in names:
                    found.setdefault(n, [])
                waiting = names
                continue
            countries = country_list(par)
            if countries and waiting:
                for n in waiting:
                    for c in countries:
                        if c not in found[n]:
                            found[n].append(c)
                waiting = []
        return list(found.items())


def country_list(par):
    """Se il paragrafo e' solo un elenco di nomi in grassetto separati da ; o ,
    restituisce i nomi, altrimenti []."""
    names = []
    for (bold, italic, underline, mark), text in par:
        if bold and not italic and not underline and not mark:
            for piece in re.split(r"[;,]", text):
                piece = piece.strip()
                if piece:
                    names.append(piece)
        elif text.strip(" \t\n ;,."):
            return []                       # c'e' altro testo: non e' un elenco
    return names


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
    people_pages = {}   # popolo -> {pagina: volte in giallo}
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
        for name in reader.people_marks():
            pp = people_pages.setdefault(normalize_key(name), {})
            pp[node["path"]] = pp.get(node["path"], 0) + 1
        for term in reader.defined_terms():
            key = normalize_key(term)
            if key not in definitions:          # vale la prima nell'ordine del menu
                definitions[key] = {"term": term, "path": node["path"]}

    # --- Popoli (solo dalle pagine dentro le cartelle PEOPLES) ---
    peoples = {}
    for node, file_path in pages:
        if PEOPLES_FOLDER.upper() not in [p.upper() for p in node["path"].split("/")[:-1]]:
            continue
        try:
            found = read_page(file_path).peoples()
        except Exception:
            continue
        for name, countries in found:
            key = normalize_key(name)
            if key not in peoples:
                peoples[key] = {"name": name, "path": node["path"], "countries": countries}
            else:
                for c in countries:
                    if c not in peoples[key]["countries"]:
                        peoples[key]["countries"].append(c)

    # pagine dove ogni popolo e' evidenziato in giallo (per la mappa: dove e' nativo)
    for key, p in peoples.items():
        p["pages"] = people_pages.get(key, {})

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
    with_countries = [p for p in peoples.values() if p["countries"]]
    print(f"Popoli:              {len(peoples)} ({len(with_countries)} con elenco dei paesi)")
    no_list = [p["name"] for p in peoples.values() if not p["countries"]]
    if no_list:
        print("  senza elenco dei paesi (sulla mappa non hanno alone): " + ", ".join(no_list))
    if geo_names:
        unknown = sorted({c for p in peoples.values() for c in p["countries"]
                          if geo_key(c) not in geo_names})
        if unknown:
            print("  ATTENZIONE, paesi non riconosciuti dalla mappa "
                  "(aggiungili agli alias di " + MAP_CONFIG + "): " + ", ".join(unknown))
    for line in instruments_summary:
        print(line)
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
