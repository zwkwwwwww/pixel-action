// 蓄力重斩：按住攻击键够久，松手出重招。验证数据契约与出手链路。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ATTACKS, CHARGE, isActive, hitbox } from '../src/core/attacks.js';
import { createWorld, step } from '../src/core/world.js';

test('蓄力重斩的数值定位：比三连更痛、更远、收招更久', () => {
  const h = ATTACKS.heavy;
  assert.ok(h, '缺少 heavy 招式');
  assert.ok(h.dmg > ATTACKS.light3.dmg, `重斩伤害应高于上挑: ${h.dmg} vs ${ATTACKS.light3.dmg}`);
  assert.ok(h.reach > ATTACKS.light1.reach, '重斩判定应比轻击更远');
  assert.ok(h.recovery > ATTACKS.light3.recovery, '重斩收招必须更长（打空要付代价）');
  assert.ok(h.meterGain > ATTACKS.light1.meterGain, '重斩应回更多能量');
});

test('蓄力阈值合理：0.3~0.7 秒之间，且满蓄上限更大', () => {
  assert.ok(CHARGE.frames >= 18 && CHARGE.frames <= 42, `蓄力阈值 ${CHARGE.frames} 帧不在 0.3~0.7s`);
  assert.ok(CHARGE.maxFrames > CHARGE.frames);
});

test('press("heavy") 会让玩家进入 heavy 招式且判定盒朝前', () => {
  const w = createWorld({ player: { x: 100, y: 40, hp: 120, maxHp: 120 }, enemies: [] });
  w.press('heavy');
  step(w);
  assert.equal(w.player.state, 'attack');
  assert.equal(w.player.attack, 'heavy');

  const def = ATTACKS.heavy;
  const box = hitbox(def, w.player);
  assert.ok(box.x2 > w.player.x, '重斩判定盒必须朝面向方向展开');
});

test('重斩命中会造成高于轻击的伤害', () => {
  const w = createWorld({
    player: { x: 100, y: 40, hp: 120, maxHp: 120 },
    enemies: [{ id: 'e1', x: 118, y: 40, hp: 200, maxHp: 200, kind: 'grunt', facing: -1 }],
  });
  const e = w.enemies[0];
  w.press('heavy');
  for (let i = 0; i < 30; i++) step(w);
  assert.ok(200 - e.hp >= ATTACKS.heavy.dmg, `重斩没打满伤害: 掉了 ${200 - e.hp}`);
});
