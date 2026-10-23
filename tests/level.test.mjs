import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step } from '../src/core/world.js';
import { createLevel, updateLevel, LEVEL } from '../src/core/level.js';

const mk = () => {
  const w = createWorld({ player: { x: 100, y: 50, hp: 120, maxHp: 120 }, enemies: [] });
  const lv = createLevel();
  return { w, lv };
};

const advance = (w, lv, frames) => { for (let i = 0; i < frames; i++) { step(w); updateLevel(w, lv); } };

test('关卡配置：3 波小怪 + 1 个 Boss，触发点递增', () => {
  assert.equal(LEVEL.segments.length, 3);
  for (let i = 1; i < LEVEL.segments.length; i++) {
    assert.ok(LEVEL.segments[i].triggerX > LEVEL.segments[i - 1].triggerX);
  }
  assert.ok(LEVEL.boss.triggerX > LEVEL.segments.at(-1).triggerX);
  assert.ok(LEVEL.boss.spawn.hp > 300);
});

test('开局没有敌人、没有关门、未通关', () => {
  const { w, lv } = mk();
  assert.equal(w.enemies.length, 0);
  assert.equal(lv.gateX, null);
  assert.equal(lv.won, false);
  assert.equal(lv.segmentIndex, 0);
});

test('走到第一波触发点会刷出整波敌人，并按「屏幕右边界」落闸', () => {
  const { w, lv } = mk();
  w.player.x = LEVEL.segments[0].triggerX + 1;
  updateLevel(w, lv, 100);
  assert.equal(w.enemies.length, LEVEL.segments[0].spawns.length);
  // 新契约：锁定机位 = 触发瞬间的相机位置，闸门 = 屏幕右缘，镜头不产生位移
  assert.equal(lv.camLockX, 100, '锁机位应等于触发瞬间的相机位置');
  assert.equal(lv.gateX, 100 + 480 - 4, '闸门世界坐标应等于屏幕右边缘（留 12px 边距）');
  assert.equal(w.enemies.every((e) => !e.dead), true);
});

test('闸门落下时玩家被夹在屏幕右边界内（即使逻辑上给了超大位移）', () => {
  const { w, lv } = mk();
  w.player.x = LEVEL.segments[0].triggerX + 1;
  updateLevel(w, lv, 100);
  w.player.x = 99999;
  updateLevel(w, lv, 100);
  assert.ok(w.player.x <= lv.gateX - 10, `玩家越过了屏幕右边界: ${w.player.x}`);
});

test('清空当前波后闸门解除（镜头解锁）、进入下一段', () => {
  const { w, lv } = mk();
  w.player.x = LEVEL.segments[0].triggerX + 1;
  updateLevel(w, lv, 100);
  for (const e of w.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  updateLevel(w, lv, 100);
  assert.equal(lv.gateX, null);
  assert.equal(lv.camLockX, null);
  assert.equal(lv.segmentIndex, 1);
});

test('同一波不会被重复刷出（来回走不会刷怪）', () => {
  const { w, lv } = mk();
  w.player.x = LEVEL.segments[0].triggerX + 1;
  updateLevel(w, lv);
  const n = w.enemies.length;
  for (const e of w.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  updateLevel(w, lv);
  advance(w, lv, 30);
  assert.equal(w.enemies.filter((e) => !e.dead).length, 0);
  assert.ok(w.enemies.length <= n + 3, '不应无限刷怪');
});

test('清完全部小怪后触发 Boss，Boss 必须出现在锁定的屏幕内', () => {
  const { w, lv } = mk();
  for (const seg of LEVEL.segments) {
    w.player.x = seg.triggerX + 1;
    updateLevel(w, lv, Math.max(0, seg.triggerX - 216));
    for (const e of w.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
    updateLevel(w, lv, Math.max(0, seg.triggerX - 216));
  }
  assert.equal(lv.segmentIndex, LEVEL.segments.length);

  w.player.x = LEVEL.boss.triggerX + 1;
  updateLevel(w, lv, 1786);
  const boss = w.enemies.find((e) => e.kind === 'boss');
  assert.ok(boss, 'Boss 应当出现');
  assert.equal(lv.bossSpawned, true);
  assert.ok(boss.x < lv.gateX, `Boss(${boss.x}) 应在锁定的屏幕内（右侧边界 ${lv.gateX}）`);

  boss.dead = true;
  boss.hp = 0;
  boss.state = 'dead';
  updateLevel(w, lv);
  // Boss 死后有 72 帧的"跪地演出"，期间还不算通关
  assert.equal(lv.won, false, '死亡瞬间不该立刻通关（有演出）');
  for (let i = 0; i < 80; i++) updateLevel(w, lv);
  assert.equal(lv.won, true, '演出结束后应判定通关');
});

test('Boss 不死就不算通关', () => {
  const { w, lv } = mk();
  for (const seg of LEVEL.segments) {
    w.player.x = seg.triggerX + 1;
    updateLevel(w, lv, Math.max(0, seg.triggerX - 216));
    for (const e of w.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
    updateLevel(w, lv, Math.max(0, seg.triggerX - 216));
  }
  w.player.x = LEVEL.boss.triggerX + 1;
  updateLevel(w, lv);
  advance(w, lv, 60);
  assert.equal(lv.won, false);
});

test('玩家死亡不算通关（失败态由 world 判定）', () => {
  const { w, lv } = mk();
  w.player.hp = 0;
  w.player.dead = true;
  advance(w, lv, 30);
  assert.equal(lv.won, false);
});

test('相机滞后时不会把玩家往回拉（锁位向前补到玩家身后）', () => {
  const { w, lv } = mk();
  // 玩家已经冲到 2000，但相机还停在 1000（阻尼/瞬移导致滞后）
  w.player.x = LEVEL.boss.triggerX + 1;
  updateLevel(w, lv, 1000);
  assert.ok(w.player.x >= LEVEL.boss.triggerX, `玩家被边界拉回: ${w.player.x}`);
  assert.ok(lv.gateX >= w.player.x + 10, `边界没有补到玩家身后: gate=${lv.gateX} player=${w.player.x}`);
});

test('锁定机位等于调用方给的相机位置（开波时镜头不位移）', () => {
  const { w, lv } = mk();
  lv.segmentIndex = 1;
  lv.spawnedSegments = new Set([0]);
  w.player.x = LEVEL.segments[1].triggerX + 1;
  updateLevel(w, lv, 588);
  assert.equal(lv.camLockX, 588);
  assert.equal(lv.gateX, 588 + 480 - 4);
});

test('最新一波最右敌人必须落在锁定屏幕内', () => {
  const { w, lv } = mk();
  lv.segmentIndex = 2;
  lv.spawnedSegments = new Set([0, 1]);
  w.player.x = LEVEL.segments[2].triggerX + 1;
  // 故意给一个偏左的相机位置，锁位应被推前以保证最右敌人可见
  updateLevel(w, lv, 900);
  const maxSpawnX = Math.max(...LEVEL.segments[2].spawns.map((s) => s.x));
  assert.ok(maxSpawnX < lv.gateX, `最右敌人 ${maxSpawnX} 不在屏幕内（gate ${lv.gateX}）`);
});
