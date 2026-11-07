import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveManager, MemoryStorage } from '../src/core/save.js';
import { newGame, run } from './helpers.js';

test('save/load round-trips the game', () => {
  const store = new MemoryStorage();
  const sm = new SaveManager(store);
  const s = newGame(77);
  run(s, 5);
  assert.equal(sm.save(s, 1000).ok, true);
  const loaded = sm.load().state;
  assert.deepEqual(loaded.resources, s.resources);
  assert.equal(loaded.lastActiveAt, 1000);
  assert.deepEqual(loaded.events, []);
});

test('rotates backups and falls back when the newest slot is corrupt', () => {
  const store = new MemoryStorage();
  const sm = new SaveManager(store);
  const s = newGame(1);
  s.resources.scrap = 111; sm.save(s, 1);
  s.resources.scrap = 222; sm.save(s, 2);
  s.resources.scrap = 333; sm.save(s, 3);
  assert.equal(sm.load().state.resources.scrap, 333);
  store.setItem('harvestzero_save_0', store.getItem('harvestzero_save_0').replace('333', '999'));
  const r = sm.load();
  assert.equal(r.slot, 1);
  assert.equal(r.state.resources.scrap, 222);
});

test('failed write leaves previous save intact', () => {
  const store = new MemoryStorage();
  const sm = new SaveManager(store);
  const s = newGame(2);
  s.resources.scrap = 50; sm.save(s, 1);
  const orig = store.setItem.bind(store);
  store.setItem = (k, v) => { if (k.endsWith('_tmp')) throw new Error('quota'); orig(k, v); };
  s.resources.scrap = 60;
  assert.equal(sm.save(s, 2).ok, false);
  assert.equal(sm.load().state.resources.scrap, 50);
});
