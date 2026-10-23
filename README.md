# Stein, Schere, Papier – Online

Browser-Nachbau des alten ICQ-Strategiespiels: Zwei Spieler stellen verdeckt ihre
Figuren (Stein, Schere, Papier, eine Fahne und eine Falle) auf einem Spielfeld
auf, rücken abwechselnd vor und kämpfen nach Stein-Schere-Papier-Regeln. Ziel
ist es, die gegnerische Fahne zu finden und zu erobern – oder den Gegner
bewegungsunfähig zu machen.

## Spielregeln (Kurzfassung)

- Spielfeld: 7 Spalten × 6 Reihen. Jeder Spieler hat 2 Heimreihen (14 Felder),
  die Mitte (2 Reihen) ist neutral.
- Jeder Spieler stellt 14 Figuren verdeckt auf: je 4× Stein/Schere/Papier,
  1× Fahne, 1× Falle.
- Figuren ziehen pro Zug ein Feld orthogonal (hoch/runter/links/rechts).
  Fahne und Falle können sich nicht bewegen.
- Zieht eine Figur auf ein gegnerisches Feld, kommt es zum Kampf:
  - Stein schlägt Schere, Schere schlägt Papier, Papier schlägt Stein.
  - Gleicher Typ gegen gleichen Typ: beide Figuren sind raus.
  - Die siegreiche Figur wird ab sofort für beide Spieler aufgedeckt.
  - Trifft man auf die **Falle**, wird die eigene angreifende Figur vernichtet
    (die Falle ist danach ebenfalls aufgebraucht).
  - Trifft man auf die **Fahne**, ist das Spiel sofort gewonnen.
- Kann ein Spieler keine Figur mehr bewegen, verliert er automatisch.

## Starten

```bash
npm install
npm start
```

Der Server läuft danach auf `http://localhost:3000` (Port per `PORT`-Umgebungsvariable
änderbar). Ein Spieler öffnet die Seite, klickt auf **„Spiel erstellen“** und bekommt
einen 5-stelligen Einladungscode. Der zweite Spieler öffnet die Seite auf einem
anderen Gerät/Browser und gibt den Code bei **„Spiel beitreten“** ein.

## Deployment

Das Projekt ist ein normaler Node.js-Server (Express + Socket.IO) ohne Build-Schritt
und lässt sich auf jedem Node-Host deployen (z. B. Render, Fly.io, Railway, ein
eigener VPS). Wichtig für Online-Multiplayer über echte Geräte hinweg:

- Der Server muss dauerhaft laufen (WebSocket-Verbindungen), ein rein statisches
  Hosting (z. B. GitHub Pages) reicht **nicht** aus.
- Start-Kommando: `npm start` (bzw. `node server/index.js`).
- Standardport: `3000`, überschreibbar via `PORT`-Umgebungsvariable.

## Technischer Aufbau

- `server/game.js` – reine Spiellogik (Spielfeld, Platzierung, Zugvalidierung,
  Kampfauflösung, Siegbedingungen). Serverseitig die einzige Quelle der Wahrheit;
  Clients bekommen nur eine gefilterte Sicht ohne verdeckte Figurentypen des Gegners.
- `server/rooms.js` – Erstellung/Verwaltung der Spielräume samt Einladungscode.
- `server/index.js` – Express-Server + Socket.IO-Events (Raum erstellen/beitreten,
  Aufstellung, Züge, Wiederverbindung nach Verbindungsabbruch).
- `public/` – Frontend (reines HTML/CSS/JS ohne Build-Schritt), inkl. Animationen
  und synthetisierten Soundeffekten über die Web Audio API (keine externen
  Audiodateien nötig).

## Hinweis zum Design

Das Spielprinzip orientiert sich am alten ICQ-Spiel, Grafiken (Emoji-Icons),
Animationen und Sounds sind aber komplett eigenständig/neu umgesetzt.
