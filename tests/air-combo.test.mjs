// 空中连段：打中浮空（launched）的敌人算空连，给额外能量并标记事件。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { ATTACKS } from '../src/core/attacks.js';
import { startAttack } from '../src/core/actor.js';

const arena = () => createWorld({
  player: { x: 100, y: 40, hp: 120, maxHp: 120 },
  enemies: [{
    id: 'e1', x: 118, y: 40, hp: 500, maxHp: 500, kind: 'grunt', facing: -1,
    ai: { type: 'melee', speed: 0, turnSpeed: 0, range: 0, depthRange: 0, cooldown: 99999, attack: 'light1' },
  }],
});

test('带 launch 的招式会把敌人挑空并赋予 vz', () => {
  const w = arena();
  const e = w.enemies[0];
  assert.ok(ATTACKS.light3.launch > 0, '测试前提：light3 应带 launch');
  w.player.x = 110;
  // 直接以上挑起手（跳过连段链路，只验证击飞逻辑）
  startAttack(w.player, 'light3');
  for (let i = 0; i < 20 && e.state !== 'launched'; i++) step(w);
  assert.equal(e.state, 'launched', 'light3 应把敌人挑空');
  assert.ok(e.vz > 0, '挑空后应有向上速度');
});

test('打中空中的敌人会标记 airHit 并额外回能', () => {
  const w = arena();
  const e = w.enemies[0];
  // 手动把敌人放进浮空状态（模拟已被挑空）
  e.state = 'launched';
  e.z = 20;
  e.vz = 1.5;
  e.hp = 500;

  const meterBefore = w.player.meter;
  w.player.x = 110;
  w.press('attack');
  let airEvent = null;
  for (let i = 0; i < 30 && !airEvent; i++) {
    step(w);
    airEvent = w.events.find((ev) => ev.type === 'hit' && ev.airHit);
  }

  assert.ok(airEvent, '命中原浮空敌人应产生 airHit 事件');
  const gain = w.player.meter - meterBefore;
  const base = ATTACKS.light1.meterGain;
  assert.ok(gain >= base + 4, `空连应额外回能：实得 ${gain}，基础 ${base}`);
});

test('命中地面敌人不算空连', () => {
  const w = arena();
  w.player.x = 110;
  w.press('attack');
  let hit = null;
  for (let i = 0; i < 30 && !hit; i++) {
    step(w);
    hit = w.events.find((ev) => ev.type === 'hit');
  }
  assert.ok(hit, '应打中地面敌人');
  assert.equal(hit.airHit, false);
});

test('空连不让敌人立刻落地（保持浮空节奏）', () => {
  const w = arena();
  const e = w.enemies[0];
  e.state = 'launched';
  e.z = 18;
  e.vz = -1.0;   // 正在下落
  e.hp = 500;
  w.player.x = 110;
  w.press('attack');
  for (let i = 0; i < 12; i++) step(w);
  assert.ok(e.vz > 0, `空连应把下落速度顶回向上：vz=${e.vz}`);
});
