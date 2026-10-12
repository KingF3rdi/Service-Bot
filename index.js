// Einstiegspunkt für Hoster, die `node index.js` starten: .env laden (falls vorhanden), dann Bot starten
const fs = require('node:fs');
if (fs.existsSync(`${__dirname}/.env`)) process.loadEnvFile(`${__dirname}/.env`);
require('./src/index.js');
