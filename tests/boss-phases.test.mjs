// Boss 阶段系统：血量跨过阈值时切阶段，阶段影响移速/冷却/招式，并只触发一次。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';
import { STAGES } from '../src/core/stages.js';

function bossWorld(phases, hp = 100) {
  return createWorld({
    player: { x: 100, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'b', x: 160, y: 40, hp, maxHp: hp, kind: 'boss', facing: -1,
      ai: AI_PROFILES.boss, phases, phase: 0,
    }],
    enemyThink,
  });
}

test('血量跨过 at 时进入下一阶段，并推 bossPhase 事件', () => {
  const w = bossWorld([{ at: 0.5, speed: 1.4 }]);
  const b = w.enemies[0];
  assert.equal(b.phase || 0, 0, '初始未进阶段');

  b.hp = 40;             // 40% < 50%
  step(w);

  assert.equal(b.phase, 1, '应进入阶段 1');
  assert.ok(w.events.some((e) => e.type === 'bossPhase' && e.phase === 1), '应推 bossPhase 事件');
});

test('同一阶段只触发一次（不会每帧刷事件）', () => {
  const w = bossWorld([{ at: 0.5 }]);
  const b = w.enemies[0];
  b.hp = 40;
  step(w);
  const first = w.events.filter((e) => e.type === 'bossPhase').length;

  w.events.length = 0;
  for (let i = 0; i < 10; i++) step(w);
  const later = w.events.filter((e) => e.type === 'bossPhase').length;

  assert.equal(first, 1);
  assert.equal(later, 0, '同阶段不应重复触发');
});

test('多阶段按血量依次推进', () => {
  const w = bossWorld([{ at: 0.6 }, { at: 0.3 }], 100);
  const b = w.enemies[0];

  b.hp = 50; step(w);
  assert.equal(b.phase, 1, '50% 应进阶段 1');

  b.hp = 20; step(w);
  assert.equal(b.phase, 2, '20% 应进阶段 2');
});

test('阶段召唤会真的生成小怪', () => {
  const w = bossWorld([{ at: 0.5, summon: 2 }], 100);
  const b = w.enemies[0];
  const before = w.enemies.length;

  b.hp = 40;
  step(w);

  assert.equal(w.enemies.length, before + 2, `应多 2 只小怪，实际 ${w.enemies.length - before}`);
});

test('阶段可覆盖招式表', () => {
  const w = bossWorld([{ at: 0.5, attacks: ['charge'] }], 100);
  const b = w.enemies[0];
  b.hp = 40;
  step(w);
  // 跑一段时间，Boss 出的招必须都来自阶段招式表
  const used = new Set();
  for (let i = 0; i < 400; i++) {
    step(w);
    if (b.attack) used.add(b.attack);
  }
  assert.ok(used.size > 0, 'Boss 应出过招');
  for (const a of used) {
    assert.equal(a, 'charge', `阶段招式表只有 charge，却出了 ${a}`);
  }
});

test('三个关卡的 Boss 都配了阶段表', () => {
  for (const stage of STAGES) {
    const boss = stage.boss && stage.boss.spawn;
    if (!boss) continue;
    assert.ok(Array.isArray(boss.phases) && boss.phases.length >= 1,
      `第 ${stage.id} 关 Boss 缺少 phases`);
    for (const ph of boss.phases) {
      assert.ok(ph.at > 0 && ph.at < 1, `阶段阈值 ${ph.at} 应在 (0,1)`);
    }
  }
});
