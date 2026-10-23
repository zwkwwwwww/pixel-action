// 破防硬直：正面吃重击后盾牌被打开，一段时间内不再格挡。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES } from '../src/core/ai.js';
import { ATTACKS } from '../src/core/attacks.js';

function shieldWorld() {
  return createWorld({
    player: { x: 100, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'sh', x: 118, y: 40, hp: 400, maxHp: 400, kind: 'shield',
      facing: -1, ai: AI_PROFILES.shield,
    }],
  });
}

test('正面重斩触发破防并推 guardBreak 事件', () => {
  const w = shieldWorld();
  const e = w.enemies[0];
  w.press('heavy');
  let ev = null;
  for (let i = 0; i < 40 && !ev; i++) {
    step(w);
    ev = w.events.find((x) => x.type === 'guardBreak');
  }
  assert.ok(ev, '重斩应触发 guardBreak');
  assert.ok(e.guardBreak > 0, `盾兵应进入破防状态，实际 ${e.guardBreak}`);
});

test('破防期间不再格挡：下次轻击打出全额伤害', () => {
  const w = shieldWorld();
  const e = w.enemies[0];
  // 先重斩破防
  w.press('heavy');
  for (let i = 0; i < 40; i++) step(w);
  assert.ok(e.guardBreak > 0, '前提：已破防');

  const before = e.hp;
  // 关键：先清空事件队列 —— 否则会抓到上一发重斩的 hit 事件（此时伤害还没结算）
  w.events.length = 0;
  w.press('attack');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    step(w);
    hit = w.events.find((x) => x.type === 'hit' && x.targetSide === 'enemy');
  }
  assert.ok(hit, '应打中');
  assert.equal(hit.blocked, false, '破防期间不该格挡');
  assert.equal(before - e.hp, ATTACKS.light1.dmg, '应全额伤害');
});

test('破防会随时间恢复', () => {
  const w = shieldWorld();
  const e = w.enemies[0];
  w.press('heavy');
  for (let i = 0; i < 40; i++) step(w);
  const start = e.guardBreak;
  assert.ok(start > 0);

  for (let i = 0; i < start + 5; i++) step(w);
  assert.equal(e.guardBreak, 0, '破防应自然结束');
});

test('第一次正面轻击仍被格挡（未破防前）', () => {
  const w = shieldWorld();
  const e = w.enemies[0];
  const before = e.hp;
  w.press('attack');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    step(w);
    hit = w.events.find((x) => x.type === 'hit' && x.targetSide === 'enemy');
  }
  assert.equal(hit.blocked, true, '轻击不该破防');
  assert.equal(e.guardBreak || 0, 0, '轻击不该产生破防');
  assert.ok(before - e.hp < ATTACKS.light1.dmg, '应被减伤');
});
