// 清波奖励：每清完一波补弹药 + 回血，并推 waveClear 事件。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { createLevel, updateLevel } from '../src/core/level.js';
import { LEVEL } from '../src/core/level.js';

/** 造一个「第一波已刷出、且敌人全灭」的最小场景。 */
function clearedWave(ammo, hp) {
  const w = createWorld({ player: { x: 100, y: 40, hp, maxHp: 240, ammo }, enemies: [] });
  const lv = createLevel(LEVEL);
  const seg = lv.def.segments[0];
  // 手动把第一波标记为已刷出且全灭
  lv.spawnedSegments.add(0);
  lv.wave = [{ dead: true }];
  lv.gateX = null;
  lv.camLockX = null;
  w.player.x = Math.min(seg.triggerX + 10, 300);
  return { w, lv };
}

test('清完一波补 1 把飞刀', () => {
  const { w, lv } = clearedWave(2, 200);
  updateLevel(w, lv, 0);
  assert.equal(w.player.ammo, 3, `弹药应 2→3，实际 ${w.player.ammo}`);
});

test('清完一波回 8% 血，且不会超过上限', () => {
  const { w, lv } = clearedWave(5, 100);
  updateLevel(w, lv, 0);
  const expect = 100 + Math.round(240 * 0.08);
  assert.equal(w.player.hp, expect, `应回到 ${expect}，实际 ${w.player.hp}`);

  const full = clearedWave(5, 240);
  updateLevel(full.w, full.lv, 0);
  assert.equal(full.w.player.hp, 240, '满血不该溢出');
});

test('清波会推 waveClear 事件（带波次信息）', () => {
  const { w, lv } = clearedWave(1, 180);
  updateLevel(w, lv, 0);
  const ev = w.events.find((e) => e.type === 'waveClear');
  assert.ok(ev, '应产生 waveClear 事件');
  assert.ok(ev.wave >= 1, `波次应 >=1，实际 ${ev.wave}`);
  assert.ok(ev.total >= 1, '应带总波数');
});

test('波次推进：清完后 segmentIndex +1', () => {
  const { w, lv } = clearedWave(5, 200);
  const before = lv.segmentIndex;
  updateLevel(w, lv, 0);
  assert.equal(lv.segmentIndex, before + 1);
});
