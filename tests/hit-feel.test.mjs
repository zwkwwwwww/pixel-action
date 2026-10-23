// 打击手感：命中停顿按伤害分级；背后挨打有更强反馈标记。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES } from '../src/core/ai.js';
import { ATTACKS } from '../src/core/attacks.js';

function worldWith(kind, px = 100, ex = 116, hp = 500) {
  return createWorld({
    player: { x: px, y: 40, hp: 240, maxHp: 240, ammo: 5 },
    enemies: [{ id: 'e', x: ex, y: 40, hp, maxHp: hp, kind, facing: -1, ai: AI_PROFILES[kind] || AI_PROFILES.grunt }],
  });
}

function hitOnce(w, pressAction) {
  w.events.length = 0;
  w.press(pressAction);
  for (let i = 0; i < 40; i++) {
    step(w);
    const hit = w.events.find((e) => e.type === 'hit');
    if (hit) return { hit, stop: w.hitstop };
  }
  return null;
}

test('轻击的命中停顿比重斩短（按伤害分级）', () => {
  const w1 = worldWith('grunt');
  const light = hitOnce(w1, 'attack');
  assert.ok(light, '轻击应命中');

  const w2 = worldWith('grunt');
  const heavy = hitOnce(w2, 'heavy');
  assert.ok(heavy, '重斩应命中');

  assert.ok(heavy.stop > light.stop,
    `重斩停顿(${heavy.stop})应长于轻击(${light.stop})`);
});

test('击杀的停顿达到上限', () => {
  const w = worldWith('grunt', 100, 116, 4);   // 血很少，一击必杀
  const r = hitOnce(w, 'heavy');
  assert.ok(r, '应命中');
  assert.equal(r.hit.killed, true);
  assert.ok(r.stop >= 10, `击杀停顿应 >= 10，实际 ${r.stop}`);
});

test('玩家从背后挨打时事件带 fromBehind 标记', () => {
  // 玩家朝右（facing=1），敌人在玩家左边 → 从背后打
  const w = createWorld({
    player: { x: 200, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'e', x: 180, y: 40, hp: 100, maxHp: 100, kind: 'grunt',
      facing: 1, ai: AI_PROFILES.grunt,
    }],
  });
  w.player.facing = 1;
  w.enemies[0].state = 'attack';
  w.enemies[0].attack = 'light1';
  w.enemies[0].stateFrame = 3;
  w.enemies[0].hitTargets.clear();

  let ev = null;
  for (let i = 0; i < 20 && !ev; i++) {
    step(w);
    ev = w.events.find((e) => e.type === 'hit' && e.targetSide === 'player');
  }
  assert.ok(ev, '玩家应被打中');
  assert.equal(ev.fromBehind, true, '应从背后命中');
});

test('正面挨打时 fromBehind 为 false', () => {
  const w = createWorld({
    player: { x: 200, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'e', x: 220, y: 40, hp: 100, maxHp: 100, kind: 'grunt',
      facing: -1, ai: AI_PROFILES.grunt,
    }],
  });
  w.player.facing = 1;
  w.enemies[0].state = 'attack';
  w.enemies[0].attack = 'light1';
  w.enemies[0].stateFrame = 3;
  w.enemies[0].hitTargets.clear();

  let ev = null;
  for (let i = 0; i < 20 && !ev; i++) {
    step(w);
    ev = w.events.find((e) => e.type === 'hit' && e.targetSide === 'player');
  }
  assert.ok(ev, '玩家应被打中');
  assert.equal(ev.fromBehind, false);
});

test('玩家打敌人不算 fromBehind（只对玩家受击有意义）', () => {
  const w = worldWith('grunt');
  const r = hitOnce(w, 'attack');
  assert.ok(r);
  assert.equal(r.hit.fromBehind, false);
});
