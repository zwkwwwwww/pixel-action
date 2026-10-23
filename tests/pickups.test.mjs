// 地面补给箱：走到附近自动拾取，回血 + 补弹，且只能吃一次。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld } from '../src/core/world.js';
import { createLevel, updateLevel } from '../src/core/level.js';

function withBoxes() {
  const def = {
    id: 99, name: 'TEST', segments: [], boss: { triggerX: 9999, spawn: { x: 9999, y: 40 } },
    pickups: [{ x: 200, y: 40 }, { x: 500, y: 60 }],
  };
  const w = createWorld({ player: { x: 100, y: 40, hp: 100, maxHp: 240, ammo: 1 }, enemies: [] });
  const lv = createLevel(def);
  return { w, lv };
}

test('关卡初始化时按 def.pickups 生成箱子', () => {
  const { lv } = withBoxes();
  assert.equal(lv.pickups.length, 2);
  assert.equal(lv.pickups[0].taken, false);
});

test('走到箱子附近自动拾取：回 15% 血 + 2 飞刀', () => {
  const { w, lv } = withBoxes();
  w.player.x = 200;
  updateLevel(w, lv, 0);

  const expectHp = 100 + Math.round(240 * 0.15);
  assert.equal(w.player.hp, expectHp, `应回到 ${expectHp}`);
  assert.equal(w.player.ammo, 3, '飞刀 1→3');
  assert.equal(lv.pickups.length, 1, '吃掉的箱子应移除');
});

test('同一个箱子只能吃一次', () => {
  const { w, lv } = withBoxes();
  w.player.x = 200;
  updateLevel(w, lv, 0);
  const hpAfter = w.player.hp;
  for (let i = 0; i < 10; i++) updateLevel(w, lv, 0);
  assert.equal(w.player.hp, hpAfter, '不该重复回血');
});

test('离得远不触发', () => {
  const { w, lv } = withBoxes();
  w.player.x = 120;      // 离 200 有 80px
  updateLevel(w, lv, 0);
  assert.equal(lv.pickups.length, 2, '远处不该被拾取');
  assert.equal(w.player.hp, 100);
});

test('拾取会推 pickupBox 事件', () => {
  const { w, lv } = withBoxes();
  w.player.x = 200;
  updateLevel(w, lv, 0);
  const ev = w.events.find((e) => e.type === 'pickupBox');
  assert.ok(ev, '应产生 pickupBox 事件');
  assert.ok(ev.heal > 0);
});

test('血量不会超过上限', () => {
  const { w, lv } = withBoxes();
  w.player.hp = 240;
  w.player.x = 200;
  updateLevel(w, lv, 0);
  assert.equal(w.player.hp, 240, '满血时不该溢出');
});
