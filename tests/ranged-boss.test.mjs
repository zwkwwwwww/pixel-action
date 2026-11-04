// 召唤者是远程 Boss：保持中远距离射法球，太近要后撤。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';

function duel(playerX = 100, bossX = 200) {
  const w = createWorld({
    player: { x: playerX, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'warden', x: bossX, y: 40, hp: 560, maxHp: 560,
      kind: 'boss_warden', ai: AI_PROFILES.bossRanged, facing: -1,
      attacks: ['bolt'],
    }],
    enemyThink,
  });
  return { w, boss: w.enemies[0] };
}

test('召唤者的 AI 是远程型', () => {
  assert.equal(AI_PROFILES.bossRanged.type, 'ranged');
  assert.equal(AI_PROFILES.bossRanged.attack, 'bolt');
  assert.ok(AI_PROFILES.bossRanged.minDist > 0, '必须有最小距离（会后撤）');
});

test('玩家太近时召唤者会后撤，拉开距离', () => {
  // 玩家贴脸（距离 20 < minDist 76）
  const { w, boss } = duel(100, 120);
  const d0 = Math.abs(boss.x - w.player.x);
  for (let i = 0; i < 90; i++) step(w);
  const d1 = Math.abs(boss.x - w.player.x);
  assert.ok(d1 > d0, `应拉开距离：${Math.round(d0)} → ${Math.round(d1)}`);
});

test('玩家太远时召唤者会靠近到射程内', () => {
  // 距离 260，远超 range 170
  const { w, boss } = duel(100, 360);
  const d0 = Math.abs(boss.x - w.player.x);
  for (let i = 0; i < 200; i++) step(w);
  const d1 = Math.abs(boss.x - w.player.x);
  assert.ok(d1 < d0, `应靠近：${Math.round(d0)} → ${Math.round(d1)}`);
});

test('召唤者在中距离会射法球而不是贴上来', () => {
  const { w, boss } = duel(100, 230);   // 距离 130，在射程内
  const x0 = boss.x;
  let boltSeen = false;
  for (let i = 0; i < 300 && !boltSeen; i++) {
    step(w);
    boltSeen = w.projectiles.some((pr) => pr.kind === 'bolt');
  }
  assert.ok(boltSeen, '中距离应射法球');
  // 开火期间不该大幅贴脸
  const moved = Math.abs(boss.x - x0);
  assert.ok(moved < 60, `不该大幅接近玩家，实际移动 ${Math.round(moved)}px`);
});

test('召唤者不会用近战招式（招式表只有 bolt/special）', () => {
  const { w, boss } = duel(100, 230);
  const used = new Set();
  for (let i = 0; i < 600; i++) {
    step(w);
    if (boss.attack) used.add(boss.attack);
  }
  assert.ok(used.size > 0, '应出过招');
  for (const a of used) {
    assert.ok(['bolt', 'special'].includes(a), `远程 Boss 不该用 ${a}`);
  }
});
