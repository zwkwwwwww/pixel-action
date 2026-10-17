import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipForActor, frameIndexAt, ANIM } from '../src/core/animation.js';

const actor = (over = {}) => ({ state: 'idle', stateFrame: 0, attack: null, vx: 0, dead: false, ...over });

test('静止待机用 idle，行走用 walk', () => {
  assert.equal(clipForActor(actor(), false), 'idle');
  assert.equal(clipForActor(actor(), true), 'walk');
});

test('三连击映射到三个攻击剪辑', () => {
  assert.equal(clipForActor(actor({ state: 'attack', attack: 'light1' }), false), 'attack1');
  assert.equal(clipForActor(actor({ state: 'attack', attack: 'light2' }), false), 'attack2');
  assert.equal(clipForActor(actor({ state: 'attack', attack: 'light3' }), false), 'attack3');
  assert.equal(clipForActor(actor({ state: 'attack', attack: 'special' }), false), 'special');
});

test('闪避/受击/死亡状态各自映射', () => {
  assert.equal(clipForActor(actor({ state: 'dodge' }), false), 'dodge');
  assert.equal(clipForActor(actor({ state: 'hurt' }), false), 'hurt');
  assert.equal(clipForActor(actor({ state: 'dead', dead: true }), false), 'death');
});

test('被挑空与倒地复用 hurt 剪辑（没有专用浮空动画时不能空指针）', () => {
  assert.equal(clipForActor(actor({ state: 'launched' }), false), 'hurt');
  assert.equal(clipForActor(actor({ state: 'down' }), false), 'hurt');
  assert.equal(clipForActor(actor({ state: 'getup' }), false), 'hurt');
});

test('攻击中即使有位移也不播 walk（避免攻击时脚在跑）', () => {
  assert.equal(clipForActor(actor({ state: 'attack', attack: 'light1', vx: 3 }), true), 'attack1');
});

test('循环动画按 fps 环绕，且不会越界', () => {
  const meta = { fps: 8, loop: true, frames: [[0, 0], [96, 0], [192, 0], [288, 0]] };
  assert.equal(frameIndexAt(meta, 0), 0);
  assert.equal(frameIndexAt(meta, 1 / 8), 1);
  assert.equal(frameIndexAt(meta, 1.0), 0, '1 秒后应回到第一帧');
  assert.equal(frameIndexAt(meta, 10.0), 0);
  for (let t = 0; t < 5; t += 0.037) {
    const i = frameIndexAt(meta, t);
    assert.ok(i >= 0 && i < meta.frames.length, `越界帧 ${i} @ ${t}`);
  }
});

test('非循环动画停在最后一帧，不会回卷', () => {
  const meta = { fps: 10, loop: false, frames: [[0, 0], [96, 0], [192, 0]] };
  assert.equal(frameIndexAt(meta, 0), 0);
  assert.equal(frameIndexAt(meta, 10), 2);
  assert.equal(frameIndexAt(meta, 99), 2);
});

test('ANIM 常量给出逻辑帧率与状态→剪辑的完整映射', () => {
  assert.equal(ANIM.LOGIC_FPS, 60);
  for (const s of ['idle', 'walk', 'attack', 'dodge', 'hurt', 'launched', 'down', 'getup', 'dead']) {
    assert.ok(ANIM.STATE_CLIP[s], `缺少状态映射: ${s}`);
  }
});
