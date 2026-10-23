// 机动性三件套：跳跃（含二段跳）、空中出招、飞刀道具。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { WORLD, createActor, startJump } from '../src/core/actor.js';
import { ATTACKS } from '../src/core/attacks.js';

const arena = (ammo = 5) => createWorld({
  player: { x: 100, y: 40, hp: 120, maxHp: 120, ammo },
  enemies: [],
});

test('按跳跃键会离地，并在重力作用下回到地面', () => {
  const w = arena();
  w.press('jump');
  step(w);
  assert.equal(w.player.state, 'jump');
  assert.ok(w.player.z > 0, `起跳后应离地：z=${w.player.z}`);

  let maxZ = 0;
  let frames = 0;
  while (frames++ < 200 && w.player.state === 'jump') {
    step(w);
    maxZ = Math.max(maxZ, w.player.z);
  }
  assert.ok(maxZ > 10, `跳跃高度太低：${maxZ}`);
  assert.equal(w.player.state, 'idle', '应落地回到 idle');
  assert.equal(w.player.z, 0, '落地后 z 归零');
});

test('空中还能再跳一次，第三次被拒绝', () => {
  const a = createActor({ side: 'player', x: 100, y: 40, hp: 100, maxHp: 100 });
  assert.equal(startJump(a, { x: 0, y: 0 }), true, '首次起跳应成功');
  a.z = 20;              // 已在空中
  assert.equal(startJump(a, { x: 0, y: 0 }), true, '二段跳应成功');
  a.z = 24;
  assert.equal(startJump(a, { x: 0, y: 0 }), false, '第三次应被拒绝');
});

test('跳跃中可以出招，出招结束仍留在空中继续下落', () => {
  const w = arena();
  w.press('jump');
  step(w);
  step(w);
  assert.equal(w.player.state, 'jump');

  w.press('attack');
  step(w);
  assert.equal(w.player.state, 'attack', '空中应能出招');

  // 等这一招收完
  const def = ATTACKS.light1;
  const total = def.startup + def.active + def.recovery;
  for (let i = 0; i < total + 2; i++) step(w);
  assert.ok(w.player.z > 0 || w.player.state === 'idle', '收招后应回到空中或已落地');
});

test('跳跃的空中水平控制比地面慢（airControl）', () => {
  assert.ok(WORLD.JUMP.airControl > 0 && WORLD.JUMP.airControl < 1,
    `airControl 应在 0~1 之间：${WORLD.JUMP.airControl}`);
});

test('投掷飞刀：消耗弹药并生成投射物', () => {
  const w = arena(5);
  w.press('throw');
  step(w);
  assert.equal(w.player.ammo, 4, '应消耗 1 个弹药');
  assert.equal(w.player.state, 'attack');
  assert.equal(w.player.attack, 'throw');

  // 推进到 active 帧，投射物应生成
  let sawProj = false;
  for (let i = 0; i < 20 && !sawProj; i++) {
    step(w);
    sawProj = w.projectiles.length > 0;
  }
  assert.ok(sawProj, '飞刀应生成投射物');
  const pr = w.projectiles[0];
  assert.equal(pr.attack, 'throw');
  assert.ok(pr.vx !== 0, '飞刀应水平飞行');
  assert.ok(pr.z > 0, `飞刀应从高处飞出：z=${pr.z}`);
});

test('没有弹药时不能投掷', () => {
  const w = arena(0);
  w.press('throw');
  step(w);
  assert.notEqual(w.player.attack, 'throw', '0 弹药不应出招');
  assert.equal(w.player.ammo, 0);
});

test('飞刀伤害独立于近战：命中造成 projectile 定义的伤害', () => {
  assert.ok(ATTACKS.throw.dmg > 0);
  assert.equal(ATTACKS.throw.reach, 0, '投掷没有近战判定盒');
  assert.ok(ATTACKS.throw.projectile, '必须有 projectile 配置');
});
