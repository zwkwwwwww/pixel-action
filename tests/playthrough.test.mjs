import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step } from '../src/core/world.js';
import { createLevel, updateLevel } from '../src/core/level.js';
import { enemyThink } from '../src/core/ai.js';

// 自动玩家：用来证明「这一关在纯逻辑层真的能打通」，不依赖真人操作。
// 行为：找最近敌人 → 靠近 → 对齐车道 → 三连 → 看到敌人起手就闪避。
function botFrame(w, lv) {
  const p = w.player;
  if (p.dead || lv.won) return;
  const alive = w.enemies.filter((e) => !e.dead);
  if (alive.length === 0) {
    w.dir = { x: 1, y: 0 };
    return;
  }
  const near = alive.reduce((a, b) => (Math.abs(a.x - p.x) <= Math.abs(b.x - p.x) ? a : b));
  const dx = near.x - p.x;
  const dy = near.y - p.y;

  const danger = alive.some((e) => e.state === 'attack' && e.stateFrame <= 4 && Math.abs(e.x - p.x) < 52);
  if (danger && p.state === 'idle') {
    w.dir = { x: dx >= 0 ? -1 : 1, y: 0 };
    w.press('dodge');
    return;
  }

  if (Math.abs(dx) > 20) {
    w.dir = { x: Math.sign(dx), y: Math.abs(dy) > 6 ? Math.sign(dy) : 0 };
  } else if (Math.abs(dy) > 6) {
    w.dir = { x: 0, y: Math.sign(dy) };
  } else {
    w.dir = { x: 0, y: 0 };
    if (p.state === 'idle') w.press('attack');
  }
}

test('自动玩家能从关卡起点打穿全部波次并击败 Boss（无作弊）', () => {
  const w = createWorld({
    player: { x: 100, y: 41, hp: 120, maxHp: 120 },
    enemies: [],
    enemyThink,
  });
  const lv = createLevel();

  let frames = 0;
  const MAX = 60 * 240; // 最多 4 分钟
  while (!lv.won && !w.player.dead && frames < MAX) {
    botFrame(w, lv);
    step(w);
    updateLevel(w, lv);
    frames++;
  }

  assert.equal(w.player.dead, false, `自动玩家死亡（第 ${frames} 帧，hp=${w.player.hp}）`);
  assert.equal(lv.won, true, `未能通关（第 ${frames} 帧，segmentIndex=${lv.segmentIndex}，boss=${lv.bossSpawned}）`);
  assert.ok(frames < MAX, '超时未通关');
  // 打完必须掉血（证明不是无敌），但也不能被打死
  assert.ok(w.player.hp < 120, '全程没掉血，说明敌人根本没打中');
  assert.ok(w.player.hp > 0);
});
