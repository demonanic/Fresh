import { THEME } from '../data/theme.js';
import { BUILDINGS } from '../data/buildings.js';
import { ENEMIES } from '../data/enemies.js';
import { isDisrupted, maxHp, canPlace, structureAt } from '../core/state.js';
import { bufferCap } from '../sim/economy.js';
import { diagnose } from '../sim/analysis.js';

// Neon synthwave renderer. Glow is faked with layered additive strokes instead of
// shadowBlur so it stays cheap on phones.

let groundCache = null;

function buildGround(sector, ts) {
  const c = document.createElement('canvas');
  c.width = sector.w * ts;
  c.height = sector.h * ts;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#0d0a1a');
  grad.addColorStop(0.5, THEME.field);
  grad.addColorStop(1, '#100818');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // Synthwave grid
  for (let x = 0; x <= sector.w; x++) {
    const major = x % 4 === 0;
    g.strokeStyle = major ? 'rgba(168,85,247,0.30)' : 'rgba(168,85,247,0.10)';
    g.lineWidth = major ? 1.5 : 1;
    g.beginPath(); g.moveTo(x * ts + 0.5, 0); g.lineTo(x * ts + 0.5, c.height); g.stroke();
  }
  for (let y = 0; y <= sector.h; y++) {
    const major = y % 4 === 0;
    g.strokeStyle = major ? 'rgba(240,45,202,0.26)' : 'rgba(240,45,202,0.08)';
    g.lineWidth = major ? 1.5 : 1;
    g.beginPath(); g.moveTo(0, y * ts + 0.5); g.lineTo(c.width, y * ts + 0.5); g.stroke();
  }
  // Debris
  for (const d of sector.debris) {
    g.save();
    g.translate(d.x * ts, d.y * ts);
    g.rotate(d.r);
    g.strokeStyle = 'rgba(148,163,184,0.22)';
    g.lineWidth = 1;
    g.strokeRect(-d.s * ts / 2, -d.s * ts / 4, d.s * ts, d.s * ts / 2);
    g.restore();
  }
  // Sector boundary
  g.strokeStyle = 'rgba(0,243,255,0.5)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
  return { canvas: c, ts, seed: sector.seed };
}

export function computeView(state, cssW, cssH, ts) {
  const vw = cssW / ts;
  const vh = cssH / ts;
  const { w, h } = state.sector;
  const p = state.player;
  const cx = vw >= w ? (w - vw) / 2 : Math.max(0, Math.min(w - vw, p.x - vw / 2));
  const cy = vh >= h ? (h - vh) / 2 : Math.max(0, Math.min(h - vh, p.y - vh / 2));
  return { x: cx, y: cy, w: vw, h: vh, ts, cssW, cssH };
}

export function screenToWorld(view, sx, sy) {
  return { x: view.x + sx / view.ts, y: view.y + sy / view.ts };
}

function glowStroke(ctx, color, width, draw) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = width * 3.2;
  draw();
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  draw();
  ctx.restore();
}

function poly(ctx, x, y, r, sides, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawNode(ctx, n, ts, t) {
  if (n.amount <= 0) return;
  const x = (n.x + 0.5) * ts;
  const y = (n.y + 0.5) * ts;
  const k = 0.45 + 0.55 * (n.amount / n.max);
  const color = n.type === 'scrap' ? THEME.orange : THEME.magenta;
  ctx.save();
  ctx.fillStyle = n.type === 'scrap' ? 'rgba(255,102,0,0.14)' : 'rgba(240,45,202,0.16)';
  ctx.fillRect(n.x * ts + 1, n.y * ts + 1, ts - 2, ts - 2);
  const r = ts * 0.32 * k;
  if (n.type === 'scrap') {
    glowStroke(ctx, color, 1.6, () => { poly(ctx, x, y, r, 6, 0.3); ctx.stroke(); });
    glowStroke(ctx, color, 1.2, () => { poly(ctx, x - r * 0.5, y + r * 0.3, r * 0.45, 5, 1); ctx.stroke(); });
  } else {
    const pulse = 0.85 + 0.15 * Math.sin(t * 3 + n.x);
    glowStroke(ctx, color, 1.6, () => { poly(ctx, x, y, r * 1.1 * pulse, 4, Math.PI / 4); ctx.stroke(); });
    ctx.fillStyle = color;
    ctx.font = `${Math.round(ts * 0.3)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('01', x, y + 1);
  }
  ctx.restore();
}

function drawStructure(ctx, state, s, ts, t, selected) {
  const def = BUILDINGS[s.type];
  const x = (s.x + 0.5) * ts;
  const y = (s.y + 0.5) * ts;
  const dis = isDisrupted(s);
  const flicker = dis ? (Math.sin(t * 20 + s.id) > 0 ? 0.35 : 0.8) : 1;
  const color = def.color;
  const r = ts * 0.4;
  ctx.save();
  ctx.globalAlpha = flicker;
  ctx.fillStyle = 'rgba(10,11,16,0.85)';

  switch (s.type) {
    case 'core': {
      const R = ts * 1.25;
      poly(ctx, x, y, R, 6, Math.PI / 6); ctx.fill();
      glowStroke(ctx, THEME.magenta, 2.5, () => { poly(ctx, x, y, R, 6, Math.PI / 6); ctx.stroke(); });
      glowStroke(ctx, THEME.cyan, 1.5, () => { poly(ctx, x, y, R * 0.62, 6, Math.PI / 6 + t * 0.4); ctx.stroke(); });
      const pr = R * (0.25 + 0.05 * Math.sin(t * 2.5));
      const g = ctx.createRadialGradient(x, y, 0, x, y, pr * 2);
      g.addColorStop(0, 'rgba(255,230,0,0.95)');
      g.addColorStop(0.4, 'rgba(240,45,202,0.6)');
      g.addColorStop(1, 'rgba(240,45,202,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, pr * 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'extractor': {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      glowStroke(ctx, color, 1.8, () => { ctx.strokeRect(x - r, y - r, r * 2, r * 2); });
      const spin = s.status === 'OK' || s.status === 'LOW POWER' ? t * 4 : 0;
      glowStroke(ctx, THEME.yellow, 1.4, () => {
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = spin + (i * Math.PI * 2) / 3;
          ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
        }
        ctx.stroke();
      });
      const frac = s.buffer.amount / bufferCap(s);
      ctx.fillStyle = frac >= 0.999 ? THEME.red : (s.buffer.type === 'data' ? THEME.magenta : THEME.orange);
      ctx.fillRect(x - r, y + r + 2, r * 2 * frac, 3);
      break;
    }
    case 'generator': {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      glowStroke(ctx, color, 1.8, () => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); });
      const pulse = dis ? 0 : 0.5 + 0.5 * Math.sin(t * 6 + s.id);
      ctx.globalAlpha = flicker * (0.5 + 0.5 * pulse);
      glowStroke(ctx, THEME.yellow, 2, () => {
        ctx.beginPath();
        ctx.moveTo(x + r * 0.15, y - r * 0.65); ctx.lineTo(x - r * 0.3, y + r * 0.05); ctx.lineTo(x + r * 0.1, y + r * 0.05);
        ctx.lineTo(x - r * 0.15, y + r * 0.65);
        ctx.stroke();
      });
      break;
    }
    case 'storage': {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      glowStroke(ctx, color, 1.8, () => {
        ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      });
      break;
    }
    case 'refinery': {
      poly(ctx, x, y, r * 1.1, 8, Math.PI / 8); ctx.fill();
      glowStroke(ctx, color, 1.8, () => { poly(ctx, x, y, r * 1.1, 8, Math.PI / 8); ctx.stroke(); });
      const prog = s.craft ? Math.min(1, s.craft.t / def.recipe.time) : 0;
      glowStroke(ctx, THEME.cyan, 2, () => { ctx.beginPath(); ctx.arc(x, y, r * 0.55, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke(); });
      break;
    }
    case 'research_node': {
      poly(ctx, x, y, r * 1.15, 4, 0); ctx.fill();
      glowStroke(ctx, color, 1.8, () => { poly(ctx, x, y, r * 1.15, 4, 0); ctx.stroke(); });
      const active = state.research.current && !dis;
      glowStroke(ctx, THEME.cyan, 1.2, () => { poly(ctx, x, y, r * 0.5, 4, active ? t * 2 : 0); ctx.stroke(); });
      break;
    }
    case 'turret':
    case 'scatter_turret': {
      ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.fill();
      glowStroke(ctx, color, 1.8, () => { ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.stroke(); });
      const a = s.aim || -Math.PI / 2;
      glowStroke(ctx, color, s.type === 'turret' ? 3 : 2, () => {
        ctx.beginPath();
        if (s.type === 'turret') {
          ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3);
        } else {
          for (const o of [-0.35, 0, 0.35]) { ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a + o) * r * 1.1, y + Math.sin(a + o) * r * 1.1); }
        }
        ctx.stroke();
      });
      break;
    }
    case 'drone_hub': {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      glowStroke(ctx, color, 1.8, () => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); });
      glowStroke(ctx, THEME.magenta, 1.2, () => { ctx.beginPath(); ctx.arc(x, y, r * 0.55, t * 2, t * 2 + Math.PI * 1.3); ctx.stroke(); });
      break;
    }
    case 'repair_station': {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      glowStroke(ctx, color, 1.8, () => { ctx.strokeRect(x - r, y - r, r * 2, r * 2); });
      glowStroke(ctx, color, 2.5, () => {
        ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); ctx.moveTo(x, y - r * 0.5); ctx.lineTo(x, y + r * 0.5); ctx.stroke();
      });
      break;
    }
    default: break;
  }
  ctx.globalAlpha = 1;

  // Level pips
  if (s.level > 1) {
    ctx.fillStyle = THEME.yellow;
    for (let i = 0; i < s.level - 1; i++) ctx.fillRect(x - r + i * 5, y - r - 6, 3, 3);
  }
  // HP bar
  const hpFrac = s.hp / maxHp(s);
  if (hpFrac < 0.999) {
    const bw = s.type === 'core' ? ts * 2 : ts * 0.8;
    const by = s.type === 'core' ? y + ts * 1.4 : y + r + 7;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - bw / 2, by, bw, 3);
    ctx.fillStyle = hpFrac < 0.25 ? THEME.red : hpFrac < 0.6 ? THEME.yellow : THEME.green;
    ctx.fillRect(x - bw / 2, by, bw * hpFrac, 3);
  }
  // Warning badge
  const issues = diagnose(state, s);
  if (issues.length) {
    const bad = issues.some((i) => i.level === 'bad');
    ctx.fillStyle = bad ? THEME.red : THEME.yellow;
    ctx.font = `bold ${Math.round(ts * 0.42)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const by = s.type === 'core' ? y - ts * 1.5 : y - r - 9;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 6);
    ctx.fillText('!', x + r, by);
    ctx.globalAlpha = 1;
  }
  if (selected) {
    const R = s.type === 'core' ? ts * 1.5 : ts * 0.65;
    ctx.setLineDash([4, 4]);
    glowStroke(ctx, THEME.white, 1, () => { ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke(); });
    ctx.setLineDash([]);
    const range = def.range;
    if (range) {
      ctx.strokeStyle = 'rgba(0,243,255,0.5)';
      ctx.fillStyle = 'rgba(0,243,255,0.05)';
      ctx.beginPath(); ctx.arc(x, y, range * ts, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawConduits(ctx, state, ts, t) {
  const core = state.structures.find((s) => s.type === 'core');
  if (!core) return;
  const ok = state.power.ratio >= 0.999;
  ctx.save();
  ctx.lineWidth = 1;
  for (const s of state.structures) {
    if (s.type === 'core' || !BUILDINGS[s.type].power) continue;
    const x1 = (core.x + 0.5) * ts; const y1 = (core.y + 0.5) * ts;
    const x2 = (s.x + 0.5) * ts; const y2 = (s.y + 0.5) * ts;
    ctx.strokeStyle = ok ? 'rgba(0,243,255,0.16)' : 'rgba(255,42,95,0.22)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (!isDisrupted(s)) {
      const k = ((t * 0.6 + s.id * 0.37) % 1);
      const from = BUILDINGS[s.type].power > 0 ? k : 1 - k;
      ctx.fillStyle = ok ? THEME.cyan : THEME.red;
      ctx.fillRect(x2 + (x1 - x2) * from - 1.5, y2 + (y1 - y2) * from - 1.5, 3, 3);
    }
  }
  ctx.restore();
}

function drawEnemy(ctx, e, ts, t) {
  const def = ENEMIES[e.type];
  const x = e.x * ts;
  const y = e.y * ts;
  const r = def.radius * ts;
  ctx.save();
  ctx.fillStyle = 'rgba(10,11,16,0.8)';
  const shape = () => {
    switch (e.type) {
      case 'crawler': poly(ctx, x, y, r, 3, t * 3 + e.id); break;
      case 'swarm': ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); break;
      case 'saboteur': poly(ctx, x, y, r, 4, Math.PI / 4 + Math.sin(t * 5 + e.id) * 0.3); break;
      case 'bruiser': poly(ctx, x, y, r, 8, t * 0.5); break;
      default: ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  };
  shape(); ctx.fill();
  glowStroke(ctx, def.color, 1.8, () => { shape(); ctx.stroke(); });
  if (e.hp < def.hp) {
    ctx.fillStyle = THEME.red;
    ctx.fillRect(x - r, y - r - 5, 2 * r * (e.hp / def.hp), 2);
  }
  ctx.restore();
}

function drawPlayer(ctx, state, ts, t) {
  const p = state.player;
  if (p.respawn > 0) return;
  const x = p.x * ts;
  const y = p.y * ts;
  const r = ts * 0.38;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(p.aim);
  ctx.fillStyle = 'rgba(10,11,16,0.9)';
  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(-r * 0.8, r * 0.7); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.8, -r * 0.7); ctx.closePath();
  };
  shape(); ctx.fill();
  glowStroke(ctx, THEME.green, 2, () => { shape(); ctx.stroke(); });
  ctx.restore();
  // HP ring
  ctx.save();
  const frac = p.hp / 100;
  ctx.strokeStyle = frac < 0.35 ? THEME.red : 'rgba(57,255,20,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r * 1.45, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
  if (p.carry.amount > 0) {
    ctx.fillStyle = p.carry.type === 'data' ? THEME.magenta : THEME.orange;
    ctx.font = `bold ${Math.round(ts * 0.3)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(p.carry.amount)}`, x, y - r * 1.7);
  }
  if (p.action) {
    ctx.strokeStyle = p.action === 'mining' ? THEME.orange : THEME.green;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r * 2 + Math.sin(t * 12) * 2, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export function render(ctx, state, view, ui, dpr) {
  const { ts } = view;
  const t = performance.now() / 1000;
  if (!groundCache || groundCache.ts !== ts || groundCache.seed !== state.sector.seed) groundCache = buildGround(state.sector, ts);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, view.cssW, view.cssH);
  ctx.translate(-view.x * ts, -view.y * ts);
  ctx.drawImage(groundCache.canvas, 0, 0);

  const x0 = Math.max(0, Math.floor(view.x) - 1);
  const y0 = Math.max(0, Math.floor(view.y) - 1);
  const x1 = Math.min(state.sector.w, Math.ceil(view.x + view.w) + 1);
  const y1 = Math.min(state.sector.h, Math.ceil(view.y + view.h) + 1);
  const inView = (x, y, m = 2) => x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;

  for (const n of state.sector.nodes) if (inView(n.x, n.y) && state.fog[n.y * state.sector.w + n.x]) drawNode(ctx, n, ts, t);

  // Build mode: highlight valid tiles
  if (ui.buildType) {
    const def = BUILDINGS[ui.buildType];
    if (def.needsNode) {
      for (const n of state.sector.nodes) {
        if (!inView(n.x, n.y) || n.amount <= 0 || structureAt(state, n.x, n.y) || !state.fog[n.y * state.sector.w + n.x]) continue;
        ctx.strokeStyle = 'rgba(57,255,20,0.55)';
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(n.x * ts + 2, n.y * ts + 2, ts - 4, ts - 4);
        ctx.setLineDash([]);
      }
    }
  }

  drawConduits(ctx, state, ts, t);

  // Drone hub routes for selection
  const selected = ui.selectedId != null ? state.structures.find((s) => s.id === ui.selectedId) : null;

  for (const s of state.structures) if (inView(s.x, s.y, 3)) drawStructure(ctx, state, s, ts, t, s === selected);

  // Drones
  for (const d of state.drones) {
    const x = d.x * ts; const y = d.y * ts;
    ctx.save();
    ctx.fillStyle = THEME.cyan;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(x, y, ts * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, ts * 0.09, 0, Math.PI * 2); ctx.fill();
    if (d.cargo.amount > 0) {
      ctx.fillStyle = d.cargo.type === 'data' ? THEME.magenta : THEME.orange;
      ctx.fillRect(x - 2, y + ts * 0.14, 4, 4);
    }
    if (d.state === 'blocked') {
      ctx.fillStyle = THEME.red;
      ctx.fillRect(x - 1, y - ts * 0.3, 2, 5);
    }
    ctx.restore();
  }

  for (const e of state.enemies) drawEnemy(ctx, e, ts, t);

  // Projectiles
  ctx.save();
  ctx.lineCap = 'round';
  for (const p of state.projectiles) {
    const x = p.x * ts; const y = p.y * ts;
    let dx; let dy;
    if (p.vx !== undefined) { const m = Math.hypot(p.vx, p.vy); dx = (p.vx / m) * ts * 0.35; dy = (p.vy / m) * ts * 0.35; } else { dx = 0; dy = 0; }
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 0.3; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
  }
  ctx.restore();

  drawPlayer(ctx, state, ts, t);

  // Particles
  for (const p of ui.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    if (p.ring) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x * ts, p.y * ts, (1 - p.life / p.max) * p.ring * ts, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillRect(p.x * ts - 1.5, p.y * ts - 1.5, 3, 3);
    }
  }
  ctx.globalAlpha = 1;

  // Fog of war
  ctx.fillStyle = 'rgba(10,11,16,0.94)';
  const { w } = state.sector;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!state.fog[y * w + x]) ctx.fillRect(x * ts, y * ts, ts + 0.5, ts + 0.5);
    }
  }

  // Build ghost
  if (ui.buildType && ui.hoverTile) {
    const { x, y } = ui.hoverTile;
    const ok = canPlace(state, ui.buildType, x, y).ok;
    ctx.strokeStyle = ok ? THEME.green : THEME.red;
    ctx.fillStyle = ok ? 'rgba(57,255,20,0.15)' : 'rgba(255,42,95,0.15)';
    ctx.lineWidth = 2;
    ctx.fillRect(x * ts, y * ts, ts, ts);
    ctx.strokeRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2);
    const range = BUILDINGS[ui.buildType].range;
    if (range) {
      ctx.strokeStyle = 'rgba(0,243,255,0.35)';
      ctx.beginPath(); ctx.arc((x + 0.5) * ts, (y + 0.5) * ts, range * ts, 0, Math.PI * 2); ctx.stroke();
    }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Touch joysticks
  for (const stick of ui.sticks) {
    if (!stick.active) continue;
    ctx.strokeStyle = stick.kind === 'move' ? 'rgba(0,243,255,0.5)' : 'rgba(240,45,202,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 48, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = stick.kind === 'move' ? 'rgba(0,243,255,0.35)' : 'rgba(240,45,202,0.35)';
    ctx.beginPath(); ctx.arc(stick.ox + stick.dx * 48, stick.oy + stick.dy * 48, 20, 0, Math.PI * 2); ctx.fill();
  }

  // Attack vignette
  if (state.threat.waveActive) {
    const a = 0.12 + 0.06 * Math.sin(t * 4);
    const g = ctx.createRadialGradient(view.cssW / 2, view.cssH / 2, Math.min(view.cssW, view.cssH) * 0.35, view.cssW / 2, view.cssH / 2, Math.max(view.cssW, view.cssH) * 0.7);
    g.addColorStop(0, 'rgba(255,42,95,0)');
    g.addColorStop(1, `rgba(255,42,95,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.cssW, view.cssH);
  }
}
