# -*- coding: utf-8 -*-
"""
MUSICAL ATLAS - build_index.py

Rilegge la cartella World e scrive  atlas-index.json  con tre parti:
  - "tree"        l'albero del menu (cartelle e pagine)
  - "search"      il testo semplice di ogni pagina, per la ricerca
  - "definitions" i termini definiti -> pagina che li definisce

Si esegue da solo tramite anteprima.bat. Non serve installare niente.
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
#  PROGRAMMA
# ------------------------------------------------------------
def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    root = SITE_DIR / ROOT_FOLDER
    if not root.is_dir():
        print(f"ERRORE: non trovo la cartella {ROOT_FOLDER} accanto a build_index.py")
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
    definitions = {}
    errors = []
    for node, file_path in pages:
        try:
            reader = read_page(file_path)
        except Exception as e:
            errors.append(f"{node['path']}: {e}")
            continue
        search.append({"path": node["path"], "title": node["title"],
                       "text": reader.plain_text()})
        for term in reader.defined_terms():
            key = normalize_key(term)
            if key not in definitions:          # vale la prima nell'ordine del menu
                definitions[key] = {"term": term, "path": node["path"]}

    data = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "tree": tree,
        "search": search,
        "definitions": definitions,
    }
    out = SITE_DIR / OUTPUT_FILE
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Pagine lette:        {len(search)}")
    print(f"Termini definiti:    {len(definitions)}")
    for e in errors:
        print(f"ATTENZIONE, pagina non letta: {e}")
    print(f"Scritto {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
