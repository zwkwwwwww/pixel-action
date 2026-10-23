// 翻滚位移契约：距离要够"滚过一个身位"，太短会退化成侧移。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, step } from '../src/core/world.js';
import { WORLD } from '../src/core/actor.js';

function rollOnce() {
  const w = createWorld({ player: { x: 120, y: 40, hp: 240, maxHp: 240 }, enemies: [] });
  const x0 = w.player.x;
  w.press('dodge');
  let frames = 0;
  let maxX = x0;
  let entered = false;
  while (frames++ < 60) {
    step(w);
    if (w.player.state === 'dodge') entered = true;
    if (entered && w.player.state !== 'dodge') break;
    maxX = Math.max(maxX, w.player.x);
  }
  return { entered, dx: maxX - x0, frames: frames - 1 };
}

test('翻滚位移在 55~75px（约 1.3 个身位）', () => {
  const r = rollOnce();
  assert.ok(r.entered, '应进入翻滚状态');
  assert.ok(r.dx >= 55, `翻滚太短：${r.dx}px`);
  assert.ok(r.dx <= 75, `翻滚太长会变成传送：${r.dx}px`);
});

test('翻滚期间全程无敌（iframes 覆盖 total）', () => {
  // invuln 在 updateActor 开头先递减、命中判定在其后，所以要 +1
  assert.ok(WORLD.DODGE.iframes >= WORLD.DODGE.total,
    `无敌帧 ${WORLD.DODGE.iframes} 应覆盖翻滚 ${WORLD.DODGE.total} 帧`);
});

test('翻滚结束后回到 idle 且不再位移', () => {
  const w = createWorld({ player: { x: 120, y: 40, hp: 240, maxHp: 240 }, enemies: [] });
  w.press('dodge');
  for (let i = 0; i < 40; i++) step(w);
  const x1 = w.player.x;
  for (let i = 0; i < 20; i++) step(w);
  assert.equal(w.player.state, 'idle');
  assert.equal(Math.round(w.player.x), Math.round(x1), '停下后不应继续滑行');
});
