const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

const FILE = path.join(__dirname, '..', 'data.json');

const defaults = {
  services: [
    {
      id: 'afk-service', emoji: '💤', name: 'AFK Service', limit: 10, enabled: true, roleIds: [],
      short: 'Farmen & Spawner mit 22h Uptime laufen lassen',
      description: 'Wir halten deine Farmen und Spawner mit **22h Uptime** am Laufen – du musst dafür nicht selbst online sein.',
    },
    {
      id: 'map-art-service', emoji: '🗺️', name: 'Map Art Service', limit: 5, enabled: true, roleIds: [],
      short: 'Eigenes Map-Art nach deinen Wünschen bauen lassen',
      description: 'Lass dir dein eigenes Map-Art bauen – passend zu deinem Motiv und Format.',
    },
  ],
  afkPrices: { '22h': '0', '20h': '0', deluxe: '5M' },
  customPrices: { carpet2d: '0', block2d: '0', carpet3d: '0', block3d: '0' },
  spawners: [
    { name: 'Skeleton', get: '6.5M', pay: 'STOP', color: '#d8d8d8' },
    { name: 'Creeper', get: '5M', pay: '6M', color: '#4caf50' },
    { name: 'Iron Golem', get: 'STOP', pay: 'STOP', color: '#e6d3d3' },
    { name: 'Blaze', get: '3.5M', pay: 'STOP', color: '#ffc107' },
    { name: 'Cow', get: '3.5M', pay: 'STOP', color: '#8d6e63' },
    { name: 'Spider', get: '13M', pay: 'STOP', color: '#b71c5c' },
    { name: 'Zombie Piglin', get: 'STOP', pay: 'STOP', color: '#f48fb1' },
  ],
  maparts: {}, // id -> { name, price, size, ownerId, ownerName, thirdParty, image, messageId }
  schematics: {}, // id -> { name, price, desc, image, file, fileName, messageId }
  vouches: [], // { user, avatar, stars, text, service, date }
  config: {}, // per /setup gesetzte Kanal- & Rollen-IDs (Vorrang vor .env)
  counters: {}, // Ticket-Bereich -> letzte vergebene Nummer (startet bei 1)
  categories: {}, // Ticket-Bereich -> Discord-Kategorie-ID
  open: {}, // channelId -> { userId, kind, serviceId, label }
  panels: {}, // key -> { channelId, messageId }
};

// Pro Discord-Server eigene Daten: { guilds: { [guildId]: { ...defaults } } }
const raw = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { guilds: {} };
// Altes Format (nur ein Server) -> unter GUILD_ID einsortieren
const store = raw.guilds ? raw : { guilds: { [process.env.GUILD_ID || 'default']: raw } };
for (const id in store.guilds) store.guilds[id] = { ...structuredClone(defaults), ...store.guilds[id] };

const guild = (id) => (store.guilds[id] ??= structuredClone(defaults));

// Jede Interaktion / jedes Event läuft per db.run(guildId, …) – db.data ist dann automatisch
// der richtige Server. Ohne Kontext (Website): WEB_GUILD_ID, GUILD_ID oder der erste Server.
const als = new AsyncLocalStorage();
const fallbackId = () => process.env.WEB_GUILD_ID || process.env.GUILD_ID || Object.keys(store.guilds)[0];

// ponytail: sync JSON file write, swap for SQLite once the website reads/writes concurrently
const save = () => fs.writeFileSync(FILE, JSON.stringify(store, null, 2));

module.exports = {
  get data() {
    const id = als.getStore() ?? fallbackId();
    return id ? guild(id) : structuredClone(defaults);
  },
  guildId: () => als.getStore(),
  guildIds: () => Object.keys(store.guilds),
  run: (id, fn) => als.run(id, fn),
  save,
};
