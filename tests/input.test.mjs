import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirFromKeys, LANE_COUNT } from '../src/core/input.js';

test('纵深车道数为 4', () => {
  assert.equal(LANE_COUNT, 4);
});

test('单向按键映射到单位方向', () => {
  assert.deepEqual(dirFromKeys({ left: true }), { x: -1, y: 0 });
  assert.deepEqual(dirFromKeys({ right: true }), { x: 1, y: 0 });
  assert.deepEqual(dirFromKeys({ up: true }), { x: 0, y: -1 });
  assert.deepEqual(dirFromKeys({ down: true }), { x: 0, y: 1 });
});

test('左右同时按下互相抵消，上下同时按下互相抵消', () => {
  assert.deepEqual(dirFromKeys({ left: true, right: true }), { x: 0, y: 0 });
  assert.deepEqual(dirFromKeys({ up: true, down: true }), { x: 0, y: 0 });
});

test('斜向按键保留两个分量（允许斜走）', () => {
  assert.deepEqual(dirFromKeys({ right: true, up: true }), { x: 1, y: -1 });
  assert.deepEqual(dirFromKeys({ left: true, down: true }), { x: -1, y: 1 });
});

test('无按键返回零向量', () => {
  assert.deepEqual(dirFromKeys({}), { x: 0, y: 0 });
  assert.deepEqual(dirFromKeys(undefined), { x: 0, y: 0 });
});
