import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, textWidth, glyphFor, isSupported } from '../src/render/pixelfont.js';

test('每个字形都是 5x7 的点阵', () => {
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, 7, `${ch} 行数不是 7`);
    for (const r of rows) assert.equal(r.length, 5, `${ch} 某行宽度不是 5: "${r}"`);
  }
});

test('26 个大写字母与 10 个数字全部有字形', () => {
  for (let c = 65; c <= 90; c++) assert.ok(isSupported(String.fromCharCode(c)), `缺少 ${String.fromCharCode(c)}`);
  for (let d = 48; d <= 57; d++) assert.ok(isSupported(String.fromCharCode(d)), `缺少 ${String.fromCharCode(d)}`);
});

test('小写自动映射到大写，未知字符降级为空格而不是崩溃', () => {
  assert.equal(glyphFor('a'), GLYPHS.A);
  assert.deepEqual(glyphFor('中'), GLYPHS[' ']);
});

test('文本宽度 = 字符数 × (5+1) × 缩放（末字符也占位，便于等宽排版）', () => {
  assert.equal(textWidth('HP', 1), 12);
  assert.equal(textWidth('HP', 2), 24);
  assert.equal(textWidth('', 1), 0);
});
