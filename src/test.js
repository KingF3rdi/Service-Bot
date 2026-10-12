const assert = require('node:assert');
const { parseMoney, fmtMoney, spawnerStatus } = require('./util');

assert.strictEqual(parseMoney('6.5M'), 6.5e6);
assert.strictEqual(parseMoney('500k'), 5e5);
assert.strictEqual(parseMoney('1,5m'), 1.5e6);
assert.ok(Number.isNaN(parseMoney('stop')));
assert.strictEqual(fmtMoney(6.5e6), '6.5M');
assert.strictEqual(fmtMoney(2e6 * 4), '8M');
assert.strictEqual(spawnerStatus({ get: '5M', pay: '6M' }).label, 'ANKAUF & VERKAUF');
assert.strictEqual(spawnerStatus({ get: '5M', pay: 'STOP' }).label, 'KEIN VERKAUF');
assert.strictEqual(spawnerStatus({ get: '', pay: 'stop' }).label, 'PAUSIERT');
console.log('ok');
