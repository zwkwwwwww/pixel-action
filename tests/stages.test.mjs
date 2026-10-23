// 多关卡表：难度递增、触发点递增、第二关能正常刷怪。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { createLevel, updateLevel } from '../src/core/level.js';
import { STAGES, STAGE_1, STAGE_2, stageEnemyCount } from '../src/core/stages.js';

test('关卡表：两关，id 递增，第二关敌人更多、Boss 更强', () => {
  assert.equal(STAGES.length, 3);
  assert.deepEqual(STAGES.map((s) => s.id), [1, 2, 3]);
  assert.equal(STAGE_1.id, 1);

  assert.ok(stageEnemyCount(STAGE_2) > stageEnemyCount(STAGE_1),
    `第二关敌人应更多: ${stageEnemyCount(STAGE_2)} vs ${stageEnemyCount(STAGE_1)}`);
  assert.ok(STAGE_2.boss.spawn.hp > STAGE_1.boss.spawn.hp, '第二关 Boss 血量应更高');
  assert.ok(STAGES[2].boss.spawn.hp > STAGE_2.boss.spawn.hp, '终章 Boss 血量应更高');
  assert.ok(STAGE_2.boss.spawn.speedX >= STAGE_1.boss.spawn.speedX, '第二关 Boss 不应更慢');
});

test('每关的触发点递增，且所有出生点都在关卡宽度内', () => {
  for (const stage of STAGES) {
    for (let i = 1; i < stage.segments.length; i++) {
      assert.ok(stage.segments[i].triggerX > stage.segments[i - 1].triggerX,
        `${stage.name} 第 ${i} 波触发点未递增`);
    }
    assert.ok(stage.boss.triggerX > stage.segments.at(-1).triggerX, `${stage.name} Boss 触发点必须在最后一波之后`);
    for (const seg of stage.segments) {
      for (const sp of seg.spawns) {
        assert.ok(sp.x > seg.triggerX && sp.x < stage.worldW, `${stage.name} 出生点越界: ${sp.x}`);
        assert.ok(sp.y >= 0 && sp.y <= 90, `${stage.name} 纵深车道越界: ${sp.y}`);
      }
    }
    assert.ok(stage.boss.spawn.x > stage.boss.triggerX && stage.boss.spawn.x < stage.worldW);
  }
});

test('第二关能正常开局、刷第一波并落闸', () => {
  const w = createWorld({ player: { x: 100, y: 50, hp: 120, maxHp: 120 }, enemies: [] });
  const lv = createLevel(STAGE_2);
  assert.equal(lv.def.id, 2);
  assert.equal(lv.segmentIndex, 0);
  assert.equal(lv.gateX, null);

  w.player.x = STAGE_2.segments[0].triggerX + 1;
  updateLevel(w, lv, 120);
  assert.equal(w.enemies.length, STAGE_2.segments[0].spawns.length);
  assert.equal(lv.gateX, 120 + 480 - 4);
});

test('清完第二关所有波次后才会触发 Boss', () => {
  const w = createWorld({ player: { x: 100, y: 50, hp: 120, maxHp: 120 }, enemies: [] });
  const lv = createLevel(STAGE_2);
  for (let i = 0; i < lv.def.segments.length; i++) {
    w.player.x = lv.def.segments[i].triggerX + 1;
    updateLevel(w, lv, 120);
    assert.ok(lv.wave.length > 0, `第 ${i + 1} 波应刷出敌人`);
    for (const e of lv.wave) { e.dead = true; e.hp = 0; }
    updateLevel(w, lv, 120);
  }
  assert.equal(lv.bossSpawned, false, 'Boss 触发点还很远');
  w.player.x = lv.def.boss.triggerX + 1;
  updateLevel(w, lv, 120);
  assert.equal(lv.bossSpawned, true);
  assert.ok(lv.bossActor && lv.bossActor.hp === lv.def.boss.spawn.hp);
  assert.equal(lv.won, false);
  lv.bossActor.dead = true;
  updateLevel(w, lv, 120);
  assert.equal(lv.won, true);
});

test('第二关的波次与 Boss 在真实 step 循环里也能推进', () => {
  const w = createWorld({ player: { x: 100, y: 50, hp: 120, maxHp: 120 }, enemies: [] });
  const lv = createLevel(STAGE_2);
  for (let i = 0; i < 240; i++) {
    w.player.x = Math.max(w.player.x, lv.def.segments[0].triggerX + 2);
    step(w);
    updateLevel(w, lv);
  }
  assert.ok(w.enemies.length > 0 || lv.segmentIndex > 0, '真实循环里应至少刷出一波');
});

