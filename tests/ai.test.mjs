import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step } from '../src/core/world.js';
import { enemyThink, AI_PROFILES } from '../src/core/ai.js';

const setup = (aiType = 'grunt', ex = 300, ey = 50) => {
  const w = createWorld({
    player: { x: 100, y: 50, hp: 120, maxHp: 120 },
    enemies: [{
      id: 'e1', x: ex, y: ey, hp: 40, maxHp: 40, kind: aiType, facing: -1,
      ai: AI_PROFILES[aiType],
    }],
    enemyThink,
  });
  return w;
};

test('三种敌人 AI 配置齐全且参数合理', () => {
  for (const t of ['grunt', 'brute', 'ranger']) {
    const p = AI_PROFILES[t];
    assert.ok(p, `缺少 AI 配置 ${t}`);
    assert.ok(p.range > 0 && p.cooldown > 0 && p.speed > 0);
  }
});

test('远处的敌人会主动靠近玩家', () => {
  const w = setup('grunt', 300, 50);
  const e = w.enemies[0];
  const x0 = e.x;
  for (let i = 0; i < 60; i++) step(w);
  assert.ok(e.x < x0 - 10, `敌人没有靠近：${x0} -> ${e.x}`);
});

test('进入攻击距离后敌人会出招，并朝向玩家', () => {
  const w = setup('grunt', 130, 50);
  const e = w.enemies[0];
  e.ai = { ...AI_PROFILES.grunt, cooldown: 1 };
  for (let i = 0; i < 40; i++) step(w);
  assert.ok(
    w.events.some((ev) => ev.type === 'hit' && ev.attacker === e.uid),
    '敌人进入距离后应当攻击玩家',
  );
});

test('攻击有冷却，不会每帧疯狂出招', () => {
  const w = setup('grunt', 130, 50);
  const e = w.enemies[0];
  let attackStarts = 0;
  let prev = e.state;
  for (let i = 0; i < 240; i++) {
    step(w);
    if (e.state === 'attack' && prev !== 'attack') attackStarts++;
    prev = e.state;
  }
  assert.ok(attackStarts >= 1, '240 帧内至少出手一次');
  assert.ok(attackStarts <= 10, `出手次数过多（冷却失效）：${attackStarts}`);
});

test('远程敌人保持距离：贴太近会后撤', () => {
  const w = setup('ranger', 118, 50);
  const e = w.enemies[0];
  const d0 = Math.abs(e.x - w.player.x);
  for (let i = 0; i < 40; i++) step(w);
  assert.ok(Math.abs(e.x - w.player.x) >= d0 - 2, '射手贴脸时应拉开距离');
});

test('已死亡的敌人不再行动', () => {
  const w = setup('grunt', 300, 50);
  const e = w.enemies[0];
  e.dead = true;
  e.state = 'dead';
  const x0 = e.x;
  for (let i = 0; i < 60; i++) step(w);
  assert.equal(e.x, x0);
});

test('敌人不会走到玩家身后的纵深之外（车道夹紧）', () => {
  const w = setup('grunt', 300, 0);
  const e = w.enemies[0];
  for (let i = 0; i < 120; i++) step(w);
  assert.ok(e.y >= 0 && e.y <= 82, `纵深越界: ${e.y}`);
});

test('弓手在射程内一直举弓，离开射程才放下', () => {
  // 射程内（ranger range 150 / minDist 78）：举弓
  const inRange = setup('ranger', 220, 50);
  const er = inRange.enemies[0];
  er.aiTimer = 30;                       // 冷却中，不应出招
  step(inRange);
  assert.equal(er.aiming, true, '射程内应保持拉弓');
  assert.equal(er.state, 'idle', '冷却中不应出招');

  // 太远：放下
  const far = setup('ranger', 600, 50);
  const ef = far.enemies[0];
  step(far);
  assert.equal(ef.aiming, false, '超出射程应放下弓');

  // 太近：后撤时不举弓
  const close = setup('ranger', 118, 50);
  const ec = close.enemies[0];
  step(close);
  assert.equal(ec.aiming, false, '贴脸后撤时不应保持拉弓');
});
