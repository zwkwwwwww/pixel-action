// 击杀持刀敌人 → 补给飞刀。验证掉落条件、上限与不误掉（弓手不掉）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { BLADE_CARRIERS } from '../src/core/attacks.js';

/** 造一个「玩家紧贴敌人」的场景，方便一击必杀。 */
function arenaWith(kind, ammo) {
  return createWorld({
    player: { x: 100, y: 40, hp: 240, maxHp: 240, ammo },
    enemies: [{
      id: 'e1', x: 116, y: 40, hp: 8, maxHp: 8, kind, facing: -1,
      ai: { type: 'melee', speed: 0, turnSpeed: 0, range: 0, depthRange: 0, cooldown: 99999, attack: 'light1' },
    }],
  });
}

function killWith(world, presses = 4) {
  for (let i = 0; i < 200; i++) {
    if (world.enemies[0].dead) break;
    if (world.player.state === 'idle' && presses-- > 0) world.press('attack');
    step(world);
  }
}

test('持刀敌人（grunt）被击杀后飞刀 +1', () => {
  const w = arenaWith('grunt', 3);
  killWith(w);
  assert.ok(w.enemies[0].dead, '敌人应被打死');
  assert.equal(w.player.ammo, 4, `击杀后应从 3 变 4，实际 ${w.player.ammo}`);
});

test('弓手不掉飞刀（它拿的是弓，不是刀）', () => {
  assert.equal(BLADE_CARRIERS.has('ranger'), false, 'ranger 不应在持刀集合里');
  const w = arenaWith('ranger', 3);
  killWith(w);
  assert.ok(w.enemies[0].dead);
  assert.equal(w.player.ammo, 3, `弓手不该掉刀，实际 ${w.player.ammo}`);
});

test('拾取不会超过上限 9', () => {
  const w = arenaWith('grunt', 9);
  killWith(w);
  assert.equal(w.player.ammo, 9, '已满仍应保持 9');
});

test('掉落会推 pickup 事件（供渲染飘字）', () => {
  const w = arenaWith('grunt', 2);
  let pickup = null;
  for (let i = 0; i < 200 && !pickup; i++) {
    if (w.player.state === 'idle') w.press('attack');
    step(w);
    pickup = w.events.find((e) => e.type === 'pickup');
  }
  assert.ok(pickup, '应产生 pickup 事件');
  assert.equal(pickup.ammo, 3);
});

test('全部 Boss 都算持刀敌人', () => {
  for (const k of ['boss', 'boss_warden', 'boss_berserker']) {
    assert.equal(BLADE_CARRIERS.has(k), true, `${k} 应掉飞刀`);
  }
});
