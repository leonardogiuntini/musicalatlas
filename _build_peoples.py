# -*- coding: utf-8 -*-
"""
MUSICAL ATLAS - _build_peoples.py

Lo richiama _build_index.py (non va lanciato a mano). Fa tre cose:

  1. legge il dizionario   PEOPLES/_PEOPLES.csv
     e le schede           PEOPLES/NOME.html  (una pagina per popolo)
  2. legge le pagine di World: popolo = MAIUSCOLO + grassetto + sottolineato
     (senza corsivo). Con evidenziazione gialla = "nativo qui",
     senza colore = CITATO.
  3. restituisce i dati per atlas-index.json (parte "peoples")
     e scrive il file di controllo  PEOPLES/_CONTROLLO_PEOPLES.csv

Dove un popolo e' NATIVO lo dice la colonna COUNTRIES (non il giallo):
  nativo  = pagine dei paesi della colonna COUNTRIES (anche se il testo non lo cita)
  citato  = tutte le altre pagine dove compare (giallo o senza colore)
Il giallo nelle pagine serve da verifica: se un popolo e' giallo nella pagina
di un paese che non e' nella sua lista, il controllo lo segnala.

Colonne del CSV, riconosciute dal NOME dell'intestazione (non dalla posizione):
  NAME          nome del popolo (= nome del file della scheda, senza .html)
  ALIASES       nomi alternativi, separati da  /
  COUNTRIES     paesi dove il popolo e' presente, separati da  /
                (valgono anche gli alias dei paesi di map/map-config.json)
  SOURCE        fonti
  _QUALSIASI    le colonne che iniziano con _ sono private: non vanno sul sito
  tutte le altre, da sinistra a destra = livelli della gerarchia (gruppi).
                La prima cella vuota chiude il ramo.
Piu' righe con lo stesso NAME = il popolo sta in piu' gruppi.

GRUPPI DI POPOLI (es. MANDE): un ramo della gerarchia che ha lo stesso nome di un
popolo del CSV E' quel popolo (come la pagina di presentazione di una cartella).
  - i sotto-popoli hanno il gruppo nel loro percorso (es. LEVEL 1 = MANDE);
  - la riga del gruppo dice dove sta il gruppo (LEVEL vuoto = da nessuna parte);
  - scheda del sotto-popolo: "Part of MANDE peoples"; scheda del gruppo:
    "Includes ..." (i sotto-popoli nell'ordine del CSV);
  - COUNTRIES vuota nel gruppo = unione dei paesi dei sotto-popoli.
"""

import csv
import io
import re
from pathlib import Path

from _build_instruments import clean_token, split_names, format_label, around

# ------------------------------------------------------------
#  IMPOSTAZIONI
# ------------------------------------------------------------
FOLDER = "PEOPLES"                           # cartella nella home del sito
CSV_FILE = "_PEOPLES.csv"                    # il dizionario (lo compili tu)
CONTROL_FILE = "_CONTROLLO_PEOPLES.csv"      # creato a ogni anteprima
PAGE_EXTENSIONS = (".html", ".htm")

NATIVE_COLOR = "yellow"                      # evidenziazione = nativo qui
SPECIAL_COLUMNS = ("NAME", "ALIASES", "COUNTRIES", "SOURCE")

# Ordine dei tipi nel file di controllo (i problemi prima, le informazioni dopo)
CONTROL_TYPES = [
    "CSV",                       # problemi di lettura del dizionario
    "ALIAS DOPPIO",
    "GERARCHIA CON BUCHI",
    "SENZA SCHEDA",              # citato nei testi ma non nel CSV
    "FORMATTAZIONE ANOMALA",
    "SENZA FORMATTAZIONE",
    "SENZA PAGINA",              # riga nel CSV, ma manca PEOPLES/NOME.html
    "PAGINA SENZA RIGA",         # PEOPLES/NOME.html senza riga nel CSV
    "PAGINA VUOTA",
    "TESTO UGUALE",              # due o piu' schede con lo stesso testo (es. MOSSI e BARIBA)
    "SENZA PAESI",
    "PAESE SCONOSCIUTO",
    "GIALLO FUORI PATRIA",
    "MAI CITATO",
    "PAESE SENZA PAGINA",
    "PIU' GRUPPI",
    "VALORI GERARCHIA",
    "PATRIE",
]
FIRST_INFO = "MAI CITATO"        # da qui in giu' sono informazioni, non problemi


# ------------------------------------------------------------
#  1. DIZIONARIO E SCHEDE
# ------------------------------------------------------------
def read_csv_rows(path, report):
    """Legge il CSV con punto e virgola o virgola, UTF-8 (con o senza BOM)
    o la codifica di Windows. Restituisce (intestazioni, righe)."""
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
        report("CSV", "", CSV_FILE, "non e' in UTF-8: letto con la codifica di Windows. "
               "Salvalo come UTF-8 per non rischiare accenti sbagliati.")
    first_line = text.split("\n", 1)[0]
    delimiter = ";" if first_line.count(";") >= first_line.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    if not rows:
        return [], []
    return [h.strip().upper() for h in rows[0]], rows[1:]


def split_slash(text):
    return [x.strip() for x in text.split("/") if x.strip()]


def read_dictionary(csv_path, normalize_key, report):
    """Restituisce (popoli, nomi, livelli).
    popoli: chiave -> dati;  nomi: chiave di nome o alias -> chiave del popolo."""
    headers, rows = read_csv_rows(csv_path, report)
    if "NAME" not in headers:
        report("CSV", "", CSV_FILE, "manca la colonna NAME nella prima riga: dizionario ignorato.")
        return {}, {}, []
    col = {h: i for i, h in enumerate(headers) if h}
    levels = [h for h in headers if h and h not in SPECIAL_COLUMNS and not h.startswith("_")]
    level_idx = [i for i, h in enumerate(headers) if h in levels]

    def cell(row, name):
        i = col.get(name)
        return row[i].strip() if i is not None and i < len(row) else ""

    items = {}
    for n, row in enumerate(rows, start=2):           # n = numero di riga in LibreOffice
        name = cell(row, "NAME")
        if not name:
            if any(c.strip() for c in row):
                report("CSV", "", f"riga {n}", "riga senza NAME: ignorata.")
            continue
        key = normalize_key(name)
        values = [row[i].strip() if i < len(row) else "" for i in level_idx]
        path = []
        for v in values:
            if not v:
                break
            path.append(v)
        if any(values[len(path):]):
            report("GERARCHIA CON BUCHI", name, f"riga {n}",
                   "c'e' una cella vuota in mezzo alla gerarchia: il ramo si ferma prima del buco.")
        it = items.setdefault(key, {"name": name, "aliases": [], "countries": [],
                                    "source": "", "paths": [], "_rows": []})
        it["_rows"].append(n)
        if path and path not in it["paths"]:
            it["paths"].append(path)
        for field, values in (("aliases", split_slash(cell(row, "ALIASES"))),
                              ("countries", split_slash(cell(row, "COUNTRIES")))):
            for v in values:
                if v not in it[field]:
                    it[field].append(v)
        if cell(row, "SOURCE") and not it["source"]:
            it["source"] = cell(row, "SOURCE")

    names = {k: k for k in items}
    for key, it in items.items():
        if len(it["paths"]) > 1:
            report("PIU' GRUPPI", it["name"], "righe " + ", ".join(map(str, it["_rows"])),
                   " | ".join(" > ".join(p) for p in it["paths"]))
        for a in it["aliases"]:
            ak = normalize_key(a)
            if ak == key:
                continue
            if ak in names and names[ak] != key:
                other = items[names[ak]]["name"]
                report("ALIAS DOPPIO", it["name"], "",
                       f"'{a}' e' gia' il nome o un alias di {other}: ignorato qui.")
                continue
            names[ak] = key
    return items, names, levels


def read_cards(folder, items, names, normalize_key, read_page, report):
    """Abbina le pagine PEOPLES/NOME.html ai popoli.
    Restituisce [(nodo finto, lettore), ...] per cercare le citazioni dentro le schede."""
    readers = []
    for f in sorted(folder.iterdir(), key=lambda p: p.name.casefold()):
        if not f.is_file() or f.suffix.lower() not in PAGE_EXTENSIONS or f.name.startswith("_"):
            continue
        k = normalize_key(f.stem)
        try:
            reader = read_page(f)
        except Exception as e:
            report("CSV", f.stem, f.name, f"pagina non letta: {e}")
            continue
        node = {"path": f"{FOLDER}/{f.name}", "title": f.stem + " (scheda)"}
        readers.append((node, reader))
        if k not in items:
            target = names.get(k)
            hint = (f"e' un alias di {items[target]['name']}: rinominala "
                    f"{items[target]['name']}{f.suffix}") if target else "nessun popolo con questo NAME nel CSV"
            report("PAGINA SENZA RIGA", f.stem, f.name, hint)
            continue
        items[k]["page"] = node["path"]
        if not reader.plain_text():
            report("PAGINA VUOTA", items[k]["name"], f.name, "la scheda non ha testo.")
    return readers


# ------------------------------------------------------------
#  2. PAGINE
# ------------------------------------------------------------
def read_mentions(page_readers, card_readers, items, names, normalize_key, is_all_caps, report):
    """Conta per ogni popolo le pagine di World dove e' giallo e dove e' senza colore.
    Nelle schede cerca solo le citazioni senza scheda e la formattazione."""
    for it in items.values():
        it["yellow"], it["plain"] = {}, {}
    word = re.compile(r"[^\W\d_][\w'’\-]*[^\W_]|[^\W\d_]{2,}", re.UNICODE)

    for is_card, readers in ((False, page_readers), (True, card_readers)):
        for node, reader in readers:
            page, title = node["path"], node["title"]
            for par in reader.paragraphs():
                full = "".join(t for _, t in par)
                for (bold, italic, underline, mark), text in par:
                    if bold and underline:
                        caps = [t for t in split_names(text) if is_all_caps(t)]
                        if len(caps) > 1:
                            report("FORMATTAZIONE ANOMALA", " ; ".join(caps), title,
                                   "piu' nomi nella stessa formattazione: sul sito diventano una sola parola "
                                   "cliccabile. Lascia ; , / fuori dalla formattazione. Frase: " + around(full, caps[0]))
                        for token in split_names(text):
                            if not is_all_caps(token):
                                continue                 # Aa = artista: non riguarda i popoli
                            key = names.get(normalize_key(token))
                            exact = not italic and mark in (None, NATIVE_COLOR)
                            if exact and key:
                                if not is_card:
                                    side = "yellow" if mark == NATIVE_COLOR else "plain"
                                    items[key][side][page] = items[key][side].get(page, 0) + 1
                            elif exact:
                                report("SENZA SCHEDA", token, title, "Frase: " + around(full, token))
                            else:
                                report("FORMATTAZIONE ANOMALA", token, title,
                                       f"scritto {format_label(bold, italic, underline, mark)}: "
                                       f"un popolo e' grassetto + sottolineato + MAIUSCOLO "
                                       f"(+ giallo se nativo). Frase: {around(full, token)}")
                    elif not (bold or italic or underline):
                        for w in word.findall(text):
                            if is_all_caps(w) and normalize_key(w) in names:
                                report("SENZA FORMATTAZIONE", w, title, f"Frase: {around(full, w)}")
                    else:
                        token = clean_token(text)
                        if is_all_caps(token) and names.get(normalize_key(token)):
                            report("FORMATTAZIONE ANOMALA", token, title,
                                   f"scritto {format_label(bold, italic, underline, mark)}. "
                                   f"Frase: {around(full, token)}")


# ------------------------------------------------------------
#  3. FILE DI CONTROLLO
# ------------------------------------------------------------
def write_control(path, entries):
    order = {t: i for i, t in enumerate(CONTROL_TYPES)}
    entries.sort(key=lambda e: (order.get(e[0], 99), e[1].casefold(), e[2].casefold()))
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\r\n")
        w.writerow(["TIPO", "POPOLO", "PAGINA / FILE", "DETTAGLIO"])
        w.writerows(entries)


# ------------------------------------------------------------
#  PROGRAMMA (lo chiama _build_index.py)
# ------------------------------------------------------------
def build(site_dir, page_readers, normalize_key, is_all_caps, read_page,
          geo_key, geo_names, country_pages):
    """page_readers:  [(nodo della pagina, lettore), ...] delle pagine di World
    geo_names:     nome o alias di un paese -> codice (come per la mappa)
    country_pages: pagina di World -> codice del paese (le pagine dei paesi)
    Restituisce (dati leggeri, righe del riassunto), oppure (None, righe)."""
    folder = Path(site_dir) / FOLDER
    csv_path = folder / CSV_FILE
    if not csv_path.is_file():
        return None, [f"Popoli:              nessun dizionario ({FOLDER}/{CSV_FILE}): saltati"]

    entries, seen = [], set()
    def report(kind, name, where, detail):
        row = (kind, name, where, detail)
        if row not in seen:                              # niente righe identiche ripetute
            seen.add(row)
            entries.append(list(row))

    items, names, levels = read_dictionary(csv_path, normalize_key, report)
    for it in items.values():
        it["page"] = None
    card_readers = read_cards(folder, items, names, normalize_key, read_page, report)
    read_mentions(page_readers, card_readers, items, names, normalize_key, is_all_caps, report)

    # Schede con lo stesso testo (es. MOSSI e BARIBA, da separare in futuro)
    same_text = {}
    for node, reader in card_readers:
        text = reader.plain_text()
        if text:
            same_text.setdefault(text, []).append(node["path"].split("/")[-1])
    for files in same_text.values():
        if len(files) > 1:
            for f in files:
                others = [x for x in files if x != f]
                report("TESTO UGUALE", f.rsplit(".", 1)[0], f,
                       "stesso testo di " + ", ".join(others) + ": da scrivere separato quando vuoi.")

    # --- Gruppi: un ramo con lo stesso nome di un popolo E' quel popolo ---
    is_people = lambda v: names.get(normalize_key(v))
    for it in items.values():
        it["partOf"], it["includes"], it["fromMembers"] = [], [], False
    for key, it in items.items():                        # nell'ordine del CSV
        for path in it["paths"]:
            parents = [k for k in map(is_people, path) if k and k != key]
            if parents and parents[-1] not in it["partOf"]:
                g = parents[-1]                          # il gruppo piu' vicino
                it["partOf"].append(g)
                items[g]["includes"].append(key)
    # rami che non sono popoli: restano come riga piccola in fondo alla scheda
    for it in items.values():
        it["otherPaths"] = []
        for path in it["paths"]:
            rest = [v for v in path if not is_people(v)]
            if rest and rest not in it["otherPaths"]:
                it["otherPaths"].append(rest)
    # COUNTRIES vuota in un gruppo: unione dei paesi dei sotto-popoli (anche su piu' livelli)
    def member_countries(key, seen):
        it = items[key]
        if it["countries"] or key in seen:
            return it["countries"]
        out, keys = [], set()
        for m in it["includes"]:
            for c in member_countries(m, seen | {key}):
                if geo_key(c) not in keys:
                    keys.add(geo_key(c)); out.append(c)
        return out
    for key, it in items.items():
        if not it["countries"] and it["includes"]:
            it["countries"] = member_countries(key, set())
            it["fromMembers"] = True

    titles = {node["path"]: node["title"] for node, _ in page_readers}
    pages_of = {}                                        # codice del paese -> pagine
    for p, code in (country_pages or {}).items():
        pages_of.setdefault(code, []).append(p)
    pages_text = lambda d: "; ".join(sorted((titles.get(p, p) for p in d), key=str.casefold))

    level_values = {}
    for key, it in items.items():
        if not it["page"]:
            report("SENZA PAGINA", it["name"], f"{FOLDER}/{it['name']}.html",
                   "manca la scheda: creala con _editor.html, con lo stesso nome del popolo.")
        # Paesi -> codici -> pagine del sito
        codes, it["native"], countries = set(), {}, []
        mentions = dict(it["plain"])                     # tutte le volte che compare, per pagina
        for p, n in it["yellow"].items():
            mentions[p] = mentions.get(p, 0) + n
        if not it["countries"]:
            report("SENZA PAESI", it["name"], "", "colonna COUNTRIES vuota: sulla mappa non compare.")
        for c in it["countries"]:
            code = geo_names.get(geo_key(c))
            here = pages_of.get(code, []) if code else []
            countries.append({"name": c, "page": here[0] if here else None})
            if not code:
                report("PAESE SCONOSCIUTO", it["name"], c,
                       "ne' l'atlante ne' gli alias di map/map-config.json conoscono questo nome.")
                continue
            codes.add(code)
            if not here:
                report("PAESE SENZA PAGINA", it["name"], c, "il paese non ha ancora una pagina nell'atlante.")
            for p in here:
                it["native"][p] = mentions.get(p, 0)
        it["codes"] = sorted(codes)
        it["cited"] = {p: n for p, n in mentions.items() if p not in it["native"]}
        it["countryList"] = countries
        # Giallo nella pagina di un paese che non e' nella lista
        for p in it["yellow"]:
            code = (country_pages or {}).get(p)
            if code and code not in codes:
                report("GIALLO FUORI PATRIA", it["name"], titles.get(p, p),
                       "e' giallo in questa pagina, ma il paese non e' nella colonna COUNTRIES.")
        if not mentions:
            report("MAI CITATO", it["name"], "", "e' nel CSV ma non compare in nessuna pagina di World.")
        report("PATRIE", it["name"], ("; ".join(it["countries"]) or "-")
               + (" (dai sotto-popoli)" if it["fromMembers"] else ""),
               "giallo in: " + (pages_text(it["yellow"]) or "-")
               + " | senza colore in: " + (pages_text(it["plain"]) or "-"))
        for p in it["paths"]:
            for i in range(1, len(p) + 1):
                level_values.setdefault(" > ".join(p[:i]), set()).add(it["name"])
    for value, members in level_values.items():
        group = is_people(value.split(" > ")[-1])
        report("VALORI GERARCHIA", value,
               f"{len(members)} popol" + ("o" if len(members) == 1 else "i"),
               (f"e' un popolo: ha la scheda {items[group]['name']}. " if group else "")
               + ", ".join(sorted(members, key=str.casefold)))

    # --- dati per atlas-index.json (parte "peoples") ---
    public = {}
    for key, it in sorted(items.items(), key=lambda kv: kv[1]["name"].casefold()):
        public[key] = {"name": it["name"], "aliases": it["aliases"], "countries": it["countryList"],
                       "codes": it["codes"], "source": it["source"], "paths": it["otherPaths"],
                       "partOf": it["partOf"], "includes": it["includes"],
                       "page": it["page"], "native": it["native"], "cited": it["cited"]}
    data = {"levels": levels, "names": names, "items": public}

    # --- file di controllo ---
    problems = sum(1 for e in entries if CONTROL_TYPES.index(e[0]) < CONTROL_TYPES.index(FIRST_INFO))
    try:
        write_control(folder / CONTROL_FILE, entries)
        control_msg = f"{FOLDER}/{CONTROL_FILE}"
    except PermissionError:
        control_msg = f"NON aggiornato: chiudi {CONTROL_FILE} (e' aperto in un altro programma)"

    with_page = sum(1 for it in items.values() if it["page"])
    cited = sum(1 for it in items.values() if it["yellow"] or it["plain"])
    summary = [f"Popoli:              {len(items)} nel dizionario, {with_page} con scheda, "
               f"{cited} citati nelle pagine",
               f"  segnalazioni da guardare: {problems}  ->  {control_msg}"]
    return data, summary
