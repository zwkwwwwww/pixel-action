// 召唤者（第 2 关 Boss）必须用法术攻击，而不是弓手的箭。
// 这条契约防止后续调招式表时又被改回 'shoot'。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ATTACKS } from '../src/core/attacks.js';
import { STAGES } from '../src/core/stages.js';
import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';

test('bolt 是纯投射物招式（无近战判定盒）', () => {
  const b = ATTACKS.bolt;
  assert.ok(b, '缺少 bolt 招式');
  assert.equal(b.reach, 0, 'bolth 不应有近战判定');
  assert.ok(b.projectile, 'bolt 必须有 projectile 配置');
  assert.equal(b.projectile.kind, 'bolt', '投射物要标记 kind=bolt 供渲染区分');
});

test('bolt 与箭的区别：更慢、更痛、判定更宽', () => {
  const bolt = ATTACKS.bolt;
  const arrow = ATTACKS.shoot;
  assert.ok(bolt.projectile.speed < arrow.projectile.speed,
    `法球应比箭慢：${bolt.projectile.speed} vs ${arrow.projectile.speed}`);
  assert.ok(bolt.dmg > arrow.dmg, `法球应比箭痛：${bolt.dmg} vs ${arrow.dmg}`);
  assert.ok(bolt.projectile.halfDepth > arrow.projectile.halfDepth,
    '法球判定应比箭宽');
});

test('bolt 带起手预警（法术的仪式感）', () => {
  assert.ok(ATTACKS.bolt.telegraph, 'bolt 应有 telegraph 预警圈');
  assert.ok(ATTACKS.bolt.telegraph.radius > 0);
});

test('第 2 关 Boss 的招式表里只有 bolt，没有 shoot', () => {
  const stage2 = STAGES.find((s) => s.id === 2);
  assert.ok(stage2, '缺少第 2 关');
  const base = stage2.boss.spawn.attacks || [];
  assert.ok(base.includes('bolt'), `基础招式表应含 bolt，实际 ${base}`);
  assert.equal(base.includes('shoot'), false, `基础招式表不该有 shoot，实际 ${base}`);

  for (const ph of stage2.boss.spawn.phases || []) {
    if (!ph.attacks) continue;
    assert.equal(ph.attacks.includes('shoot'), false,
      `阶段招式表不该有 shoot，实际 ${ph.attacks}`);
    assert.ok(ph.attacks.includes('bolt'), `阶段招式表应含 bolt，实际 ${ph.attacks}`);
  }
});

test('弓手仍然用箭（不要误伤）', () => {
  const stage1 = STAGES.find((s) => s.id === 1);
  const hasRanger = JSON.stringify(stage1).includes('"ranger"');
  assert.ok(hasRanger, '第 1 关应有弓手');
  // 弓手的 AI profile 指向 shoot
  assert.equal(AI_PROFILES.ranger.attack, 'shoot');
});

test('召唤者实际出招时会生成 bolt 投射物', () => {
  const stage2 = STAGES.find((s) => s.id === 2);
  const bossCfg = stage2.boss.spawn;
  const w = createWorld({
    player: { x: 100, y: 40, hp: 240, maxHp: 240 },
    enemies: [{
      id: 'warden', x: 160, y: 40, hp: 560, maxHp: 560,
      kind: bossCfg.kind, ai: AI_PROFILES.boss, facing: -1,
      attacks: ['bolt'],
    }],
    enemyThink,
  });

  let boltSeen = false;
  for (let i = 0; i < 300 && !boltSeen; i++) {
    step(w);
    boltSeen = w.projectiles.some((pr) => pr.kind === 'bolt');
  }
  assert.ok(boltSeen, '召唤者应在 300 帧内射出一颗法球');
});
