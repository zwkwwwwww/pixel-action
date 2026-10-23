// 难度：只影响"敌人打到玩家"的伤害，玩家打敌人的伤害不变。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES } from '../src/core/ai.js';

function worldWithMul(mul) {
  const w = createWorld({
    player: { x: 200, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'e', x: 180, y: 40, hp: 500, maxHp: 500, kind: 'grunt',
      facing: 1, ai: AI_PROFILES.grunt,
    }],
  });
  w.dmgMul = mul;
  return w;
}

/** 让敌人强制出招打玩家，返回实际掉血。 */
function enemyHitDamage(w) {
  const e = w.enemies[0];
  e.state = 'attack';
  e.attack = 'light1';
  e.stateFrame = 3;
  e.facing = 1;
  e.hitTargets.clear();
  const hp0 = w.player.hp;
  for (let i = 0; i < 20; i++) {
    step(w);
    if (w.player.hp < hp0) break;
  }
  return hp0 - w.player.hp;
}

test('EASY(0.6x) 敌人伤害明显低于 NORMAL', () => {
  const normal = enemyHitDamage(worldWithMul(1));
  const easy = enemyHitDamage(worldWithMul(0.6));
  assert.ok(easy < normal, `easy(${easy}) 应低于 normal(${normal})`);
  assert.equal(easy, Math.max(1, Math.round(normal * 0.6)));
});

test('HARD(1.5x) 敌人伤害明显高于 NORMAL', () => {
  const normal = enemyHitDamage(worldWithMul(1));
  const hard = enemyHitDamage(worldWithMul(1.5));
  assert.ok(hard > normal, `hard(${hard}) 应高于 normal(${normal})`);
});

test('难度不影响玩家打敌人的伤害', () => {
  const mk = (mul) => {
    const w = createWorld({
      player: { x: 100, y: 40, hp: 240, maxHp: 240 },
      enemies: [{ id: 'e', x: 118, y: 40, hp: 500, maxHp: 500, kind: 'grunt', facing: -1, ai: AI_PROFILES.grunt }],
    });
    w.dmgMul = mul;
    return w;
  };

  const w1 = mk(1);
  w1.press('attack');
  for (let i = 0; i < 30; i++) step(w1);
  const lose1 = 500 - w1.enemies[0].hp;

  const w3 = mk(1.5);
  w3.press('attack');
  for (let i = 0; i < 30; i++) step(w3);
  const lose3 = 500 - w3.enemies[0].hp;

  assert.equal(lose3, lose1, '玩家输出不该随难度变化');
});

test('dmgMul 缺省时行为不变（向后兼容）', () => {
  const w = createWorld({
    player: { x: 200, y: 40, hp: 240, maxHp: 240 },
    enemies: [{ id: 'e', x: 180, y: 40, hp: 500, maxHp: 500, kind: 'grunt', facing: 1, ai: AI_PROFILES.grunt }],
  });
  // 不设 dmgMul
  const dmg = enemyHitDamage(w);
  assert.ok(dmg > 0, '应该正常掉血');
});
