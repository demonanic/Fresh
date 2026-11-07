import { BALANCE } from './data/balance.js';
import { BUILDINGS, BUILD_ORDER } from './data/buildings.js';
import { REWARD_PLACEMENTS } from './data/rewards.js';
import {
  createNewGame, build, structureAt, upgrade, deconstruct, canPlace,
} from './core/state.js';
import { SaveManager } from './core/save.js';
import { stepGame } from './sim/step.js';
import { simulateOffline } from './sim/offline.js';
import { startResearch, cancelResearch } from './sim/research.js';
import { render, computeView, screenToWorld } from './ui/render.js';
import { Input } from './ui/input.js';
import { Soundtrack } from './ui/audio.js';
import * as HUD from './ui/hud.js';
import { RewardGateway } from './revenue/rewardGateway.js';
import { MockRewardProvider } from './revenue/mockProvider.js';
import { applyBenefit } from './revenue/benefits.js';

const $ = (id) => document.getElementById(id);
const TICK = BALANCE.sim.tickSec;

function safeStorage() {
  try { const k = '__hz'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch { return null; }
}

class Game {
  constructor() {
    this.canvas = $('game');
    this.ctx = this.canvas.getContext('2d');
    this.state = null;
    this.ui = { buildType: null, selectedId: null, hoverTile: null, particles: [], sticks: [], modal: null, speed: 1 };
    const storage = safeStorage();
    this.saves = storage ? new SaveManager(storage) : null;
    this.audio = new Soundtrack();
    this.audio.enabled = !(storage && storage.getItem('harvestzero_sound') === '0');
    this.input = new Input(this.canvas, {
      onTap: (x, y) => this.onTap(x, y),
      onHover: (x, y) => this.onHover(x, y),
      onKey: (k) => this.onKey(k),
    });
    this.mock = new MockRewardProvider({ prompt: (req) => this.mockPrompt(req) });
    this.gateway = new RewardGateway({ placements: REWARD_PLACEMENTS, providers: [this.mock] });
    this.saveTimer = 0;
    this.hudTimer = 0;
    this.panelTimer = 0;
    this.offerTimer = null;
    this.lastReport = null;
    this.bindDom();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.onExit());
    this.showTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- lifecycle ----------
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth; const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ts = Math.max(22, Math.min(44, Math.round(Math.min(w / 24, h / 14))));
  }

  save() {
    if (!this.state || !this.saves) return;
    const now = Date.now();
    this.state.lastActiveAt = now;
    const r = this.saves.save(this.state, now);
    if (!r.ok) this.toast(`Save failed: ${r.error}`, 'bad');
  }

  startGame(state, isNew) {
    this.state = state;
    state.monetization.analytics.sessions++;
    this.ui.selectedId = null;
    this.ui.buildType = null;
    $('panel').hidden = true;
    $('buildbar').hidden = true;
    this.closeModal();
    if (isNew) {
      this.toast('CORE ONLINE. Mine Scrap from the orange deposits and bring it home.', 'good');
      this.save();
    }
  }

  continueGame() {
    const loaded = this.saves && this.saves.load();
    if (!loaded) { this.startGame(createNewGame(), true); return; }
    this.startGame(loaded.state, false);
    if (loaded.slot > 0) this.toast('Latest save was damaged — restored from backup', 'bad');
    this.runOffline((Date.now() - (loaded.state.lastActiveAt || Date.now())) / 1000);
  }

  runOffline(elapsedSec) {
    if (!this.state) return;
    const report = simulateOffline(this.state, elapsedSec);
    this.state.events.length = 0;
    if (!report) return;
    this.lastReport = report;
    this.save();
    const offer = this.gateway.availability('offline_recovery', this.state.monetization).ok && Object.values(report.gains).some((v) => v > 0);
    if (offer) this.gateway.noteOfferShown(this.state.monetization);
    this.openModal(HUD.renderOfflineReport(report, offer), 'offline');
  }

  onVisibility() {
    if (!this.state) return;
    if (document.hidden) { this.hiddenAt = Date.now(); this.save(); return; }
    if (this.hiddenAt) {
      const away = (Date.now() - this.hiddenAt) / 1000;
      this.hiddenAt = null;
      this.last = performance.now();
      if (away >= BALANCE.offline.minSec) this.runOffline(away);
    }
  }

  onExit() {
    if (!this.state) return;
    const a = this.state.monetization.analytics;
    if (a.lastOfferAt && Date.now() - a.lastOfferAt < 15000) a.exitsAfterOffer++;
    this.save();
  }

  // ---------- main loop ----------
  frame(now) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const s = this.state;
    if (s) {
      if (!this.ui.modal) {
        this.acc = (this.acc || 0) + dt * this.ui.speed;
        let steps = 0;
        while (this.acc >= TICK && steps++ < 12) {
          stepGame(s, TICK, this.input.sample(this.playerScreen()));
          this.acc -= TICK;
        }
        if (steps >= 12) this.acc = 0;
        this.drainEvents();
        this.saveTimer += dt;
        if (this.saveTimer >= BALANCE.autosaveSec) { this.saveTimer = 0; this.save(); }
      }
      this.updateParticles(dt);
      this.ui.sticks = this.input.sticks;
      this.view = computeView(s, window.innerWidth, window.innerHeight, this.ts);
      render(this.ctx, s, this.view, this.ui, this.dpr);
      this.hudTimer += dt;
      if (this.hudTimer > 0.1) { this.hudTimer = 0; this.updateHud(); }
      const intensity = s.threat.waveActive ? 3 : s.threat.rate > 1.4 ? 2 : s.threat.rate > 0.5 ? 1 : 0;
      this.audio.setIntensity(intensity);
    } else {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.fillStyle = '#0a0b10';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  playerScreen() {
    if (!this.view) return null;
    const p = this.state.player;
    return { x: (p.x - this.view.x) * this.ts, y: (p.y - this.view.y) * this.ts };
  }

  updateHud() {
    const s = this.state;
    HUD.updateTopbar(s);
    HUD.updateObjective(s);
    HUD.updateInteractButton(s);
    $('btn-build').textContent = this.ui.buildType ? 'CANCEL' : ($('buildbar').hidden ? 'BUILD' : 'CLOSE');
    $('btn-build').classList.toggle('on', !!this.ui.buildType);
    $('btn-speed').textContent = `${this.ui.speed}×`;
    this.panelTimer++;
    if (this.panelTimer % 4 === 0) {
      if (!$('panel').hidden) {
        const sel = s.structures.find((x) => x.id === this.ui.selectedId);
        if (!sel) { $('panel').hidden = true; this.ui.selectedId = null; } else setHtml($('panel'), HUD.renderPanel(s, sel, this.ui.confirmId === sel.id));
      }
      if (!$('buildbar').hidden) setHtml($('buildbar'), buildBarHtml(s, this.ui.buildType));
      if (this.ui.modal === 'research') setHtml($('modal-card'), HUD.renderResearch(s));
      if (this.ui.modal === 'network') setHtml($('modal-card'), HUD.renderNetwork(s));
    }
    let hint = '';
    if (this.ui.buildType) {
      const d = BUILDINGS[this.ui.buildType];
      hint = d.needsNode ? `Tap a highlighted deposit to place ${d.name}` : `Tap an explored empty tile to place ${d.name}`;
    }
    $('hint').textContent = hint;
  }

  drainEvents() {
    const s = this.state;
    for (const e of s.events) {
      switch (e.type) {
        case 'log': this.toast(e.text, e.kind); break;
        case 'built': {
          const st = s.structures.find((x) => x.id === e.id);
          if (st) this.burst(st.x + 0.5, st.y + 0.5, BUILDINGS[st.type].color, 0, 1.2);
          this.audio.sfxBuild();
          break;
        }
        case 'kill': this.burst(e.x, e.y, e.color, 10); this.audio.sfxKill(); break;
        case 'impact': this.burst(e.x, e.y, e.color, 3); break;
        case 'destroyed': this.burst(e.x, e.y, '#FF6600', 24, 1.8); this.audio.sfxBad(); break;
        case 'waveStarted': this.audio.sfxAlarm(); break;
        case 'waveCleared': this.audio.sfxGood(); this.offerWaveSalvage(e.wave); break;
        case 'researched': case 'mission': this.audio.sfxGood(); break;
        case 'playerDown': this.audio.sfxBad(); break;
        case 'emergency': this.showEmergency(); break;
        default: break;
      }
    }
    s.events.length = 0;
  }

  burst(x, y, color, n = 8, ring = 0) {
    const P = this.ui.particles;
    if (ring) P.push({ x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, color, ring });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const v = 1 + Math.random() * 4;
      P.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7, color });
    }
    if (P.length > 400) P.splice(0, P.length - 400);
  }

  updateParticles(dt) {
    for (const p of this.ui.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
    this.ui.particles = this.ui.particles.filter((p) => p.life > 0);
  }

  // ---------- input ----------
  onHover(sx, sy) {
    if (!this.state || !this.view) return;
    const w = screenToWorld(this.view, sx, sy);
    this.ui.hoverTile = { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  onTap(sx, sy) {
    if (!this.state || this.ui.modal || !this.view) return true;
    this.audio.start();
    const w = screenToWorld(this.view, sx, sy);
    const tx = Math.floor(w.x); const ty = Math.floor(w.y);
    this.ui.hoverTile = { x: tx, y: ty };
    if (this.ui.buildType) {
      const r = build(this.state, this.ui.buildType, tx, ty);
      if (!r.ok) this.toast(r.reason, 'bad');
      this.drainEvents();
      return true;
    }
    const s = structureAt(this.state, tx, ty);
    if (s) { this.select(s); return true; }
    if (!$('panel').hidden) { this.deselect(); return true; }
    return false;
  }

  onKey(k) {
    this.audio.start();
    if (k === 'escape') {
      if (this.ui.modal && this.ui.modal !== 'title' && this.ui.modal !== 'mock') this.closeModal();
      else if (this.ui.buildType) this.setBuildType(null);
      else if (!$('buildbar').hidden) $('buildbar').hidden = true;
      else this.deselect();
      return;
    }
    if (!this.state || this.ui.modal) return;
    if (k === 'b') this.toggleBuildBar();
    else if (k === 'n') this.openNetwork();
    else if (k === 'r') this.openResearch();
    else if (/^[1-9]$/.test(k)) {
      const type = BUILD_ORDER[Number(k) - 1];
      if (type) { $('buildbar').hidden = false; this.setBuildType(type); }
    }
  }

  select(s) {
    this.ui.selectedId = s.id;
    this.ui.confirmId = null;
    $('panel').hidden = false;
    $('buildbar').hidden = true;
    forceHtml($('panel'), HUD.renderPanel(this.state, s, this.ui.confirmId === s.id));
  }

  deselect() { this.ui.selectedId = null; $('panel').hidden = true; }

  toggleBuildBar() {
    if (this.ui.buildType) { this.setBuildType(null); return; }
    const bar = $('buildbar');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) { this.deselect(); forceHtml(bar, buildBarHtml(this.state, null)); }
  }

  setBuildType(type) {
    if (type) {
      const d = BUILDINGS[type];
      if (d.requires && !this.state.research.unlocked.includes(d.requires)) { this.toast(`${d.name} requires research`, 'bad'); return; }
    }
    this.ui.buildType = type;
    forceHtml($('buildbar'), buildBarHtml(this.state, type));
    if (type) this.deselect();
  }

  // ---------- DOM wiring ----------
  bindDom() {
    $('btn-build').addEventListener('click', () => { this.audio.start(); if (this.state) this.toggleBuildBar(); });
    const ib = $('btn-interact');
    const setHeld = (v) => { this.input.interactHeld = v; ib.classList.toggle('held', v); };
    ib.addEventListener('pointerdown', (e) => { e.preventDefault(); this.audio.start(); setHeld(true); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) ib.addEventListener(ev, () => setHeld(false));
    $('btn-speed').addEventListener('click', () => { this.ui.speed = this.ui.speed >= 3 ? 1 : this.ui.speed + 1; });
    $('btn-menu').addEventListener('click', () => this.openMenu());
    $('btn-network').addEventListener('click', () => this.openNetwork());
    $('btn-research').addEventListener('click', () => this.openResearch());

    trackPress($('panel'));
    trackPress($('modal-card'));
    trackPress($('buildbar'));

    $('buildbar').addEventListener('click', (e) => {
      const card = e.target.closest('.bcard');
      if (!card) return;
      const type = card.dataset.type;
      this.setBuildType(this.ui.buildType === type ? null : type);
    });

    $('panel').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !this.state) return;
      const s = this.state.structures.find((x) => x.id === this.ui.selectedId);
      const act = btn.dataset.act;
      if (act === 'close') { this.deselect(); return; }
      if (!s) return;
      if (act === 'upgrade') { const r = upgrade(this.state, s); if (!r.ok) this.toast(r.reason, 'bad'); else this.audio.sfxBuild(); }
      if (act === 'deconstruct') {
        if (this.ui.confirmId === s.id) { this.ui.confirmId = null; deconstruct(this.state, s); this.deselect(); return; }
        this.ui.confirmId = s.id;
      }
      if (act === 'toggle-pause') s.paused = !s.paused;
      if (act === 'repair-hint') this.toast('Walk your Operator next to it and hold REPAIR (or E). Costs a little Scrap.');
      forceHtml($('panel'), HUD.renderPanel(this.state, s, this.ui.confirmId === s.id));
    });

    $('modal-card').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this.audio.start();
      const act = btn.dataset.act;
      switch (act) {
        case 'close': this.closeModal(); break;
        case 'start': this.startGame(createNewGame(), true); break;
        case 'continue': this.continueGame(); break;
        case 'new-game':
          if (!btn.dataset.confirm) { btn.dataset.confirm = '1'; btn.textContent = 'TAP AGAIN — ERASES SAVE'; return; }
          if (this.saves) this.saves.clear();
          this.startGame(createNewGame(), true);
          break;
        case 'research': {
          const r = startResearch(this.state, btn.dataset.id);
          if (!r.ok) this.toast(r.reason, 'bad');
          this.drainEvents();
          forceHtml($('modal-card'), HUD.renderResearch(this.state));
          break;
        }
        case 'cancel-research': cancelResearch(this.state); forceHtml($('modal-card'), HUD.renderResearch(this.state)); break;
        case 'sound':
          this.audio.setEnabled(!this.audio.enabled);
          try { localStorage.setItem('harvestzero_sound', this.audio.enabled ? '1' : '0'); } catch { /* ignore */ }
          this.openMenu();
          break;
        case 'save': this.save(); this.toast('Network state saved', 'good'); break;
        case 'reward': this.requestReward(btn.dataset.placement); break;
        default: break;
      }
    });

    $('offer').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const wave = Number($('offer').dataset.wave);
      this.hideOffer(btn.dataset.act !== 'claim');
      if (btn.dataset.act === 'claim') this.requestReward('wave_salvage', { wave });
    });
  }

  openModal(html, kind) {
    this.ui.modal = kind;
    forceHtml($('modal-card'), html);
    $('modal').hidden = false;
  }

  closeModal() {
    this.ui.modal = null;
    $('modal').hidden = true;
    this.last = performance.now();
  }

  showTitle() {
    const hasSave = !!(this.saves && this.saves.load());
    this.openModal(HUD.renderTitle(hasSave), 'title');
  }

  openMenu() {
    if (!this.state) return;
    const av = this.gateway.availability('scanner_boost', this.state.monetization, { inCombat: this.state.threat.waveActive });
    const text = { cooldown: `recharging ${av.remainingSec}s`, in_combat: 'unavailable during attacks', daily_cap: 'daily limit reached', paused: 'rewards paused', no_provider: 'unavailable' }[av.reason] || '';
    this.openModal(HUD.renderMenu(this.state, { sound: this.audio.enabled, scanner: { ok: av.ok, text } }), 'menu');
  }

  openNetwork() { if (this.state) this.openModal(HUD.renderNetwork(this.state), 'network'); }

  openResearch() { if (this.state) this.openModal(HUD.renderResearch(this.state), 'research'); }

  showEmergency() {
    const offer = this.gateway.availability('emergency_recovery', this.state.monetization).ok;
    if (offer) this.gateway.noteOfferShown(this.state.monetization);
    this.openModal(HUD.renderEmergency(this.state, offer), 'emergency');
    this.save();
  }

  toast(text, kind = 'info') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 3200);
    setTimeout(() => el.remove(), 3800);
  }

  // ---------- optional rewards ----------
  offerWaveSalvage(wave) {
    const m = this.state.monetization;
    if (!this.gateway.availability('wave_salvage', m, { inCombat: this.state.threat.waveActive }).ok) return;
    const el = $('offer');
    el.dataset.wave = String(wave);
    el.innerHTML = `<span>Attack ${wave} repelled. Optional: extra salvage run</span>
      <button data-act="claim">SALVAGE ▶</button><button class="x" data-act="dismiss">✕</button>`;
    el.hidden = false;
    this.gateway.noteOfferShown(m);
    clearTimeout(this.offerTimer);
    this.offerTimer = setTimeout(() => this.hideOffer(true), 20000);
  }

  hideOffer(refused) {
    const el = $('offer');
    if (el.hidden) return;
    el.hidden = true;
    clearTimeout(this.offerTimer);
    if (refused && this.state) this.gateway.noteRefused(this.state.monetization);
  }

  mockPrompt(req) {
    return new Promise((resolve) => {
      const prev = this.ui.modal;
      this.openModal(HUD.renderMockPrompt(req, 3), 'mock');
      let left = 3;
      const tick = setInterval(() => {
        left--;
        const screen = $('mock-screen');
        if (screen) screen.innerHTML = left > 0 ? `No real ad is shown and no revenue is generated.<br>Completing in ${left}s…` : 'Simulation complete.';
        if (left <= 0) { clearInterval(tick); const b = $('mock-complete'); if (b) b.disabled = false; }
      }, 1000);
      const card = $('modal-card');
      const handler = (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn || (btn.dataset.act !== 'mock-complete' && btn.dataset.act !== 'mock-cancel')) return;
        e.stopImmediatePropagation();
        card.removeEventListener('click', handler, true);
        clearInterval(tick);
        this.ui.modal = prev;
        resolve(btn.dataset.act === 'mock-complete');
      };
      card.addEventListener('click', handler, true);
    });
  }

  async requestReward(placementId, extra = {}) {
    const s = this.state;
    if (!s) return;
    const ctx = { ...extra, report: this.lastReport };
    const returnTo = this.ui.modal;
    const res = await this.gateway.request(placementId, s.monetization, (benefit) => applyBenefit(s, benefit, ctx), { inCombat: s.threat.waveActive });
    if (res.status === 'granted') {
      const got = res.applied || {};
      const parts = Object.entries(got).filter(([k, v]) => k !== 'revealed' && v > 0).map(([k, v]) => `+${v} ${k}`);
      this.toast(placementId === 'scanner_boost' ? 'Scanner pulse: area revealed' : `Bonus received ${parts.join(' ')}`, 'good');
      this.audio.sfxGood();
      this.save();
    } else if (res.status === 'unavailable') {
      this.toast(`Bonus unavailable (${res.reason.replace('_', ' ')})`, 'bad');
    } else if (res.status === 'error') {
      this.toast('Bonus provider error — nothing was changed', 'bad');
    }
    // Return to the screen the offer came from, without the offer if it was used.
    if (returnTo === 'offline' && this.lastReport) {
      const again = res.status !== 'granted' && this.gateway.availability('offline_recovery', s.monetization).ok;
      this.openModal(HUD.renderOfflineReport(this.lastReport, again), 'offline');
    } else if (returnTo === 'emergency' && s.emergency) {
      this.openModal(HUD.renderEmergency(s, res.status !== 'granted' && !s.emergency.recovered), 'emergency');
    } else if (returnTo === 'menu') {
      this.openMenu();
    } else {
      this.closeModal();
    }
  }
}

function buildBarHtml(state, sel) { return HUD.renderBuildBar(state, sel); }

function forceHtml(el, html) { el._last = html; el.innerHTML = html; }

/** Replace innerHTML only when it changed and the user is not mid-press (so clicks are never lost). */
function setHtml(el, html) {
  if (el._pressing || el._last === html) return;
  el._last = html;
  el.innerHTML = html;
}

function trackPress(el) {
  el.addEventListener('pointerdown', () => { el._pressing = true; });
  const off = () => { setTimeout(() => { el._pressing = false; }, 50); };
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}

// Expose for debugging / automated smoke tests.
window.HZ = new Game();
window.HZ_canPlace = canPlace;
