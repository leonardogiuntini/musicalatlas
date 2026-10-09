# Musical Atlas

## File di servizio (dalla versione 4.2)

I file che servono a te e non al sito iniziano con `_`, così stanno in cima alla
cartella e GitHub Pages non li pubblica (restano comunque nella repository):

```
_anteprima.bat              lancia l'anteprima (prima si chiamava anteprima.bat)
_build_index.py             crea l'indice (prima build_index.py)
_build_instruments.py       strumenti: dizionario, pagine, immagini, file di controllo
                            (lo richiama _build_index.py: non va lanciato a mano)
_server.py                  mini-server dell'anteprima (prima server.py)
_ISTRUZIONI.md              questo file
_REGOLE_FORMATTAZIONE.txt   come formattare le pagine
INSTRUMENTS/                immagini e dizionario degli strumenti (vedi
                            INSTRUMENTS/_ISTRUZIONI_IMMAGINI.txt)
```

Dove sotto si legge `anteprima.bat` o `build_index.py`, oggi sono `_anteprima.bat`
e `_build_index.py`.

Si lancia sempre e solo `_anteprima.bat`: richiama da solo tutti gli script.

File creati dagli script (non modificarli a mano):

```
atlas-index.json                     indice del sito
instruments.json                     dati completi degli strumenti
INSTRUMENTS/web/                     copie leggere delle immagini
INSTRUMENTS/_CONTROLLO_INSTRUMENTS.csv   segnalazioni (filtra per la colonna TIPO)
```

## Percorso, pagine e INFO (dalla versione 4.3)

- Globo chiuso: in alto il percorso fino alla cartella in cui sei (WORLD | AFRICA | WEST AFRICA),
  sotto le sue pagine; la pagina aperta (es. MALI) e' accesa.
- Info box: INFO | PEOPLES | GENRES | INSTRUMENTS. INFO e' il testo della pagina
  (clic: chiude e riapre il testo; con il catalogo aperto riporta al testo).
- Globo aperto: freccia < (livello sopra) e livello attuale, due pulsanti separati.
  Nessun grassetto sui pulsanti del globo.
- Continenti e zone riempiono il riquadro del globo (in larghezza e in altezza).
- GENRES e INSTRUMENTS: prima i nativi del luogo, poi i citati; in ciascun gruppo dal piu'
  citato nell'atlante intero (tutte le volte, anche nella stessa pagina); a parita' alfabetico.

## Righe automatiche nel dizionario degli strumenti

Dove sta: in `_build_instruments.py`, funzione `add_rows_for_images` (subito prima di
`prepare_images`). Parte da sola a ogni `_anteprima.bat`
(`_anteprima.bat` -> `_build_index.py` -> `_build_instruments.py`).

Cosa fa: per ogni immagine in `INSTRUMENTS/` che non ha una riga in `_INSTRUMENTS.csv`
aggiunge IN FONDO al CSV una riga con il solo NAME (il nome del file, in maiuscolo) e in
`_NOTE` "aggiunta in automatico dall'immagine: da completare". Non modifica, non
riordina e non cancella mai le righe che ci sono. Nel file di controllo compare
"RIGA AGGIUNTA".

Dettagli:
- Vale solo per le immagini che lo script sa leggere (JPG, PNG, WebP, GIF, TIFF, BMP).
  HEIC, AVIF e simili non creano la riga: compaiono come "FORMATO NON SUPPORTATO".
- Il confronto con le righe che ci sono ignora maiuscole e minuscole:
  kora.jpg non crea una seconda riga KORA.

Quando NON lo fa (e lo scrive nel file di controllo):
- il CSV e' aperto in LibreOffice: chiudilo e rilancia l'anteprima;
- il CSV e' aperto in un altro programma che impedisce di scriverci: chiudilo e rilancia;
- il nome dell'immagine e' un nome alternativo (ALIASES) di uno strumento: rinomina l'immagine;
- il CSV non e' in UTF-8: salvalo in UTF-8;
- nella prima riga del CSV manca la colonna NAME.

Programmi diversi da LibreOffice (Modern CSV, Excel...): se tengono il file aperto
senza impedire di scriverci, la riga viene aggiunta lo stesso. Vale l'attenzione qui sotto.

Attenzione: dopo che lo script ha aggiunto righe, chiudi e riapri il CSV nel programma
prima di modificarlo (salvando una versione vecchia ancora aperta le righe nuove si perdono).

## Versione 4.8

- Rami di INSTRUMENTS, una riga per livello: in alto ALL e i rami principali del luogo,
  sotto i sotto-rami del ramo scelto (LUTES, HARPS...). Scegliendo un ramo si accende
  lui e gli altri restano al loro posto, spenti. Riclic sul ramo acceso: torna su
  (in alto: ALL). Rami assenti nel luogo: non compaiono.
- Se in un livello c'e' un ramo solo e contiene tutti gli strumenti mostrati, e' gia'
  acceso e ALL sparisce (es. un paese con solo CHORDOPHONES). Se anche uno solo degli
  strumenti non ha ramo nel CSV (colonne di livello vuote), ALL resta.
- La pagina resta ferma: quando l'info box si accorcia (testo -> catalogo, cambio di
  ramo, PEOPLES / GENRES, testo che si chiude) la pagina non scatta in su. Lo spazio
  in piu' in fondo se ne va da solo mentre risali (funzione tieniPagina in app.js).

## Versione 4.7

- Nomi dei luoghi: seguono il territorio anche mentre si trascina il globo (si ricalcolano
  ogni LABEL_FOLLOW_MS e scivolano morbidi; a globo fermo la posizione e' precisa).
- "go to" dei fumetti e paesi nella scheda di uno strumento: si arriva con INFO acceso.
- Rami di INSTRUMENTS senza numeri (ALL, CHORDOPHONES...).
- Catalogo: prima gli strumenti con l'immagine, poi quelli senza (in ciascun gruppo
  la regola nativi / citati di sempre).

## Globo e pulsanti (versione 4.6)

- Voci sul globo: a ogni livello ogni unita' (continente / zona / paese) mostra i suoi
  nativi dal piu' citato, a turno con le altre unita'; il resto va nel suo "+N".
  Le voci partono dentro la loro unita' (possono stare a cavallo del confine) e si
  dispongono a righe sfalsate. Nativa di piu' paesi: vicino ai confini in comune.
  Grandezza base 8 px (ITEM_FONT_PX in map/atlas-map.js).
- INSTRUMENTS: il ramo scelto nel catalogo (es. CHORDOPHONES) vale anche sul globo.
- Fumetti del globo: sfondo scurito; un clic fuori chiude solo il fumetto.
  Voci e "+N" si ingrandiscono un poco col mouse sopra.
- Zoom unico per tutti i livelli: dal mondo intero fino a 2 volte l'inquadratura del
  paese piu' piccolo dell'atlante (ZOOM_MAX_EXTRA). Zoomare non cambia pagina.
- Nomi dei luoghi (INFO): se il loro punto esce dallo schermo, si spostano nella parte
  visibile del territorio. Il paese in cui sei non mostra il nome col mouse sopra.
- Il pulsante del luogo sul globo e' nero.
- Cartella con dentro solo la sua pagina: vale come una pagina (accesa nella riga sotto,
  il percorso non si sposta). Con altre pagine dentro torna una cartella normale.
- Pulsanti accesi: senza bordo; nei blocchi uniti il contorno resta continuo.
- _INSTRUMENTS.csv: un'immagine senza riga crea da sola una riga in fondo (solo NAME e
  una nota in _NOTE). Non succede se il CSV e' aperto in LibreOffice, se l'immagine ha
  il nome di un alias, o se il CSV non e' in UTF-8: lo dice il file di controllo.

## Navigazione e globo (versione 4.5)

- Apertura del sito: globo che gira, benvenuto, EXPLORE e ×. Si parte solo da EXPLORE
  (va su WORLD). Il titolo MUSICAL ATLAS riporta al benvenuto.
- Globo aperto: < in alto a sinistra, × in alto a destra, il luogo in basso a sinistra,
  + e - in basso a destra. Globo fermo: < e luogo restano, in nero.
  Clic sul luogo = stato iniziale del luogo (INFO).
- INFO / PEOPLES / GENRES / INSTRUMENTS: se ne accende uno solo. Gli altri tre chiudono
  il testo (INSTRUMENTS mostra il catalogo); riclic = torna INFO. INFO ricliccato chiude
  il testo. Il pulsante scelto resta acceso cambiando luogo (se il luogo ce l'ha);
  lo dimenticano INFO e il clic sul luogo in cui sei (percorso, pagina accesa, globo).
- Percorso e riga sotto (globo chiuso): il nome del livello sopra non si ripete
  (WORLD | AFRICA | WEST). Sul globo i nomi restano interi.
- Globo, PEOPLES / GENRES / INSTRUMENTS: citati fuori dal confine del luogo aperto;
  nativi liberi dentro il luogo aperto (popoli: dentro i loro paesi). "+N" = fumetto
  con le voci mancanti; riclic lo chiude. Genere: riclic chiude il fumetto.
  Col mouse sopra un luogo ne compare il nome; sul telefono primo tocco = nome,
  secondo tocco = ci va. Pagina di un paese: il globo inquadra il paese.
- Catalogo: sfondo nero; ordine = nativi dal piu' citato (poi alfabetico), ogni 4 un
  citato dal piu' citato; vale anche nei rami.
- Pulsanti: un po' piu' stretti; acceso = sfondo colorato, testo nero, bordo nero.

## Pulsanti uniti (versione 4.5)

- Percorso, pagine sotto il percorso, rami di INSTRUMENTS e "< luogo" del globo sono
  blocchi unici: archetti solo alle estremita', righe equilibrate (3 + 2, non 4 + 1).
- PER TORNARE A PRIMA: in app.js, in cima, scrivi  const JOINED_LABELS = false;
  (gli stili sono nella sezione "PULSANTI UNITI" in fondo a styles.css e a map/atlas-map.css).

## Globo a un livello alla volta (dalla versione 4.4)

- L'interruttore acceso nell'info box decide anche cosa mostra il globo:
  nessuno = INFO (nomi dei luoghi); PEOPLES / GENRES / INSTRUMENTS = le loro voci.
  Il globo mostra le stesse voci che l'info box elenca per il luogo aperto.
- Unita': a WORLD i continenti, in un continente le zone, in una zona i paesi.
  Le pagine di gruppo (MANDE...) occupano i paesi dei loro popoli.
- Ogni voce compare una volta. NATIVA: dentro la patria (in mezzo, se piu' patrie).
  CITATA (patria non in questo livello): subito fuori dal confine del paese che la
  cita piu' vicino alla patria, dal lato della patria; senza patria, in un punto fisso.
- Voci = pulsanti come nell'info box (citata = tono scuro). Grandezza: +1% per ogni
  volta che compare nell'atlante fino a +20% (20 volte), oltre in proporzione fino
  al piu' citato (+25%), a scatti di mezzo punto. Base in map/atlas-map.js (ITEM_FONT_PX).
- Se non c'e' posto: contatore "+N" (clic = zoom; zoomando le voci compaiono).
- Clic: genere = fumetto (la voce resta accesa); strumento = scheda; popolo = come prima.
- PEOPLES: alone giallo solo con PEOPLES acceso; niente puntini. Dove e' nativo un popolo:
  elenchi delle pagine di gruppo + giallo nelle pagine dei paesi.
- Catalogo: ALL e' acceso solo se non e' scelto nessun ramo.
- Globo: × nera; + e - in un unico pulsante diviso a meta'.

## INSTRUMENTS (dalla versione 4.2)

- Strumento = corsivo + MAIUSCOLO. Azzurro = NATIVO della pagina, senza colore = CITATO.
  Vale solo se il nome (o un suo nome alternativo) e' in `INSTRUMENTS/_INSTRUMENTS.csv`.
- Il pulsante INSTRUMENTS funziona come GENRES: la lista nasce dai testi del luogo aperto.
  Pulsante azzurro = nativo, azzurro scuro = citato. Niente piu' cartelle INSTRUMENTS.
- Clic su uno strumento (nel testo o sul pulsante): si apre la sua SCHEDA sopra la pagina.
  Si chiude con la ×, cliccando fuori, con Esc o col tasto indietro.
  Se lo strumento non e' nel dizionario, compare il solito menu con "search the web".
  Cliccando un paese nella scheda la pagina resta ferma: cambiano solo testo e globo.
- INSTRUMENTS acceso = CATALOGO al posto del testo (si torna al testo richiudendo
  INSTRUMENTS o cliccando il titolo). Griglia di immagini in ordine casuale, 24 alla
  volta (le altre arrivano scorrendo); strumenti senza immagine = solo il nome.
  Nella riga sotto: ALL e i rami della gerarchia del CSV, col numero di strumenti.
  A WORLD compaiono anche gli strumenti mai citati, se hanno l'immagine.

Pillow: la prima volta che nella cartella INSTRUMENTS c'e' un'immagine da preparare,
lo script installa Pillow da solo (serve internet, una volta sola). Per toglierla:
`py -m pip uninstall pillow`.

---

# Info box (versione 4.1)

## Installazione

Sostituisci nella cartella principale del sito (quella con `index.html`):

```
index.html
app.js
styles.css
build_index.py
```

La cartella `map/` NON cambia: tieni i tuoi `atlas-map.js` e `atlas-map.css`.
Poi lancia `anteprima.bat` (chiudi prima eventuali finestre nere di anteprima già aperte).

`app.js` contiene già "Welcome!" come testo di benvenuto; `styles.css` e `index.html`
contengono già la lente e "Search".

## Novità della 4.1

- Sottocartelle e pagine (BENIN, MALI…) stanno nella striscia della mappa chiusa, sotto il
  percorso, e compaiono solo sulla pagina di una cartella (West Africa sì, Mali no).
  A mappa aperta naviga il globo.
- PEOPLES / GENRES / INSTRUMENTS restano chiusi finché non li clicchi.
- Generi: tutti spenti (sfondo nero); nativi in verde, non nativi in verde scuro;
  un genere si accende mentre è aperto il suo menu.
- Tono scuro automatico per qualunque colore: classe "dim", intensità in `--dim`
  in cima a styles.css (1 = uguale, 0 = nero).

## Cosa cambia

**Info box**
- Intestazione nera con contorno bianco: a sinistra il titolo della pagina,
  a destra PEOPLES · GENRES · INSTRUMENTS (solo quelli che esistono in quel luogo).
- Sotto, ancora nell'intestazione: il contenuto dell'interruttore acceso.
- La riga del titolo resta agganciata in cima allo schermo mentre scorri il testo.
- Clic sul titolo: il testo si chiude (resta solo la riga del titolo, titolo nero)
  e si riapre (titolo bianco), con la transizione.
- Si riapre da solo quando arrivi "in fondo": una pagina, o una cartella senza sottocartelle.
  Le cartelle con sottocartelle (World, Africa, West Africa) lo lasciano com'è.

**GENRES** (nessuna cartella: la lista nasce dai testi)
- Genere = grassetto + corsivo + MAIUSCOLO.
  Con evidenziazione verde = NATIVO; senza colore = CITATO (nativo altrove).
- La lista vale per il luogo aperto: una pagina, o tutte le pagine di una cartella.
- Ordine: prima i nativi (prima quelli nativi in più pagine), poi i citati
  (prima i più citati); a parità, in ordine alfabetico.
- Pulsante pieno verde = nativo del luogo; solo bordo verde = citato.
- Clic: "go to" le pagine dove è nativo (in ordine alfabetico) + "search the web".
- `anteprima.bat` ora scrive anche quanti generi ha trovato.

**Regole generali**
- Ogni menu a comparsa finisce con "search the web". Per questo tutti i grassetti
  delle regole diventano cliccabili (anche le città), senza cambiare aspetto.
- I link non cambiano mai colore (niente viola dopo il clic).
