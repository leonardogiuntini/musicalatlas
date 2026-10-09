# -*- coding: utf-8 -*-
"""
MUSICAL ATLAS - _build_instruments.py

Lo richiama _build_index.py (non va lanciato a mano). Fa quattro cose:

  1. legge il dizionario   INSTRUMENTS/_INSTRUMENTS.csv
  2. legge le pagine: strumento = MAIUSCOLO + corsivo (senza grassetto,
     senza sottolineato). Con evidenziazione azzurra = NATIVO della pagina,
     senza colore = CITATO (nativo altrove).
  3. prepara le immagini: dagli originali in INSTRUMENTS/ crea in
     INSTRUMENTS/web/ una miniatura e un'immagine per la scheda (WebP,
     senza metadati). Rifà solo quelle nuove o cambiate.
  4. scrive  instruments.json  (tutti i dati, il sito lo carica quando serve)
     e il file di controllo  INSTRUMENTS/_CONTROLLO_INSTRUMENTS.csv

Colonne del CSV, riconosciute dal NOME dell'intestazione (non dalla posizione):
  NAME          nome dello strumento (= nome del file dell'immagine)
  ALIASES       nomi alternativi, separati da  /
  DESCRIPTION   descrizione
  SOURCE        fonte dell'immagine
  _QUALSIASI    le colonne che iniziano con _ sono private: non vanno sul sito
  tutte le altre, da sinistra a destra = livelli della gerarchia.
                La prima cella vuota chiude il ramo.
Piu' righe con lo stesso NAME = piu' rami: lo strumento finisce in tutti
e anche nel ramo HYBRIDS, che si crea da solo.
"""

import csv
import importlib
import io
import json
import re
import site
import subprocess
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

# ------------------------------------------------------------
#  IMPOSTAZIONI
# ------------------------------------------------------------
FOLDER = "INSTRUMENTS"                       # cartella nella home del sito
CSV_FILE = "_INSTRUMENTS.csv"                # il dizionario (lo compili tu)
CONTROL_FILE = "_CONTROLLO_INSTRUMENTS.csv"  # creato a ogni anteprima
WEB_FOLDER = "web"                           # copie per il sito (non toccarla)
OUTPUT_FILE = "instruments.json"             # nella home del sito, accanto ad atlas-index.json

HYBRIDS = "HYBRIDS"                          # ramo creato da solo per gli ibridi
NATIVE_COLOR = "cyan"                        # evidenziazione = nativo

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp")
# immagini che lo script non sa leggere: segnalate nel file di controllo
UNSUPPORTED_EXTENSIONS = (".heic", ".heif", ".avif", ".jxl", ".svg", ".psd", ".raw", ".cr2",
                          ".nef", ".arw", ".dng", ".jfif", ".ico")
THUMB_WIDTH = 400        # miniatura del catalogo: larghezza in pixel
LARGE_SIDE = 1000        # immagine della scheda: lato lungo in pixel
THUMB_QUALITY = 75       # qualita' WebP (0-100)
LARGE_QUALITY = 80
SMALL_ORIGINAL = 800     # originali con lato lungo sotto questa misura: segnalati

SPECIAL_COLUMNS = ("NAME", "ALIASES", "DESCRIPTION", "SOURCE")

# Ordine dei tipi nel file di controllo (i problemi prima, le informazioni dopo)
CONTROL_TYPES = [
    "CSV",                       # problemi di lettura del dizionario
    "NOME DOPPIO",
    "ALIAS DOPPIO",
    "DESCRIZIONI DIVERSE",
    "GERARCHIA CON BUCHI",
    "CITATO MA NON NEL CSV",
    "FORMATTAZIONE ANOMALA",
    "SENZA FORMATTAZIONE",
    "RIGA AGGIUNTA",
    "IMMAGINE SENZA RIGA",
    "FORMATO NON SUPPORTATO",
    "IMMAGINI DOPPIE",
    "IMMAGINE ILLEGGIBILE",
    "IMMAGINE PICCOLA",
    "MAI CITATO",
    "SENZA PATRIA",
    "IMMAGINE MANCANTE",
    "IBRIDO",
    "VALORI GERARCHIA",
    "PATRIE",
    "PESO",
]


# ------------------------------------------------------------
#  TESTI
# ------------------------------------------------------------
def slug(text):
    """Nome di file sicuro per le copie: kora, kamale-ngoni, ..."""
    s = unicodedata.normalize("NFD", str(text))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "senza-nome"


def clean_token(text):
    """Toglie punteggiatura e parentesi ai bordi:  "(MOLO"  ->  "MOLO"."""
    return text.strip().strip("()[]{}.,;:!?\"'“”‘’«»").strip()


def split_names(text):
    """Un tratto puo' contenere piu' nomi:  "KORA; XALAM"  ->  [KORA, XALAM]."""
    return [t for t in (clean_token(p) for p in re.split(r"[;,/]", text)) if t]


def format_label(bold, italic, underline, mark):
    parts = []
    if bold: parts.append("grassetto")
    if italic: parts.append("corsivo")
    if underline: parts.append("sottolineato")
    parts.append("colore " + mark if mark else "senza colore")
    return " + ".join(parts)


def short(text, size=140):
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= size else text[:size - 1] + "…"


def around(text, word, size=120):
    """Il pezzo di frase attorno alla parola, per ritrovarla nella pagina."""
    text = re.sub(r"\s+", " ", text).strip()
    i = text.find(word)
    if i < 0 or len(text) <= size:
        return short(text, size)
    start = max(0, i - size // 2)
    end = min(len(text), start + size)
    start = max(0, end - size)
    return ("…" if start else "") + text[start:end].strip() + ("…" if end < len(text) else "")


# ------------------------------------------------------------
#  1. DIZIONARIO
# ------------------------------------------------------------
def read_csv_rows(path, report):
    """Legge il CSV con punto e virgola o virgola, UTF-8 (con o senza BOM)
    o la codifica di Windows. Restituisce (intestazioni, righe)."""
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if encoding == "cp1252":
        report("CSV", "", CSV_FILE, "non e' in UTF-8: letto con la codifica di Windows. "
               "Salvalo come UTF-8 per non rischiare accenti sbagliati.")
    first_line = text.split("\n", 1)[0]
    delimiter = ";" if first_line.count(";") >= first_line.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    if not rows:
        return [], []
    headers = [h.strip().upper() for h in rows[0]]
    return headers, rows[1:]


def read_dictionary(csv_path, normalize_key, report):
    """Restituisce (strumenti, nomi, livelli).
    strumenti: chiave -> dati;  nomi: chiave di nome o alias -> chiave dello strumento."""
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
        aliases = [a.strip() for a in cell(row, "ALIASES").split("/") if a.strip()]
        desc, source = cell(row, "DESCRIPTION"), cell(row, "SOURCE")

        if key not in items:
            items[key] = {"name": name, "aliases": aliases, "description": desc,
                          "source": source, "paths": [path] if path else [], "_rows": [n]}
            continue
        it = items[key]                                 # stesso nome: un altro ramo
        it["_rows"].append(n)
        if path and path not in it["paths"]:
            it["paths"].append(path)
        for a in aliases:
            if a not in it["aliases"]:
                it["aliases"].append(a)
        for field, value in (("description", desc), ("source", source)):
            if value and not it[field]:
                it[field] = value
            elif value and value != it[field]:
                report("DESCRIZIONI DIVERSE", it["name"], f"righe {it['_rows'][0]} e {n}",
                       f"la colonna {field.upper()} e' diversa: vale quella della prima riga.")

    # Nomi e alias -> strumento
    names = {k: k for k in items}
    for key, it in items.items():
        for a in it["aliases"]:
            ak = normalize_key(a)
            if ak == key:
                continue
            if ak in names and names[ak] != key:
                other = items[names[ak]]["name"]
                report("ALIAS DOPPIO", it["name"], "", f"'{a}' appartiene gia' a {other}: ignorato qui.")
                continue
            names[ak] = key

    # Ibridi: piu' di un ramo -> anche HYBRIDS > famiglie coinvolte
    for it in items.values():
        it["hybrid"] = len(it["paths"]) > 1
        if it["hybrid"]:
            families = sorted({p[0] for p in it["paths"]})
            it["paths"].append([HYBRIDS, " + ".join(families)])
            report("IBRIDO", it["name"], "",
                   " | ".join(" > ".join(p) for p in it["paths"][:-1]))
    return items, names, levels


# ------------------------------------------------------------
#  2. PAGINE
# ------------------------------------------------------------
def read_mentions(page_readers, items, names, normalize_key, is_all_caps, report):
    """Conta per ogni strumento le pagine dove e' nativo e dove e' citato."""
    for it in items.values():
        it["native"], it["cited"] = {}, {}
    word = re.compile(r"[^\W\d_][\w'’\-]*[^\W_]|[^\W\d_]{2,}", re.UNICODE)

    for node, reader in page_readers:
        page, title = node["path"], node["title"]
        for par in reader.paragraphs():
            full = "".join(t for _, t in par)
            for (bold, italic, underline, mark), text in par:
                if italic and not bold:
                    for token in split_names(text):
                        if not is_all_caps(token):
                            continue
                        key = names.get(normalize_key(token))
                        exact = not underline and mark in (None, NATIVE_COLOR)
                        if exact and key:
                            side = "native" if mark == NATIVE_COLOR else "cited"
                            items[key][side][page] = items[key][side].get(page, 0) + 1
                        elif exact:
                            report("CITATO MA NON NEL CSV", token, title,
                                   "Frase: " + around(full, token))
                        else:
                            report("FORMATTAZIONE ANOMALA", token, title,
                                   f"scritto {format_label(bold, italic, underline, mark)}: "
                                   f"uno strumento e' solo corsivo + MAIUSCOLO (+ azzurro se nativo). "
                                   f"Frase: {around(full, token)}")
                elif not (bold or italic or underline):
                    # nome del dizionario scritto senza nessuna formattazione
                    for w in word.findall(text):
                        if is_all_caps(w) and normalize_key(w) in names:
                            report("SENZA FORMATTAZIONE", w, title, f"Frase: {around(full, w)}")
                elif names.get(normalize_key(clean_token(text))) and is_all_caps(clean_token(text)):
                    report("FORMATTAZIONE ANOMALA", clean_token(text), title,
                           f"scritto {format_label(bold, italic, underline, mark)}. "
                           f"Frase: {around(full, clean_token(text))}")


# ------------------------------------------------------------
#  3. IMMAGINI
# ------------------------------------------------------------
def load_pillow():
    """Restituisce il modulo PIL.Image, installando Pillow la prima volta se manca."""
    try:
        from PIL import Image, ImageOps  # noqa: F401
        return True
    except ImportError:
        pass
    print("")
    print("Manca Pillow (serve per preparare le immagini degli strumenti).")
    print("La installo adesso: serve internet, succede solo questa volta...")
    result, error = None, "?"
    # prima solo per il tuo utente; se Python non lo permette, installazione normale
    for extra in (["--user"], []):
        try:
            result = subprocess.run([sys.executable, "-m", "pip", "install", *extra,
                                     "--disable-pip-version-check", "pillow"],
                                    capture_output=True, text=True)
        except Exception as e:
            result, error = None, str(e)
            break
        if result.returncode == 0 or "--user" not in (result.stderr or ""):
            break
    if result is None or result.returncode != 0:
        if result is not None:
            error = (result.stderr or result.stdout or "").strip().splitlines()[-1:] or ["?"]
            error = error[0]
        print("ATTENZIONE: Pillow non installata (" + error + ").")
        print("  Il sito funziona lo stesso, ma le immagini nuove non vengono preparate.")
        print("  Riprovo alla prossima anteprima (controlla di essere connesso a internet).")
        print("")
        return False
    try:
        site.addsitedir(site.getusersitepackages())
        importlib.invalidate_caches()
        from PIL import Image, ImageOps  # noqa: F401
    except Exception:
        print("Pillow installata: sara' attiva dalla prossima anteprima.")
        print("")
        return False
    print("Pillow installata. Fatto, non serve piu' farlo.")
    print("")
    return True


def to_srgb(img):
    """Porta l'immagine in colori sRGB, con o senza trasparenza."""
    from PIL import Image
    icc = img.info.get("icc_profile")
    if icc:
        try:
            from PIL import ImageCms
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            mode = "RGBA" if img.mode in ("RGBA", "LA", "PA") else "RGB"
            img = ImageCms.profileToProfile(img, src, dst, outputMode=mode)
        except Exception:
            pass
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    return img.convert("RGBA" if has_alpha else "RGB")


def make_copies(original, thumb_path, large_path):
    """Crea miniatura e immagine della scheda. Restituisce le misure."""
    from PIL import Image, ImageOps
    with Image.open(original) as img:
        if img.format == "JPEG":
            img.draft("RGB", (LARGE_SIDE * 2, LARGE_SIDE * 2))   # piu' veloce sui JPG enormi
        img = ImageOps.exif_transpose(img)                       # foto girate: raddrizzate
        img = to_srgb(img)
        ow, oh = img.size

        large = img.copy()
        large.thumbnail((LARGE_SIDE, LARGE_SIDE), Image.LANCZOS)  # mai ingrandita
        large.save(large_path, "WEBP", quality=LARGE_QUALITY, method=4)

        tw = min(THUMB_WIDTH, ow)
        th = max(1, round(oh * tw / ow))
        thumb = img.resize((tw, th), Image.LANCZOS) if (tw, th) != (ow, oh) else img.copy()
        thumb.save(thumb_path, "WEBP", quality=THUMB_QUALITY, method=4)
        # niente exif e niente profilo colore nel salvataggio: i metadati spariscono
        return {"w": thumb.width, "h": thumb.height, "lw": large.width, "lh": large.height,
                "ow": ow, "oh": oh}


def add_rows_for_images(folder, csv_path, items, names, normalize_key, report):
    """Per ogni immagine senza riga nel CSV aggiunge in fondo una riga col solo NAME
    (e una nota). Non tocca mai le righe che ci sono. Se il CSV e' aperto in un altro
    programma non lo modifica e lo segnala. Restituisce True se ha aggiunto righe."""
    new = []
    for f in sorted(folder.iterdir()):
        if not f.is_file() or f.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        k = normalize_key(f.stem)
        if k in names or not f.stem.strip():          # c'e' gia' (o e' un nome alternativo)
            continue
        if any(normalize_key(x) == k for x in new):
            continue
        new.append(f.stem.strip().upper())
    if not new:
        return False
    lock = folder / (".~lock." + csv_path.name + "#")   # LibreOffice: il file e' aperto
    if lock.exists():
        for n in new:
            report("IMMAGINE SENZA RIGA", n, csv_path.name,
                   "riga NON aggiunta: chiudi il CSV (e' aperto in un altro programma) e rilancia l'anteprima.")
        return False
    raw = csv_path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:                       # non e' UTF-8: meglio non toccarlo
        for n in new:
            report("IMMAGINE SENZA RIGA", n, csv_path.name,
                   "riga NON aggiunta: salva prima il CSV in UTF-8.")
        return False
    first = text.split("\n", 1)[0]
    delimiter = ";" if first.count(";") >= first.count(",") else ","
    headers = [h.strip().upper() for h in next(csv.reader(io.StringIO(first), delimiter=delimiter))]
    if "NAME" not in headers:
        for n in new:
            report("IMMAGINE SENZA RIGA", n, csv_path.name,
                   "riga NON aggiunta: nella prima riga del CSV manca la colonna NAME.")
        return False
    note_col = "_NOTE" if "_NOTE" in headers else None
    rows = []
    for n in new:
        row = [""] * len(headers)
        row[headers.index("NAME")] = n
        if note_col:
            row[headers.index(note_col)] = "aggiunta in automatico dall'immagine: da completare"
        rows.append(row)
    try:
        with open(csv_path, "a", encoding="utf-8", newline="") as fh:
            if raw and not raw.endswith(b"\n"):
                fh.write("\r\n")
            w = csv.writer(fh, delimiter=delimiter, lineterminator="\r\n")
            w.writerows(rows)
    except PermissionError:
        for n in new:
            report("IMMAGINE SENZA RIGA", n, csv_path.name,
                   "riga NON aggiunta: il CSV e' aperto in un altro programma. Chiudilo e rilancia l'anteprima.")
        return False
    for n in new:
        report("RIGA AGGIUNTA", n, csv_path.name, "creata dall'immagine: compila descrizione, fonte e famiglia.")
    return True


def prepare_images(folder, items, names, normalize_key, report):
    """Abbina gli originali agli strumenti e aggiorna le copie in web/."""
    web = folder / WEB_FOLDER
    thumbs, larges = web / "thumbs", web / "large"
    manifest_file = web / "_manifest.json"          # con _ : non va online
    settings = [THUMB_WIDTH, LARGE_SIDE, THUMB_QUALITY, LARGE_QUALITY]
    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        if manifest.get("settings") != settings:
            manifest = {"settings": settings, "images": {}}   # misure cambiate: si rifa' tutto
    except Exception:
        manifest = {"settings": settings, "images": {}}

    # Originali: uno per strumento (se ce ne sono due, vale il piu' recente)
    originals = {}
    for f in sorted(folder.iterdir()):
        if f.is_file() and f.suffix.lower() in UNSUPPORTED_EXTENSIONS:
            report("FORMATO NON SUPPORTATO", f.stem, f.name,
                   "salvala in JPG (per esempio aprendola con Foto di Windows > Salva con nome).")
            continue
        if not f.is_file() or f.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        k = normalize_key(f.stem)
        if k not in items:
            target = names.get(k)
            hint = (f"e' un nome alternativo di {items[target]['name']}: rinominala "
                    f"{items[target]['name']}{f.suffix}") if target else "nessuno strumento con questo NAME nel CSV"
            report("IMMAGINE SENZA RIGA", f.stem, f.name, hint)
            continue
        if k in originals:
            older, newer = sorted([originals[k], f], key=lambda p: p.stat().st_mtime)
            report("IMMAGINI DOPPIE", items[k]["name"], f"{older.name} / {newer.name}",
                   f"uso la piu' recente ({newer.name}): cancella l'altra.")
            originals[k] = newer
        else:
            originals[k] = f

    pillow = None                    # si carica solo se c'e' davvero qualcosa da fare
    done, used, unreadable = 0, set(), set()
    plan = []                        # prima si guarda cosa c'e' da fare, per il contatore
    for k, src in originals.items():
        name = slug(items[k]["name"])
        while name in used:
            name += "-x"
        used.add(name)
        thumb, large = thumbs / (name + ".webp"), larges / (name + ".webp")
        st = src.stat()
        old = manifest["images"].get(name)
        fresh = bool(old and old.get("src") == src.name and old.get("mtime") == int(st.st_mtime)
                     and old.get("size") == st.st_size and thumb.is_file() and large.is_file())
        plan.append((k, src, name, thumb, large, st, old, fresh))
    todo = sum(1 for item in plan if not item[-1])
    counter = 0

    for k, src, name, thumb, large, st, old, fresh in plan:
        if not fresh:
            if pillow is None:
                pillow = load_pillow()
            if not pillow:
                if old and thumb.is_file() and large.is_file():
                    fresh = True                          # si tiene la versione vecchia
                else:
                    continue
            else:
                thumbs.mkdir(parents=True, exist_ok=True)
                larges.mkdir(parents=True, exist_ok=True)
                counter += 1
                print(f"\rPreparo le immagini nuove: {counter} / {todo}...", end="", flush=True)
                try:
                    sizes = make_copies(src, thumb, large)
                except Exception as e:
                    reason = ("non e' un'immagine valida o e' danneggiata"
                              if e.__class__.__name__ == "UnidentifiedImageError"
                              else str(e).replace(str(folder), FOLDER))
                    report("IMMAGINE ILLEGGIBILE", items[k]["name"], src.name, reason)
                    unreadable.add(k)
                    continue
                old = {"src": src.name, "mtime": int(st.st_mtime), "size": st.st_size, **sizes}
                manifest["images"][name] = old
                done += 1
        if max(old["ow"], old["oh"]) < SMALL_ORIGINAL:
            report("IMMAGINE PICCOLA", items[k]["name"], src.name,
                   f"{old['ow']}x{old['oh']} px: meglio almeno {SMALL_ORIGINAL} px sul lato lungo.")
        base = f"{FOLDER}/{WEB_FOLDER}"
        items[k]["image"] = {"thumb": f"{base}/thumbs/{name}.webp", "w": old["w"], "h": old["h"],
                             "large": f"{base}/large/{name}.webp", "lw": old["lw"], "lh": old["lh"]}

    if counter:
        print("")                    # a capo dopo il contatore

    # Copie di originali che non ci sono piu': via
    removed = 0
    for sub in (thumbs, larges):
        if sub.is_dir():
            for f in sub.iterdir():
                if f.suffix.lower() == ".webp" and f.stem not in used:
                    f.unlink()
                    removed += 1
    manifest["images"] = {n: v for n, v in manifest["images"].items() if n in used}
    if web.is_dir() or manifest["images"]:
        web.mkdir(parents=True, exist_ok=True)
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    weight = sum(f.stat().st_size for sub in (thumbs, larges) if sub.is_dir() for f in sub.iterdir())
    return unreadable, done, removed, weight


# ------------------------------------------------------------
#  4. FILE DI CONTROLLO
# ------------------------------------------------------------
def write_control(path, entries):
    order = {t: i for i, t in enumerate(CONTROL_TYPES)}
    entries.sort(key=lambda e: (order.get(e[0], 99), e[1].casefold(), e[2].casefold()))
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\r\n")
        w.writerow(["TIPO", "STRUMENTO", "PAGINA / FILE", "DETTAGLIO"])
        w.writerows(entries)


def human_size(n):
    for unit in ("byte", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "byte" else f"{n:.1f} {unit}"
        n /= 1024


# ------------------------------------------------------------
#  PROGRAMMA (lo chiama _build_index.py)
# ------------------------------------------------------------
def build(site_dir, page_readers, normalize_key, is_all_caps):
    """page_readers: [(nodo della pagina, lettore della pagina), ...]
    Restituisce (dati leggeri per atlas-index.json, righe del riassunto),
    oppure (None, righe)."""
    folder = Path(site_dir) / FOLDER
    csv_path = folder / CSV_FILE
    if not csv_path.is_file():
        return None, [f"Strumenti:           nessun dizionario ({FOLDER}/{CSV_FILE}): saltati"]

    entries = []
    seen = set()
    def report(kind, name, where, detail):
        row = (kind, name, where, detail)
        if row not in seen:                              # niente righe identiche ripetute
            seen.add(row)
            entries.append(list(row))

    items, names, levels = read_dictionary(csv_path, normalize_key, report)
    if add_rows_for_images(folder, csv_path, items, names, normalize_key, report):
        items, names, levels = read_dictionary(csv_path, normalize_key, lambda *a: None)
    read_mentions(page_readers, items, names, normalize_key, is_all_caps, report)
    unreadable, n_done, n_removed, weight = prepare_images(folder, items, names, normalize_key, report)

    titles = {node["path"]: node["title"] for node, _ in page_readers}
    pages_text = lambda d: "; ".join(sorted((titles.get(p, p) for p in d), key=str.casefold))
    level_values = {}
    for key, it in items.items():
        it.setdefault("image", None)
        if not it["native"] and not it["cited"]:
            report("MAI CITATO", it["name"], "", "e' nel CSV ma non compare in nessuna pagina.")
        elif not it["native"]:
            report("SENZA PATRIA", it["name"], pages_text(it["cited"]),
                   "citato, ma mai in azzurro: in nessuna pagina risulta nativo.")
        if it["native"] or it["cited"]:
            report("PATRIE", it["name"], pages_text(it["native"]) or "-",
                   "citato in: " + (pages_text(it["cited"]) or "-"))
        if not it["image"] and key not in unreadable:
            report("IMMAGINE MANCANTE", it["name"], "", "nessuna immagine con questo nome nella cartella.")
        for p in it["paths"]:
            if p[0] == HYBRIDS:
                continue
            for i in range(1, len(p) + 1):
                level_values.setdefault(" > ".join(p[:i]), set()).add(it["name"])
    for value, members in level_values.items():
        report("VALORI GERARCHIA", value,
               f"{len(members)} strument" + ("o" if len(members) == 1 else "i"),
               ", ".join(sorted(members, key=str.casefold)))
    report("PESO", "", f"{FOLDER}/{WEB_FOLDER}", f"{human_size(weight)} di immagini per il sito")

    # --- instruments.json: tutti i dati (il sito lo carica solo quando serve) ---
    public = {}
    for key, it in sorted(items.items(), key=lambda kv: kv[1]["name"].casefold()):
        public[key] = {k: it[k] for k in ("name", "aliases", "description", "source",
                                          "paths", "hybrid", "native", "cited", "image")}
    data = {"generated": datetime.now().isoformat(timespec="seconds"),
            "levels": levels, "items": public}
    (Path(site_dir) / OUTPUT_FILE).write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # --- file di controllo ---
    control = folder / CONTROL_FILE
    problems = sum(1 for e in entries if CONTROL_TYPES.index(e[0]) < CONTROL_TYPES.index("IBRIDO"))
    try:
        write_control(control, entries)
        control_msg = f"{FOLDER}/{CONTROL_FILE}"
    except PermissionError:
        control_msg = f"NON aggiornato: chiudi {CONTROL_FILE} (e' aperto in un altro programma)"

    cited = sum(1 for it in items.values() if it["native"] or it["cited"])
    native = sum(1 for it in items.values() if it["native"])
    with_image = sum(1 for it in items.values() if it["image"])
    summary = [f"Strumenti:           {len(items)} nel dizionario, {cited} citati nelle pagine "
               f"({native} con patria), {with_image} con immagine"]
    if n_done or n_removed:
        summary.append(f"  immagini preparate ora: {n_done}"
                       + (f", copie tolte: {n_removed}" if n_removed else ""))
    summary.append(f"  segnalazioni da guardare: {problems}  ->  {control_msg}")

    # --- dati leggeri per atlas-index.json (riconoscere le parole, pulsanti) ---
    return {
        "file": OUTPUT_FILE,
        "names": names,
        "mentions": {k: {"name": it["name"], "native": it["native"], "cited": it["cited"]}
                     for k, it in items.items() if it["native"] or it["cited"] or it["image"]},
    }, summary
