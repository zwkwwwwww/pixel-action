// 地面预警圈：Boss 起手时给玩家可读的危险区域提示。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEffects, spawnTelegraph, updateEffects, isEmpty } from '../src/core/effects.js';
import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';
import { ATTACKS } from '../src/core/attacks.js';

test('预警圈入队后随时间推进，寿命结束自动移除', () => {
  const fx = createEffects();
  spawnTelegraph(fx, { x: 100, y: 40, r: 36, life: 10 });
  assert.equal(fx.telegraphs.length, 1);
  assert.equal(isEmpty(fx), false);

  for (let i = 0; i < 9; i++) updateEffects(fx);
  assert.equal(fx.telegraphs.length, 1, '未到寿命不应移除');

  updateEffects(fx);
  assert.equal(fx.telegraphs.length, 0, '到寿命应移除');
  assert.equal(isEmpty(fx), true);
});

test('预警圈最多保留 8 个，不会无限堆积', () => {
  const fx = createEffects();
  for (let i = 0; i < 20; i++) spawnTelegraph(fx, { x: i, y: 40, r: 20, life: 30 });
  assert.ok(fx.telegraphs.length <= 8, `堆积了 ${fx.telegraphs.length} 个`);
});

test('Boss 起手会推 telegraph 事件，且半径/颜色来自招式配置', () => {
  const w = createWorld({
    player: { x: 100, y: 40, hp: 120, maxHp: 120 },
    enemies: [{
      id: 'b1', x: 150, y: 40, hp: 400, maxHp: 400, kind: 'boss',
      facing: -1, ai: AI_PROFILES.boss,
    }],
    enemyThink,
  });
  let ev = null;
  for (let i = 0; i < 120 && !ev; i++) {
    step(w);
    ev = w.events.find((e) => e.type === 'telegraph');
  }
  assert.ok(ev, '120 帧内 Boss 应至少起手一次');
  const cfg = ATTACKS.slam.telegraph;
  assert.equal(ev.radius, cfg.radius);
  assert.equal(ev.color, cfg.color);
  assert.ok(ev.life >= 6, '预警圈存活时间应覆盖前摇');
});

test('玩家自己的必杀不产生敌人预警圈', () => {
  const w = createWorld({ player: { x: 100, y: 40, hp: 120, maxHp: 120 }, enemies: [] });
  w.player.meter = 100;
  w.press('special');
  for (let i = 0; i < 12; i++) step(w);
  assert.equal(w.events.some((e) => e.type === 'telegraph'), false);
});
