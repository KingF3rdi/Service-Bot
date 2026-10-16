const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { CUSTOM_TYPES, spawnerStatus } = require('./util');

const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const PAGE = path.join(ROOT, 'web', 'index.html');
const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// Nur öffentliche Daten – keine Rollen-IDs, Ticket-Besitzer oder Panel-IDs
function publicData() {
  const d = db.data;
  const open = Object.values(d.open);
  const v = d.vouches;
  return {
    discord: process.env.DISCORD_INVITE || '',
    services: d.services.map(({ roleIds, ...s }) => ({ ...s, open: open.filter((t) => t.serviceId === s.id).length })),
    spawners: d.spawners.map((s) => ({ ...s, status: spawnerStatus(s) })),
    maparts: Object.entries(d.maparts).reverse().map(([id, m]) => ({
      id, name: m.name, price: m.price, size: m.size, owner: m.ownerName ?? null, thirdParty: m.thirdParty,
      image: m.image ? `/uploads/${m.image}` : null,
    })),
    custom: Object.entries(CUSTOM_TYPES).map(([k, t]) => ({ ...t, price: d.customPrices[k] })),
    vouches: v.slice(-30).reverse(),
    stats: { vouches: v.length, rating: v.length ? +(v.reduce((a, b) => a + b.stars, 0) / v.length).toFixed(1) : null },
  };
}

// SERVER_PORT = vom Hoster (Pterodactyl) zugewiesener Port
function start(port = process.env.WEB_PORT || process.env.SERVER_PORT || 3000) {
  http.createServer((req, res) => {
    const [url, query] = req.url.split('?');
    if (url === '/api/data') {
      // ?guild=ID zeigt einen anderen Server; nur bekannte IDs, sonst Standard-Server
      const gid = new URLSearchParams(query).get('guild');
      const data = db.run(db.guildIds().includes(gid) ? gid : undefined, publicData);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(data));
    }
    if (url.startsWith('/uploads/')) {
      const name = path.basename(url); // basename = kein Path-Traversal
      const type = IMG[path.extname(name).slice(1).toLowerCase()];
      const file = path.join(UPLOADS, name);
      if (type && fs.existsSync(file)) {
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
        return fs.createReadStream(file).pipe(res);
      }
    }
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return fs.createReadStream(PAGE).pipe(res);
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Nicht gefunden');
  }).listen(port, () => console.log(`Website: http://localhost:${port}`));
}

module.exports = { start, publicData, UPLOADS };
