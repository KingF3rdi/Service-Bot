# HugoSMP Service Center Bot

Discord-Bot + Website für das HugoSMP Service Center: Map-Arts, AFK-Service (22h Uptime), Spawner-Handel, Tickets und Vouches.

![Spawner Panel](docs/spawner-panel.png)

## Features

- **Service-Panel** – Services per `/service add | remove | toggle | limit | rolle` verwalten, eigene Support-Rollen pro Service (z. B. AFK-Service), Ticket-Limits
- **Map-Art-Verkauf** – `/mapart` postet Bild, Preis, Größe und Besitzer; 3T-Besitzer werden dem Ticket hinzugefügt
- **Map-Art-Panel** – Übersicht aller verfügbaren Map-Arts mit Kauf-Dropdown, aktualisiert sich automatisch
- **AFK-Panel** – Standard oder Deluxe (mit Farm-Refill, Aufpreis + Material), 22h oder 20h Uptime, Verkauf per /order oder /sell; Preise per `/afkpreis`
- **Custom Map-Art** – Carpet/Block · 2D/3D, Preis pro Map per `/custompreis`
- **Spawner-Handel** – gerendertes Panel, Preise per `/spawner set`, Kauf/Verkauf-Buttons
- **Vouches per DM** – nach Ticket-Schließung, Veröffentlichung im Vouch-Kanal
- **Website** – zeigt Services, Spawner-Preise, Map-Arts, Custom-Preise und Vouches live

## Setup

Benötigt Node.js 20+.

```bash
npm install
cp .env.example .env   # Werte eintragen
npm start              # Bot + Website (Port 3000), Hoster: Startdatei index.js
```

Panels posten: `/panel typ:Services`, `/panel typ:Custom Map-Art`, `/panel typ:Spawner Handel`, `/panel typ:AFK Service`, `/panel typ:Map-Arts`.

Nur Website starten: `npm run web` · Tests: `npm test`
