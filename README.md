# Worktime PWA – offline check-in/out (iPhone)

Ez egy **telepíthető PWA** (iOS-en: Megosztás → *Főképernyőhöz*), ami:

- napi **0/1 check-in** és **0/1 check-out** bejegyzést kezel,
- munka közben **perc pontosságú** nettó számlálót mutat,
- megmondja, hogy **mikorra lesz meg nettóban** a **6 / 7 / 8 óra** (szünetlevonási szabály alapján),
- **offline** működik (Service Worker + precache),
- adatokat **exportál** CSV/JSON formátumban,
- JSON-t **importálni** is tud.

## Futtatás helyben

A Service Worker **csak HTTP(S)** alatt működik (nem `file://`).

### 1) Indíts egy helyi szervert

```bash
cd worktime-pwa
python -m http.server 8000
```

Nyisd meg:

- `http://localhost:8000`

## Telepítés iPhone-ra

1. Nyisd meg Safari-ban a webcímet (HTTPS-en, éles környezetben).
2. Megosztás ikon → **Főképernyőhöz**.
3. A Home Screen ikonról indítva **standalone** módban fut.

## Adat és időzóna

- Az app a **Europe/Budapest** időzónát használja dátumkulcsokhoz és megjelenítéshez.
- Tárolás: **epoch ms** (stabil DST mellett).

## Projekt felépítés

- `index.html` – UI shell, tabok
- `styles.css` – mobil-first stílus
- `app.js` – UI állapotgép (Ma/Napló/Teszt/Beállítások)
- `time.js` – perc-alapú kerekítés, formázás, időzóna segédek
- `rules.js` – szünetlevonás + célidő (6/7/8) számítás
- `db.js` – IndexedDB CRUD (workdays + settings)
- `exportImport.js` – CSV/JSON export + JSON import
- `sw.js` – precache + offline
- `manifest.json` + `icons/` – PWA metadata

## Megjegyzések

- iOS-en a Web Share API elérhető lehet; ha nem, az export letöltéssel működik.
- A számláló **percenként** frissül (a következő percfordulón szinkronizálva).

## Verziózás

- A Beállítások felület alján mindig látható az aktuális app verzió.
- Minden kiadásnál a verziót eggyel növeljük: induló érték `0.2`.
- `0.9` után a következő verzió `1.0`.
