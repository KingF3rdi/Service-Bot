const { createCanvas } = require('@napi-rs/canvas');
const { isStop, spawnerStatus } = require('./util');

const W = 960, CW = 200, CH = 280, GAP = 24, PER_ROW = 4, HEAD = 320;
const FONT = 'Arial, "Segoe UI", sans-serif';
const GOLD = '#ffc927', PINK = '#ff7ac8', RED = '#ff5b5b';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Text zentriert, wird verkleinert bis er in maxW passt
function text(ctx, str, x, y, size, color, maxW = W, weight = 'bold') {
  do ctx.font = `${weight} ${size}px ${FONT}`;
  while (ctx.measureText(str).width > maxW && --size > 8);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(str, x, y);
}

// Parallelogramm-Fläche des Spawner-Würfels: p0 + u*(p1-p0) + v*(p3-p0)
function face(ctx, p0, p1, p3, fill, mob) {
  const at = (u, v) => [p0[0] + u * (p1[0] - p0[0]) + v * (p3[0] - p0[0]), p0[1] + u * (p1[1] - p0[1]) + v * (p3[1] - p0[1])];
  const poly = (pts, style) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };
  poly([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], fill);
  if (mob) poly([at(0.25, 0.25), at(0.75, 0.25), at(0.75, 0.75), at(0.25, 0.75)], mob);
  ctx.strokeStyle = '#4b5bb0';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    ctx.beginPath(); ctx.moveTo(...at(t, 0)); ctx.lineTo(...at(t, 1)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...at(0, t)); ctx.lineTo(...at(1, t)); ctx.stroke();
  }
}

function cube(ctx, cx, cy, s, color) {
  const top = [cx, cy - s], l = [cx - s, cy - s / 2], r = [cx + s, cy - s / 2], mid = [cx, cy], bot = [cx, cy + s];
  face(ctx, l, top, mid, '#1c2142');
  face(ctx, l, mid, [cx - s, cy + s / 2], '#141834', color);
  face(ctx, mid, r, bot, '#191d3c', color);
}

function card(ctx, x, y, s) {
  rr(ctx, x, y, CW, CH, 14);
  ctx.fillStyle = 'rgba(60, 20, 55, 0.85)';
  ctx.fill();
  ctx.strokeStyle = PINK;
  ctx.lineWidth = 2;
  ctx.stroke();

  const cx = x + CW / 2, lx = x + CW / 4, rx = x + (CW * 3) / 4;
  text(ctx, s.name.toUpperCase(), cx, y + 36, 20, '#fff', CW - 20);
  cube(ctx, cx, y + 112, 50, s.color);
  text(ctx, 'DU ERHÄLTST', lx, y + 192, 11, '#e6b8d8', CW / 2 - 8);
  text(ctx, 'DU ZAHLST', rx, y + 192, 11, '#e6b8d8', CW / 2 - 8);
  for (const [v, px] of [[s.get, lx], [s.pay, rx]]) {
    text(ctx, isStop(v) ? 'STOP' : v.toUpperCase(), px, y + 224, 26, isStop(v) ? RED : GOLD, CW / 2 - 10);
  }
  const st = spawnerStatus(s);
  rr(ctx, x + 20, y + 240, CW - 40, 28, 14);
  ctx.fillStyle = st.color;
  ctx.fill();
  text(ctx, st.label, cx, y + 259, 12, '#fff', CW - 56);
}

function renderSpawnerPanel(spawners) {
  const rows = Math.max(1, Math.ceil(spawners.length / PER_ROW));
  const H = HEAD + rows * (CH + GAP) + 150;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3a1236');
  bg.addColorStop(1, '#1a0716');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Spotlights
  ctx.fillStyle = 'rgba(255, 140, 220, 0.06)';
  for (const [a, b] of [[120, 300], [640, 820]]) {
    ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(b, 0); ctx.lineTo(b + 120, H); ctx.lineTo(a - 120, H); ctx.fill();
  }

  // Header
  ctx.fillStyle = PINK;
  ctx.beginPath(); ctx.moveTo(W / 2, 40); ctx.lineTo(W / 2 + 22, 72); ctx.lineTo(W / 2, 104); ctx.lineTo(W / 2 - 22, 72); ctx.fill();
  text(ctx, 'H U G O S M P   ·   S E R V I C E   C E N T E R', W / 2, 150, 20, '#f0a8d8');
  ctx.font = `bold 84px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#6b3a00';
  ctx.strokeText('SPAWNER HANDEL', W / 2, 240);
  text(ctx, 'SPAWNER HANDEL', W / 2, 240, 84, GOLD);
  text(ctx, 'Kaufen & verkaufen — schnell, sicher, per Ticket', W / 2, 286, 24, '#fbe8f4');

  // Karten, letzte Reihe zentriert
  spawners.forEach((s, i) => {
    const row = Math.floor(i / PER_ROW), inRow = Math.min(PER_ROW, spawners.length - row * PER_ROW);
    const startX = (W - (inRow * CW + (inRow - 1) * GAP)) / 2;
    card(ctx, startX + (i % PER_ROW) * (CW + GAP), HEAD + row * (CH + GAP), s);
  });

  // Footer-Badges
  const fy = HEAD + rows * (CH + GAP) + 8, bw = 270, bg2 = 20;
  const badges = ['SICHER PER TICKET', 'SCHNELLE ABWICKLUNG', 'BEWERTUNGEN: VOUCHES'];
  const bx0 = (W - (badges.length * bw + (badges.length - 1) * bg2)) / 2;
  badges.forEach((b, i) => {
    const bx = bx0 + i * (bw + bg2);
    rr(ctx, bx, fy, bw, 44, 22);
    ctx.fillStyle = 'rgba(60, 20, 55, 0.9)'; ctx.fill();
    ctx.strokeStyle = PINK; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.arc(bx + 28, fy + 22, 9, 0, Math.PI * 2); ctx.fill();
    text(ctx, b, bx + bw / 2 + 14, fy + 28, 15, '#fff', bw - 64);
  });

  rr(ctx, 60, fy + 70, W - 120, 54, 27);
  ctx.fillStyle = GOLD; ctx.fill();
  text(ctx, 'SPAWNER KAUFEN & VERKAUFEN — BUTTONS DIREKT UNTER DEM PANEL', W / 2, fy + 105, 20, '#3a1a00', W - 180);

  return c.toBuffer('image/png');
}

module.exports = { renderSpawnerPanel };
