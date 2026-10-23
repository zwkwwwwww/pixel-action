// 盾兵：正面格挡减伤 80%，绕后或重斩破防。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';
import { ATTACKS } from '../src/core/attacks.js';

/** 玩家在左(100)、盾兵在右(120)且面朝左 → 玩家打的是正面。 */
/** 静止盾兵（不跑 AI，保证 facing 稳定可控）。 */
function shieldWorld(px = 100, facingEnemyToLeft = true) {
  return createWorld({
    player: { x: px, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'sh', x: 120, y: 40, hp: 200, maxHp: 200, kind: 'shield',
      facing: facingEnemyToLeft ? -1 : 1,
      ai: AI_PROFILES.shield,
    }],
  });
}

test('盾兵自动带 shield 标记', () => {
  const w = shieldWorld();
  assert.equal(w.enemies[0].shield, true);
});

test('正面轻击被格挡：伤害只剩 20%', () => {
  const w = shieldWorld();
  const e = w.enemies[0];
  const before = e.hp;

  w.press('attack');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    step(w);
    hit = w.events.find((ev) => ev.type === 'hit' && ev.targetSide === 'enemy');
  }
  assert.ok(hit, '应该打中');
  assert.equal(hit.blocked, true, '正面应被格挡');

  const lost = before - e.hp;
  const expect = Math.max(1, Math.round(ATTACKS.light1.dmg * 0.2));
  assert.equal(lost, expect, `格挡后应只掉 ${expect}，实际 ${lost}`);
});

test('绕到背后打：不被格挡，全额伤害', () => {
  // 关键：不能启用 enemyThink —— 它会每帧把 facing 转向玩家，
  // 玩家永远"站不到背后"。所以这里造一个静止的盾兵。
  const w = createWorld({
    player: { x: 140, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'sh', x: 120, y: 40, hp: 200, maxHp: 200, kind: 'shield',
      facing: -1, ai: AI_PROFILES.shield,
    }],
  });
  const e = w.enemies[0];
  w.player.facing = -1;
  const before = e.hp;

  w.press('attack');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    step(w);
    hit = w.events.find((ev) => ev.type === 'hit' && ev.targetSide === 'enemy');
  }
  assert.ok(hit, '应该打中');
  assert.equal(hit.blocked, false, '背后不该被格挡');
  assert.equal(before - e.hp, ATTACKS.light1.dmg, '应全额伤害');
});

test('蓄力重斩无视盾牌（破防）', () => {
  const w = shieldWorld();
  const e = w.enemies[0];
  const before = e.hp;

  w.press('heavy');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    step(w);
    hit = w.events.find((ev) => ev.type === 'hit' && ev.targetSide === 'enemy');
  }
  assert.ok(hit);
  assert.equal(hit.blocked, false, '重斩应破防');
  assert.equal(before - e.hp, ATTACKS.heavy.dmg, '重斩应全额伤害');
});

test('格挡至少造成 1 点伤害（不会完全免疫）', () => {
  const w = shieldWorld();
  const e = w.enemies[0];
  w.press('attack');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    step(w);
    hit = w.events.find((ev) => ev.type === 'hit');
  }
  assert.ok(hit.dmg >= 1, `格挡后伤害应 >= 1，实际 ${hit.dmg}`);
});

test('普通敌人不受格挡影响', () => {
  const w = createWorld({
    player: { x: 100, y: 40, hp: 240, maxHp: 240 },
    enemies: [{ id: 'g', x: 116, y: 40, hp: 100, maxHp: 100, kind: 'grunt', facing: -1, ai: AI_PROFILES.grunt }],
    enemyThink,
  });
  w.press('attack');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    step(w);
    hit = w.events.find((ev) => ev.type === 'hit' && ev.targetSide === 'enemy');
  }
  assert.ok(hit);
  assert.equal(hit.blocked, false);
});
