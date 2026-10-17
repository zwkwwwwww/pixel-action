import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputBuffer } from '../src/core/input.js';

test('窗口时间内按下的攻击能被消费一次', () => {
  const b = new InputBuffer(8);
  b.press('attack', 100);
  assert.equal(b.consume('attack', 103, 6), true);
  assert.equal(b.consume('attack', 103, 6), false, '同一个按键不能被消费两次');
});

test('超出窗口的输入自动过期', () => {
  const b = new InputBuffer(8);
  b.press('attack', 100);
  assert.equal(b.consume('attack', 120, 6), false);
});

test('不同动作互不影响', () => {
  const b = new InputBuffer(8);
  b.press('attack', 10);
  b.press('dodge', 11);
  assert.equal(b.consume('dodge', 13, 6), true);
  assert.equal(b.consume('attack', 13, 6), true);
});

test('缓冲有上限，超限丢最旧的', () => {
  const b = new InputBuffer(3);
  for (let i = 0; i < 10; i++) b.press('attack', i);
  assert.ok(b.size <= 3);
  assert.equal(b.consume('attack', 9, 6), true);
});

test('不消费的旧输入会在 tick 时被清掉（防止卡输入）', () => {
  const b = new InputBuffer(8);
  b.press('attack', 0);
  b.tick(100, 12);
  assert.equal(b.consume('attack', 100, 6), false);
});
