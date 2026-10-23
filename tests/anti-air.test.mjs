// 敌人对空反应：玩家跳起来时，近战不空挥、弓手会预判。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';

function withEnemy(kind, x = 130) {
  return createWorld({
    player: { x: 100, y: 40, hp: 240, maxHp: 240 },
    enemies: [{ id: 'e', x, y: 40, hp: 200, maxHp: 200, kind, facing: -1, ai: AI_PROFILES[kind] }],
    enemyThink,
  });
}

test('玩家浮空时近战敌人不出招（不空挥）', () => {
  const w = withEnemy('grunt');
  const e = w.enemies[0];
  // 玩家贴在攻击距离内、但处于浮空
  w.player.x = 118;
  w.player.z = 26;
  w.player.vz = 1.0;
  w.player.state = 'jump';

  let attacked = false;
  for (let i = 0; i < 60; i++) {
    // 维持浮空（模拟长时间滞空）
    w.player.z = 26;
    w.player.vz = 1.0;
    step(w);
    if (e.attack) attacked = true;
  }
  assert.equal(attacked, false, '玩家在头顶时不该空挥');
});

test('玩家落地后近战立刻恢复攻击', () => {
  const w = withEnemy('grunt');
  const e = w.enemies[0];
  w.player.x = 118;
  w.player.z = 26;
  w.player.state = 'jump';

  for (let i = 0; i < 20; i++) { w.player.z = 26; w.player.vz = 1.0; step(w); }

  // 落地
  w.player.z = 0;
  w.player.vz = 0;
  w.player.state = 'idle';

  let attacked = false;
  for (let i = 0; i < 90 && !attacked; i++) {
    step(w);
    if (e.attack) attacked = true;
  }
  assert.ok(attacked, '落地后应恢复攻击');
});

test('弓手对浮空玩家会延后出箭（预判）', () => {
  const w = withEnemy('ranger', 200);
  const e = w.enemies[0];
  w.player.z = 26;
  w.player.state = 'jump';
  e.aiTimer = 0;

  // 浮空时：前若干帧不应出箭
  let earlyShot = false;
  for (let i = 0; i < 8; i++) {
    w.player.z = 26;
    step(w);
    if (e.attack) earlyShot = true;
  }
  assert.equal(earlyShot, false, '浮空初期不该立刻射');
  assert.ok((e.airShotDelay || 0) > 0, '应累计对空预判延迟');
});

test('玩家在地面时弓手正常射击，不累积延迟', () => {
  const w = withEnemy('ranger', 200);
  const e = w.enemies[0];
  e.aiTimer = 0;
  w.player.z = 0;

  let shot = false;
  for (let i = 0; i < 60 && !shot; i++) {
    step(w);
    if (e.attack) shot = true;
  }
  assert.ok(shot, '地面目标应正常射击');
  assert.equal(e.airShotDelay || 0, 0, '地面不该有对空延迟');
});
