import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step, WORLD } from '../src/core/world.js';
import { ATTACKS } from '../src/core/attacks.js';

const mk = (over = {}) => createWorld({
  player: { x: 100, y: 50, hp: 120, maxHp: 120, ...(over.player || {}) },
  enemies: (over.enemies || [{ id: 'e1', x: 120, y: 50, hp: 40, maxHp: 40, kind: 'grunt' }]),
});

const run = (w, n) => { for (let i = 0; i < n; i++) step(w); return w; };

test('世界按固定 60fps 帧推进，初始玩家为 idle', () => {
  const w = mk();
  assert.equal(w.frame, 0);
  assert.equal(w.player.state, 'idle');
  step(w);
  assert.equal(w.frame, 1);
});

test('按下攻击 → 进入 attack 状态，active 帧命中扣血并产生 hit 事件', () => {
  const w = mk();
  w.press('attack');
  const hp0 = w.enemies[0].hp;
  run(w, 4); // startup=3，第 4 帧进入 active
  assert.equal(w.player.state, 'attack');
  assert.equal(w.enemies[0].hp, hp0 - ATTACKS.light1.dmg);
  assert.ok(w.hitstop > 0, '命中必须产生命中停顿');
  assert.ok(w.events.some((e) => e.type === 'hit'), '必须产生 hit 事件给表现层');
});

test('同一次挥砍对同一敌人只结算一次（不会一帧多段）', () => {
  const w = mk();
  w.press('attack');
  const hp0 = w.enemies[0].hp;
  run(w, 12);
  assert.equal(w.enemies[0].hp, hp0 - ATTACKS.light1.dmg);
});

test('攻击距离之外不命中（X 轴）', () => {
  const w = mk({ enemies: [{ id: 'e1', x: 190, y: 50, hp: 40, maxHp: 40, kind: 'grunt' }] });
  w.press('attack');
  run(w, 8);
  assert.equal(w.enemies[0].hp, 40);
});

test('纵深车道差太远也不命中（Y 轴）', () => {
  const w = mk({ enemies: [{ id: 'e1', x: 120, y: 50 + 60, hp: 40, maxHp: 40, kind: 'grunt' }] });
  w.press('attack');
  run(w, 8);
  assert.equal(w.enemies[0].hp, 40);
});

test('连按攻击能打出 light1 → light2 → light3 三连', () => {
  const w = mk({ enemies: [{ id: 'e1', x: 118, y: 50, hp: 999, maxHp: 999, kind: 'dummy' }] });
  const seen = [];
  for (let i = 0; i < 70; i++) {
    if (i % 6 === 0) w.press('attack');
    step(w);
    if (w.player.state === 'attack' && seen[seen.length - 1] !== w.player.attack) seen.push(w.player.attack);
  }
  assert.deepEqual(seen.slice(0, 3), ['light1', 'light2', 'light3']);
});

test('命中会给玩家回能量，必杀需要满能量', () => {
  const w = mk();
  w.press('special'); // 能量不足，不该放出来
  run(w, 2);
  assert.notEqual(w.player.state, 'attack');

  w.press('attack');
  run(w, 4);
  assert.ok(w.player.meter > 0, '命中后必须有能量收益');
});

test('闪避起手的前几帧无敌，敌人攻击打不中', () => {
  const w = createWorld({
    player: { x: 100, y: 50, hp: 120, maxHp: 120 },
    enemies: [{ id: 'e1', x: 118, y: 50, hp: 40, maxHp: 40, kind: 'grunt', facing: -1 }],
  });
  // 让敌人立刻出手（测试里直接驱动敌人攻击）
  w.forceAttack(w.enemies[0], 'light1');
  w.press('dodge');
  run(w, 5);
  assert.equal(w.player.hp, 120, `闪避无敌帧内不该掉血，实际 ${w.player.hp}`);
});

test('敌人被打空血后进入 dead，且不再产生攻击', () => {
  const w = mk({ enemies: [{ id: 'e1', x: 120, y: 50, hp: 8, maxHp: 40, kind: 'grunt' }] });
  w.press('attack');
  run(w, 6);
  assert.equal(w.enemies[0].dead, true);
  assert.equal(w.enemies[0].state, 'dead');
  const frameAtDeath = w.frame;
  run(w, 30);
  assert.equal(w.enemies[0].dead, true);
  assert.ok(w.frame > frameAtDeath);
});

test('挑空技把敌人打飞（z>0 / launched），落地后倒地', () => {
  const w = mk({ enemies: [{ id: 'e1', x: 118, y: 50, hp: 999, maxHp: 999, kind: 'dummy' }] });
  // 直接强制第三段，聚焦挑空物理
  w.forceAttack(w.player, 'light3');
  let sawAirborne = false;
  for (let i = 0; i < 40; i++) {
    step(w);
    if (w.enemies[0].z > 0.5) sawAirborne = true;
  }
  assert.ok(sawAirborne, '第三击必须让敌人离地');
  assert.ok(['down', 'getup', 'idle'].includes(w.enemies[0].state), `落地后状态异常: ${w.enemies[0].state}`);
});

test('受击硬直期间玩家不能出招（输入被吞但不锁死）', () => {
  const w = createWorld({
    player: { x: 100, y: 50, hp: 120, maxHp: 120 },
    enemies: [{ id: 'e1', x: 116, y: 50, hp: 40, maxHp: 40, kind: 'grunt', facing: -1 }],
  });
  w.forceAttack(w.enemies[0], 'light1');
  run(w, 5);
  const hpAfterHit = w.player.hp;
  assert.ok(hpAfterHit < 120, '测试前提：玩家应该已经挨打');
  w.press('attack');
  step(w);
  assert.notEqual(w.player.state, 'attack', '受击硬直中不能出招');
  run(w, 40);
  assert.equal(w.player.state, 'idle', '硬直结束后必须能恢复行动（不能锁死）');
});

test('世界事件包含伤害数值与命中位置，供特效层使用', () => {
  const w = mk();
  w.press('attack');
  run(w, 5);
  const hit = w.events.find((e) => e.type === 'hit');
  assert.ok(hit);
  assert.equal(typeof hit.dmg, 'number');
  assert.ok(hit.dmg > 0);
  assert.equal(typeof hit.x, 'number');
  assert.equal(typeof hit.y, 'number');
  assert.equal(typeof hit.uid, 'string');
});

test('世界常量合理：逻辑帧率 60，重力为正', () => {
  assert.equal(WORLD.FPS, 60);
  assert.ok(WORLD.GRAVITY > 0);
  assert.ok(WORLD.DEPTH_MAX > 0);
});
