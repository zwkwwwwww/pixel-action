import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, isActive, hitbox, COMBO } from '../src/core/attacks.js';

test('每个攻击的时序都是正整数且 active 窗口非空', () => {
  for (const [id, a] of Object.entries(ATTACKS)) {
    for (const k of ['startup', 'active', 'recovery', 'dmg', 'hitstun']) {
      assert.ok(Number.isInteger(a[k]) && a[k] > 0, `${id}.${k}=${a[k]}`);
    }
    assert.ok(a.active >= 1, `${id} active 不能为 0`);
  }
});

test('isActive 只在前摇结束后的 active 帧内返回 true（左闭右开）', () => {
  const a = ATTACKS.light1;
  assert.equal(isActive(a, a.startup - 1), false);
  assert.equal(isActive(a, a.startup), true);
  assert.equal(isActive(a, a.startup + a.active - 1), true);
  assert.equal(isActive(a, a.startup + a.active), false);
});

test('三连击伤害递增，第三击是挑空技', () => {
  assert.ok(ATTACKS.light2.dmg > ATTACKS.light1.dmg);
  assert.ok(ATTACKS.light3.dmg > ATTACKS.light2.dmg);
  assert.ok(ATTACKS.light3.launch > 0, '第三击必须带挑空');
  assert.equal(ATTACKS.light1.launch || 0, 0);
});

test('连段链 1→2→3→收招，且链窗口在每段内合法', () => {
  assert.equal(ATTACKS.light1.chainTo, 'light2');
  assert.equal(ATTACKS.light2.chainTo, 'light3');
  assert.equal(ATTACKS.light3.chainTo, null);
  assert.ok(COMBO.chainWindow > 0 && COMBO.chainWindow <= ATTACKS.light1.startup + ATTACKS.light1.active + ATTACKS.light1.recovery);
});

test('攻击盒朝右在角色右侧，朝左在角色左侧（镜像）', () => {
  const a = ATTACKS.light1;
  const right = hitbox(a, { x: 100, y: 40, facing: 1 });
  const left = hitbox(a, { x: 100, y: 40, facing: -1 });
  assert.ok(right.x1 >= 100, `右向攻击盒应在身体右侧: ${JSON.stringify(right)}`);
  assert.ok(left.x2 <= 100, `左向攻击盒应在身体左侧: ${JSON.stringify(left)}`);
  // 镜像后尺寸一致
  assert.equal(right.x2 - right.x1, left.x2 - left.x1);
  // 纵深方向一致
  assert.equal(right.y1, left.y1);
  assert.equal(right.y2, left.y2);
});

test('攻击盒纵深以角色所在车道为中心，且不超过 ±纵深半宽', () => {
  const a = ATTACKS.light1;
  const box = hitbox(a, { x: 0, y: 50, facing: 1 });
  assert.ok(box.y1 < 50 && box.y2 > 50);
  assert.ok(Math.abs(box.y2 - 50) <= a.halfDepth + 0.001);
  assert.ok(Math.abs(50 - box.y1) <= a.halfDepth + 0.001);
});

test('必杀消耗能量且伤害最高', () => {
  assert.ok(ATTACKS.special.meterCost > 0);
  for (const id of ['light1', 'light2', 'light3']) {
    assert.ok(ATTACKS.special.dmg > ATTACKS[id].dmg);
  }
});
