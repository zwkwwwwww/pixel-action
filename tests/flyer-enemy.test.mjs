// 飞行敌人：悬空，地面近战够不到，必须跳跃攻击或飞刀。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';

function flyerWorld() {
  return createWorld({
    player: { x: 100, y: 40, hp: 240, maxHp: 240, ammo: 5 },
    enemies: [{
      id: 'f1', x: 118, y: 40, hp: 60, maxHp: 60, kind: 'flyer',
      facing: -1, ai: AI_PROFILES.flyer,
    }],
    enemyThink,
  });
}

test('飞行单位自动带 flyer 且初始悬空', () => {
  const w = flyerWorld();
  const f = w.enemies[0];
  assert.equal(f.flyer, true);
  assert.ok(f.z >= 28, `应悬空，实际 z=${f.z}`);
});

test('地面近战打不到飞行单位（高度差）', () => {
  const w = flyerWorld();
  const f = w.enemies[0];
  f.z = 40;                     // 高空
  f.ai = { ...AI_PROFILES.flyer, speed: 0, cooldown: 99999 };
  const before = f.hp;

  w.press('attack');
  for (let i = 0; i < 60; i++) step(w);

  assert.equal(f.hp, before, `地面攻击不该命中高空单位，掉了 ${before - f.hp}`);
});

test('玩家跳起来能打到飞行单位', () => {
  const w = flyerWorld();
  const f = w.enemies[0];
  f.z = 40;
  f.ai = { ...AI_PROFILES.flyer, speed: 0, cooldown: 99999 };
  const before = f.hp;

  // 玩家跳高（z 抬到 30，加上 34 的近战触及 = 64 > 40）
  w.player.z = 30;
  w.player.state = 'jump';
  w.press('attack');
  for (let i = 0; i < 60; i++) {
    w.player.z = 30;   // 维持高度
    step(w);
    if (f.hp < before) break;
  }

  assert.ok(f.hp < before, '跳跃攻击应该能命中飞行单位');
});

test('飞刀能打到飞行单位（投射物不受高度限制）', () => {
  const w = flyerWorld();
  const f = w.enemies[0];
  // 放远一点，给飞刀足够的飞行时间（太近时飞刀刚生成就已越过目标）
  f.x = 220;
  f.z = 40;
  f.ai = { ...AI_PROFILES.flyer, speed: 0, cooldown: 99999 };
  const before = f.hp;

  w.press('throw');
  for (let i = 0; i < 80; i++) {
    step(w);
    if (f.hp < before) break;
  }

  assert.ok(f.hp < before, '飞刀应该能命中飞行单位');
});

test('飞行单位维持悬停高度（不会掉到地面）', () => {
  const w = flyerWorld();
  const f = w.enemies[0];
  for (let i = 0; i < 120; i++) step(w);
  assert.ok(f.z > 20, `应保持悬空，实际 z=${Math.round(f.z)}`);
});
