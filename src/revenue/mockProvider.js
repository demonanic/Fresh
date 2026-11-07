// MockRewardProvider (GDD §39): exercises the reward flow without any real ad network.
// It never contacts the network and never earns revenue.
//
// mode 'prompt': delegates to a UI callback that shows a clearly-labelled simulated offer.
// mode 'auto-complete' / 'auto-cancel' / 'auto-error': deterministic outcomes for tests.
let counter = 0;

export class MockRewardProvider {
  constructor({ mode = 'prompt', prompt = null, idPrefix = 'mock' } = {}) {
    this.id = 'mock';
    this.mode = mode;
    this.prompt = prompt;
    this.idPrefix = idPrefix;
    this.ready = true;
  }

  isReady() { return this.ready; }

  newEventId() {
    counter++;
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    return `${this.idPrefix}:${Date.now().toString(36)}:${counter}:${rand}`;
  }

  async show(req) {
    if (this.mode === 'auto-error') return { completed: false, error: 'mock_error' };
    if (this.mode === 'auto-cancel') return { completed: false };
    if (this.mode === 'auto-complete') return { completed: true, eventId: this.newEventId() };
    if (!this.prompt) return { completed: false, error: 'no_prompt_ui' };
    const completed = await this.prompt(req);
    return completed ? { completed: true, eventId: this.newEventId() } : { completed: false };
  }
}
