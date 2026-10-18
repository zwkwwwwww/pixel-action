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
  updateLevel(w, lv);
  assert.equal(w.enemies.length, LEVEL.segments[0].spawns.length);
  // 新契约：锁定机位由触发点推导（triggerX - 0.45 屏），闸门 = 屏幕右缘
  const expectedLock = Math.max(0, LEVEL.segments[0].triggerX - 216);
  assert.equal(lv.camLockX, expectedLock, '锁机位应等于触发点左移 0.45 屏');
  assert.equal(lv.gateX, expectedLock + 480 - 12, '闸门世界坐标应等于屏幕右边缘（留 12px 边距）');
  assert.equal(w.enemies.every((e) => !e.dead), true);
});

test('闸门落下时玩家被夹在屏幕右边界内（即使逻辑上给了超大位移）', () => {
  const { w, lv } = mk();
  w.player.x = LEVEL.segments[0].triggerX + 1;
  updateLevel(w, lv);
  w.player.x = 99999;
  updateLevel(w, lv);
  assert.ok(w.player.x <= lv.gateX - 10, `玩家越过了屏幕右边界: ${w.player.x}`);
});

test('清空当前波后闸门解除（镜头解锁）、进入下一段', () => {
  const { w, lv } = mk();
  w.player.x = LEVEL.segments[0].triggerX + 1;
  updateLevel(w, lv);
  for (const e of w.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  updateLevel(w, lv);
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
    updateLevel(w, lv);
    for (const e of w.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
    updateLevel(w, lv);
  }
  assert.equal(lv.segmentIndex, LEVEL.segments.length);

  w.player.x = LEVEL.boss.triggerX + 1;
  updateLevel(w, lv);
  const boss = w.enemies.find((e) => e.kind === 'boss');
  assert.ok(boss, 'Boss 应当出现');
  assert.equal(lv.bossSpawned, true);
  assert.ok(boss.x < lv.gateX, `Boss(${boss.x}) 应在锁定的屏幕内（右侧边界 ${lv.gateX}）`);

  boss.dead = true;
  boss.hp = 0;
  boss.state = 'dead';
  updateLevel(w, lv);
  assert.equal(lv.won, true);
});

test('Boss 不死就不算通关', () => {
  const { w, lv } = mk();
  for (const seg of LEVEL.segments) {
    w.player.x = seg.triggerX + 1;
    updateLevel(w, lv);
    for (const e of w.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
    updateLevel(w, lv);
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
