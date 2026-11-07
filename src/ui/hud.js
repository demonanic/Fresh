import { BUILDINGS, BUILD_ORDER } from '../data/buildings.js';
import { RESEARCH } from '../data/research.js';
import {
  storageCap, has, canAfford, maxHp, levelMult, upgradeCost, isDisrupted, isPausable,
} from '../core/state.js';
import { bufferCap, extractorPotential } from '../sim/economy.js';
import { diagnose, networkReport, hubThroughput } from '../sim/analysis.js';
import { coveredExtractors } from '../sim/logistics.js';
import { turretStats } from '../sim/combat.js';
import { etaNextWave, waveThreshold } from '../sim/threat.js';
import { currentMission, missionProgress } from '../sim/missions.js';
import { researchStatus, canStartResearch, researchSpeed } from '../sim/research.js';
import { contextAction } from '../sim/player.js';
import { fmtDur } from '../sim/offline.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.floor(n)}`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function costHtml(cost) {
  return Object.entries(cost).map(([r, v]) => `<span class="${r}">${v} ${r === 'components' ? 'comp' : r}</span>`).join(' ') || '—';
}

export function updateTopbar(state) {
  const cap = storageCap(state);
  for (const r of ['scrap', 'components', 'data']) {
    $(`r-${r}`).textContent = fmt(state.resources[r]);
    $(`c-${r}`).textContent = `/${cap}`;
    $(`r-${r}`).parentElement.classList.toggle('full', state.resources[r] >= cap - 0.5);
  }
  const net = state.power.net;
  const e = $('r-energy');
  e.textContent = `${net >= 0 ? '+' : ''}${net.toFixed(1)}`;
  e.classList.toggle('neg', state.power.ratio < 0.999);
  $('b-energy').style.width = `${(state.energyReserve / 150) * 100}%`;
  const th = state.threat;
  const box = $('b-threat').parentElement.parentElement;
  box.classList.toggle('active', th.waveActive);
  if (th.waveActive) {
    $('b-threat').style.width = '100%';
    $('threat-label').textContent = `ATTACK ${th.wave} · ${state.enemies.length} HOSTILE`;
  } else {
    $('b-threat').style.width = `${Math.min(100, (th.meter / waveThreshold(state)) * 100)}%`;
    const eta = etaNextWave(state);
    const stars = th.rate < 0.4 ? '▮▯▯▯▯' : th.rate < 0.9 ? '▮▮▯▯▯' : th.rate < 1.6 ? '▮▮▮▯▯' : th.rate < 2.5 ? '▮▮▮▮▯' : '▮▮▮▮▮';
    $('threat-label').textContent = `THREAT ${stars} ${eta < 600 ? `~${Math.ceil(eta)}s` : ''}`;
  }
}

export function updateObjective(state) {
  const m = currentMission(state);
  const el = $('objective');
  if (!m) { el.innerHTML = '<span class="k">NETWORK AUTONOMOUS</span>All objectives complete. Keep optimizing.'; return; }
  const p = missionProgress(state, m);
  const prog = p.target > 1 ? `<span class="p">${fmt(Math.min(p.value, p.target))}/${p.target}</span>` : '';
  el.innerHTML = `<span class="k">${m.id.startsWith('c_') ? 'STRATEGIC CONTRACT' : 'OBJECTIVE'}</span>${esc(m.text)}${prog}`;
}

export function updateInteractButton(state) {
  const btn = $('btn-interact');
  const act = contextAction(state);
  btn.classList.toggle('repair', !!act && act.kind === 'repair');
  btn.classList.toggle('idle', !act || act.kind === 'full');
  btn.textContent = !act ? 'USE' : act.kind === 'mine' ? 'MINE' : act.kind === 'repair' ? 'REPAIR' : 'FULL';
}

export function renderBuildBar(state, selectedType) {
  return BUILD_ORDER.map((type, i) => {
    const d = BUILDINGS[type];
    const locked = d.requires && !has(state, d.requires);
    const poor = !canAfford(state, d.cost);
    const tech = locked ? RESEARCH.find((r) => r.id === d.requires) : null;
    return `<button class="bcard ${type === selectedType ? 'sel' : ''} ${locked ? 'locked' : ''} ${poor ? 'poor' : ''}" data-type="${type}">
      <span class="k">${i + 1}</span><span class="n">${d.name}</span>
      <span class="c">${locked ? `🔒 ${tech ? tech.name : ''}` : costHtml(d.cost)}</span></button>`;
  }).join('');
}

function stat(label, frac, text, color) {
  return `<div class="stat"><span>${label}</span><div class="meter"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%;${color ? `background:${color};box-shadow:0 0 8px ${color}` : ''}"></i></div><span>${text}</span></div>`;
}

export function renderPanel(state, s, confirm = false) {
  const def = BUILDINGS[s.type];
  const hp = s.hp / maxHp(s);
  let html = `<button class="close" data-act="close">×</button>
    <h3 style="color:${def.color}">${def.name}${s.level > 1 ? ` MK ${['', 'I', 'II', 'III', 'IV', 'V'][s.level]}` : ''}</h3>
    <div class="sub">${s.label} · ${esc(s.status || 'OK')}</div>`;
  html += stat('INTEGRITY', hp, `${Math.round(hp * 100)}%`, hp < 0.25 ? '#FF2A5F' : hp < 0.6 ? '#FFE600' : '#39FF14');
  if (def.power) {
    const p = def.power > 0 ? def.power * (s.type === 'core' ? 1 : levelMult(s)) * (s.type === 'generator' && has(state, 't_overclock') ? 1.4 : 1) : def.power;
    html += stat('POWER', state.power.ratio, `${p > 0 ? '+' : ''}${p.toFixed(1)}/s`, '#FFE600');
  }
  if (s.type === 'extractor') {
    const pot = extractorPotential(state, s) * 60;
    const node = state.sector.nodes.find((n) => n.id === s.nodeId);
    html += stat('OUTPUT', s.status === 'OK' ? 1 : s.status === 'LOW POWER' ? state.power.ratio : 0, `${pot.toFixed(0)}/min`);
    html += stat('BUFFER', s.buffer.amount / bufferCap(s), `${Math.floor(s.buffer.amount)}/${bufferCap(s)}`, s.buffer.amount >= bufferCap(s) - 0.01 ? '#FF2A5F' : '#FF6600');
    if (node) html += stat('DEPOSIT', node.amount / node.max, `${Math.floor(node.amount)} ${node.type}`, node.type === 'data' ? '#F02DCA' : '#FF6600');
  }
  if (s.type === 'refinery') {
    const prog = s.craft ? Math.min(1, s.craft.t / def.recipe.time) : 0;
    html += stat('CYCLE', prog, `${(60 / def.recipe.time * levelMult(s)).toFixed(0)}/min max`);
  }
  if (s.type === 'drone_hub') {
    const n = state.drones.filter((d) => d.hubId === s.id).length;
    const thr = hubThroughput(state, s);
    const covered = coveredExtractors(state, s);
    const demand = covered.reduce((a, e) => a + extractorPotential(state, e) * 60, 0);
    html += stat('DRONES', 1, `${n}`);
    html += stat('TRANSPORT', demand ? Math.min(1, thr / demand) : 1, `${thr.toFixed(0)}/${demand.toFixed(0)} per min`, thr < demand ? '#FF2A5F' : '#00F3FF');
  }
  if (def.damage) {
    const st = turretStats(state, s);
    html += stat('DPS', state.power.ratio, `${(st.damage * st.rate).toFixed(1)}${st.splash ? ' splash' : ''}`, '#39FF14');
  }
  if (s.type === 'research_node') {
    html += stat('RESEARCH', state.research.current ? 1 : 0, state.research.current ? `${researchSpeed(state).toFixed(1)}×` : 'idle', '#E879F9');
  }
  if (s.type === 'core' || s.type === 'storage') {
    html += stat('CAPACITY', 1, `${storageCap(state)} each`, '#A855F7');
  }
  for (const i of diagnose(state, s)) html += `<div class="issue ${i.level}">⚠ ${esc(i.text)}</div>`;
  html += `<p class="sub" style="margin:8px 0 0">${esc(def.desc)}</p>`;
  html += '<div class="row">';
  const uc = upgradeCost(s);
  if (def.upgrade) {
    html += uc
      ? `<button class="btn green" data-act="upgrade" ${canAfford(state, uc) ? '' : 'disabled'}>UPGRADE<small>${costHtml(uc)}</small></button>`
      : '<button class="btn ghost" disabled>MAX LEVEL</button>';
  }
  if (isPausable(s)) html += s.paused ? '<button class="btn" data-act="toggle-pause">RESUME<small>restore power draw</small></button>' : '<button class="btn ghost" data-act="toggle-pause">PAUSE<small>free its power</small></button>';
  if (s.hp < maxHp(s)) html += '<button class="btn yellow" data-act="repair-hint">REPAIR<small>stand close, hold MINE/REPAIR</small></button>';
  if (s.type !== 'core') html += (confirm ? '<button class="btn red" data-act="deconstruct">CONFIRM RECYCLE<small>tap again</small></button>' : '<button class="btn red" data-act="deconstruct">RECYCLE<small>75% refund</small></button>');
  html += '</div>';
  return html;
}

export function renderNetwork(state) {
  const r = networkReport(state);
  const eff = r.potential > 0 ? r.actual / r.potential : 1;
  const issues = r.issues.length ? r.issues.map((t) => `<div class="issue bad">⚠ ${esc(t)}</div>`).join('') : '<div class="issue good">No bottlenecks detected.</div>';
  return `<button class="close" data-act="close">×</button>
  <h2>NETWORK OVERVIEW</h2>
  <p class="lead">Production capacity is not the same as actual output. Find the bottleneck.</p>
  <div class="kv">
    <div><span>EXTRACTION CAPACITY</span><b class="scrap">${r.potential.toFixed(0)}/min</b></div>
    <div><span>ACTUAL EXTRACTION</span><b class="${eff < 0.8 ? 'bad' : 'good'}">${r.actual.toFixed(0)}/min · ${Math.round(eff * 100)}%</b></div>
    <div><span>DELIVERED TO STORAGE</span><b class="scrap">${r.delivered.toFixed(0)}/min</b></div>
    <div><span>DRONE TRANSPORT</span><b class="components">${r.throughput.toFixed(0)}/min · ${r.drones} drones</b></div>
    <div><span>COMPONENTS</span><b class="components">${r.components.toFixed(1)}/min</b></div>
    <div><span>EXTRACTOR BUFFERS</span><b>${Math.floor(r.buffered)}/${r.bufferMax}</b></div>
    <div><span>POWER</span><b class="${state.power.ratio < 0.999 ? 'bad' : 'good'}">${state.power.production.toFixed(1)} / ${state.power.consumption.toFixed(1)}</b></div>
    <div><span>STORAGE CAP</span><b>${r.cap}</b></div>
  </div>
  <h4 style="font-family:Unbounded;font-size:10px;letter-spacing:.14em;color:#E879F9;margin:12px 0 4px">ISSUES</h4>
  ${issues}
  <div class="kv">
    <div><span>ATTACKS SURVIVED</span><b class="good">${state.stats.wavesSurvived}</b></div>
    <div><span>HOSTILES DESTROYED</span><b>${state.stats.enemiesKilled}</b></div>
    <div><span>STRUCTURES LOST</span><b class="bad">${state.stats.structuresLost}</b></div>
    <div><span>DRONE DELIVERIES</span><b>${fmt(state.stats.droneDelivered)}</b></div>
  </div>`;
}

export function renderResearch(state) {
  const branches = ['automation', 'industry', 'defense', 'autonomy'];
  const cur = state.research.current ? RESEARCH.find((r) => r.id === state.research.current) : null;
  let html = `<button class="close" data-act="close">×</button><h2>RESEARCH</h2>
    <p class="lead">Technologies change the rules of your network. Requires a powered Research Node and Data.</p>`;
  if (cur) {
    const speed = researchSpeed(state);
    const left = speed > 0 ? (cur.time - state.research.progress) / speed : Infinity;
    html += `<div class="tech current"><span class="tn">${esc(cur.name)}</span><div class="progress"><i style="width:${(state.research.progress / cur.time) * 100}%"></i></div>
      <span class="tc">${speed > 0 ? `${Math.ceil(left)}s remaining · ${speed.toFixed(1)}×` : 'STALLED — no powered Research Node'}</span>
      <div class="row"><button class="btn ghost" data-act="cancel-research">CANCEL (refund)</button></div></div>`;
  }
  html += '<div class="tree">';
  for (const b of branches) {
    html += `<div class="branch"><h4>${b.toUpperCase()}</h4>`;
    for (const tech of RESEARCH.filter((r) => r.branch === b)) {
      const st = researchStatus(state, tech.id);
      const chk = canStartResearch(state, tech.id);
      const req = tech.requires.map((id) => RESEARCH.find((r) => r.id === id).name).join(', ');
      html += `<div class="tech ${st}"><span class="tn">${st === 'unlocked' ? '✓ ' : ''}${esc(tech.name)}</span>
        <p>${esc(tech.desc)}</p>
        <span class="tc">${costHtml(tech.cost)} · ${tech.time}s${req ? ` · needs ${esc(req)}` : ''}</span>
        ${st === 'available' ? `<div class="row"><button class="btn magenta" data-act="research" data-id="${tech.id}" ${chk.ok ? '' : 'disabled'}>${chk.ok ? 'RESEARCH' : esc(chk.reason.toUpperCase())}</button></div>` : ''}
      </div>`;
    }
    html += '</div>';
  }
  return `${html}</div>`;
}

export function renderOfflineReport(report, offer) {
  const g = report.gains;
  const sign = (v) => `${v >= 0 ? '+' : ''}${fmt(v)}`;
  const notes = report.notes.map((n) => `<div class="issue ${n.level}">${esc(n.text)}</div>`).join('');
  return `<h2>OFFLINE REPORT</h2>
    <p class="lead">Away ${fmtDur(report.away)} · your network kept running.</p>
    <div class="kv">
      <div><span>SCRAP</span><b class="scrap">${sign(g.scrap)}</b></div>
      <div><span>COMPONENTS</span><b class="components">${sign(g.components)}</b></div>
      <div><span>DATA</span><b class="data">${sign(g.data)}</b></div>
      <div><span>THREAT EVENTS</span><b>${report.waves}</b></div>
      <div><span>DEFENSES HELD</span><b class="${report.held === report.waves ? 'good' : 'bad'}">${report.held}</b></div>
      <div><span>LOST PRODUCTION</span><b class="${report.lostProductionPct > 0.15 ? 'bad' : 'good'}">~${Math.round(report.lostProductionPct * 100)}%</b></div>
    </div>
    ${notes}
    <div class="row">
      ${offer ? `<button class="btn yellow" data-act="reward" data-placement="offline_recovery">RECOVER DAMAGED SHIPMENT<small>optional · +25% salvage · in-game only</small></button>` : ''}
      <button class="btn green" data-act="close">CONTINUE</button>
    </div>
    <p class="fine">Base offline earnings are already in your storage. Optional bonuses never pay cash and are never required.</p>`;
}

export function renderEmergency(state, offer) {
  const lost = state.emergency.lost;
  return `<h2>CORE OVERWHELMED</h2>
    <p class="lead">Emergency recovery engaged. Hostiles were purged; the Core rebooted at 50% integrity. Your network and save are intact.</p>
    <div class="kv">
      <div><span>SCRAP LOST</span><b class="bad">-${lost.scrap}</b></div>
      <div><span>COMPONENTS LOST</span><b class="bad">-${lost.components}</b></div>
    </div>
    <div class="issue warn">Tip: more turrets near the Core and repairs between attacks keep it standing. Expansion raises threat.</div>
    <div class="row">
      ${offer ? `<button class="btn yellow" data-act="reward" data-placement="emergency_recovery">EMERGENCY ASSISTANCE<small>optional · recover 50% of losses</small></button>` : ''}
      <button class="btn green" data-act="close">RECOVER</button>
    </div>`;
}

export function renderMenu(state, opts) {
  const a = state.monetization.analytics;
  return `<button class="close" data-act="close">×</button>
    <h2>SYSTEM MENU</h2>
    <p class="lead">Sector ${state.sector.id} · ${state.sector.biome.toUpperCase()} · seed ${state.seed} · play time ${fmtDur(state.stats.playTime)}</p>
    <div class="row">
      <button class="btn" data-act="sound">${opts.sound ? 'SOUND: ON' : 'SOUND: OFF'}</button>
      <button class="btn" data-act="save">SAVE NOW</button>
      <button class="btn yellow" data-act="reward" data-placement="scanner_boost" ${opts.scanner.ok ? '' : 'disabled'}>SCANNER BOOST<small>${opts.scanner.ok ? 'optional · reveal area' : esc(opts.scanner.text)}</small></button>
    </div>
    <div class="row"><button class="btn red" data-act="new-game">NEW NETWORK</button></div>
    <h4 style="font-family:Unbounded;font-size:10px;letter-spacing:.14em;color:#E879F9;margin:16px 0 4px">CONTROLS</h4>
    <p class="fine" style="margin-top:0">Touch: drag left side to move, drag right side to aim &amp; fire, tap to select/place. Hold MINE near deposits or damaged buildings.<br>
    Keyboard: WASD move · mouse aim · hold click/Space fire · E interact · B build · 1–9 pick building · N network · R research · Esc cancel.</p>
    <h4 style="font-family:Unbounded;font-size:10px;letter-spacing:.14em;color:#E879F9;margin:16px 0 4px">REWARDS POLICY</h4>
    <p class="fine" style="margin-top:0">Optional rewards give non-transferable in-game benefits only. HARVEST//ZERO never offers cash for watching, clicking, or completing anything, and never interrupts combat.
    The game is complete without them. Current build uses a simulated test provider: no real ads, no revenue.<br>
    Offers shown ${a.offersShown} · accepted ${a.accepted} · declined ${a.refused}</p>`;
}

export function renderTitle(hasSave) {
  return `<div class="title"><div class="sun"></div><h1>HARVEST//ZERO</h1>
    <p class="tag">Build a machine that eventually no longer needs you.</p>
    <div class="row">
      ${hasSave ? '<button class="btn green" data-act="continue">CONTINUE</button>' : ''}
      <button class="btn magenta" data-act="${hasSave ? 'new-game' : 'start'}">${hasSave ? 'NEW NETWORK' : 'BOOT CORE'}</button>
    </div>
    <p class="fine">A LegitLoot game · v0.1 prototype</p></div>`;
}

export function renderMockPrompt(req, seconds) {
  return `<div class="mock-ad"><span class="badge">TEST MODE · SIMULATED SPONSOR</span>
    <h2 style="margin-top:8px">${esc(req.label)}</h2>
    <p class="lead">${esc(req.description)}</p>
    <div class="screen" id="mock-screen">No real ad is shown and no revenue is generated.<br>Completing in ${seconds}s…</div>
    <div class="row"><button class="btn ghost" data-act="mock-cancel">CANCEL</button><button class="btn yellow" data-act="mock-complete" id="mock-complete" disabled>COMPLETE</button></div>
    <p class="fine">Rewards are in-game only and cannot be transferred or exchanged for cash.</p></div>`;
}

export { isDisrupted };
