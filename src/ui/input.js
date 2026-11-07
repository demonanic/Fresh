// Unified input: twin-stick touch + keyboard/mouse.
// Touch: drag on the left half = move stick, drag on the right half = aim & fire stick,
// short tap anywhere = world tap (select / place).
// Desktop: WASD/arrows move, mouse aims, hold left mouse on open ground or Space to fire,
// E to interact, B build menu, Esc cancel.
export class Input {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.handlers = handlers; // { onTap(sx, sy), onHover(sx, sy), onKey(key) }
    this.keys = new Set();
    this.sticks = [];
    this.pointers = new Map();
    this.mouse = { x: 0, y: 0, inside: false, firing: false };
    this.interactHeld = false;
    this.usingTouch = false;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.handlers.onKey && this.handlers.onKey(k);
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this.sticks = []; this.mouse.firing = false; });
  }

  rel(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    const p = this.rel(e);
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.usingTouch = true;
      const kind = p.x < this.canvas.clientWidth / 2 ? 'move' : 'aim';
      const stick = { id: e.pointerId, kind, ox: p.x, oy: p.y, dx: 0, dy: 0, active: false, t: performance.now() };
      this.pointers.set(e.pointerId, stick);
      this.sticks.push(stick);
    } else {
      this.usingTouch = false;
      this.mouse.x = p.x; this.mouse.y = p.y;
      if (e.button === 2) { this.mouse.firing = true; return; }
      if (e.button === 0) {
        const consumed = this.handlers.onTap && this.handlers.onTap(p.x, p.y);
        if (!consumed) this.mouse.firing = true;
      }
    }
  }

  move(e) {
    const stick = this.pointers.get(e.pointerId);
    if (stick) {
      const p = this.rel(e);
      const dx = p.x - stick.ox;
      const dy = p.y - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > 12) stick.active = true;
      const k = Math.min(1, d / 48) / (d || 1);
      stick.dx = dx * k;
      stick.dy = dy * k;
      return;
    }
    if (e.pointerType === 'mouse') {
      const p = this.rel(e);
      this.mouse.x = p.x; this.mouse.y = p.y;
      this.mouse.inside = true;
      this.handlers.onHover && this.handlers.onHover(p.x, p.y);
    }
  }

  up(e) {
    const stick = this.pointers.get(e.pointerId);
    if (stick) {
      this.pointers.delete(e.pointerId);
      this.sticks = this.sticks.filter((s) => s !== stick);
      if (!stick.active && performance.now() - stick.t < 350) this.handlers.onTap && this.handlers.onTap(stick.ox, stick.oy);
      return;
    }
    if (e.pointerType === 'mouse') this.mouse.firing = false;
  }

  /** Build the per-tick input object for the simulation. */
  sample(playerScreen) {
    let mx = 0; let my = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
    let aim = null;
    let fire = false;
    for (const s of this.sticks) {
      if (!s.active) continue;
      if (s.kind === 'move') { mx = s.dx; my = s.dy; } else if (Math.hypot(s.dx, s.dy) > 0.25) { aim = { x: s.dx, y: s.dy }; fire = true; }
    }
    if (!this.usingTouch && this.mouse.inside && playerScreen) {
      aim = { x: this.mouse.x - playerScreen.x, y: this.mouse.y - playerScreen.y };
      if (this.mouse.firing || this.keys.has(' ')) fire = true;
    }
    return { move: { x: mx, y: my }, aim, fire, interact: this.interactHeld || this.keys.has('e') };
  }
}
