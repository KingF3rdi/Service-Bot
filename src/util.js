const isStop = (v) => !v || /^stop$/i.test(v.trim());

// "6.5M" -> 6500000, "500k" -> 500000, "abc" -> NaN
function parseMoney(s) {
  const m = String(s).trim().match(/^(\d+(?:[.,]\d+)?)\s*([kmb]?)$/i);
  if (!m) return NaN;
  return parseFloat(m[1].replace(',', '.')) * { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
}

function fmtMoney(n) {
  if (n >= 1e9) return +(n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return +(n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return +(n / 1e3).toFixed(2) + 'k';
  return String(n);
}

// "Du erhältst" = wir kaufen an, "Du zahlst" = wir verkaufen
function spawnerStatus(s) {
  const buy = !isStop(s.get), sell = !isStop(s.pay);
  if (buy && sell) return { label: 'ANKAUF & VERKAUF', color: '#1f7a4a' };
  if (buy) return { label: 'KEIN VERKAUF', color: '#8f1d35' };
  if (sell) return { label: 'KEIN ANKAUF', color: '#8f1d35' };
  return { label: 'PAUSIERT', color: '#5a3a5e' };
}

const CUSTOM_TYPES = {
  carpet2d: { label: 'Carpet 1x1 · 2D', emoji: '🧶', desc: 'Flaches Map-Art aus Teppich' },
  block2d: { label: 'Block 1x1 · 2D', emoji: '🧱', desc: 'Flaches Map-Art aus Blöcken' },
  carpet3d: { label: 'Carpet 1x1 · 3D', emoji: '🎨', desc: 'Gestaffeltes Map-Art aus Teppich (mehr Farben)' },
  block3d: { label: 'Block 1x1 · 3D', emoji: '🏔️', desc: 'Gestaffeltes Map-Art aus Blöcken (mehr Farben)' },
};

module.exports = { isStop, parseMoney, fmtMoney, spawnerStatus, CUSTOM_TYPES };
