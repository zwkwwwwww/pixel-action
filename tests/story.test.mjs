// 叙事文案契约：结构与"字体可用字符"校验。
// 最容易被忽略的坑：像素字体里逗号/引号/括号是**空白字形**，
// 写进文案会渲染成缺口，肉眼看像"字没了"。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STORY, STORY_CHARS_PER_FRAME, BLANK_GLYPHS, sceneCharCount } from '../src/core/story.js';
import { glyphFor } from '../src/render/pixelfont.js';

test('开场有 3 幕、结局有 1 幕', () => {
  assert.equal(STORY.intro.length, 3, `开场应为 3 幕，实际 ${STORY.intro.length}`);
  assert.equal(STORY.ending.length, 1, `结局应为 1 幕，实际 ${STORY.ending.length}`);
});

test('每一幕都有背景、文字，且文字行数合理', () => {
  for (const key of ['intro', 'ending']) {
    STORY[key].forEach((scene, i) => {
      assert.ok(scene.bg, `${key}[${i}] 缺 bg`);
      assert.ok(Array.isArray(scene.lines) && scene.lines.length > 0, `${key}[${i}] 缺 lines`);
      assert.ok(scene.lines.length <= 3, `${key}[${i}] 行数过多会溢出文字框`);
      for (const line of scene.lines) {
        assert.ok(line.length > 0 && line.length <= 46, `${key}[${i}] 行过长（${line.length}）：${line}`);
      }
    });
  }
});

test('文案里不能出现像素字体的空白字形', () => {
  for (const key of ['intro', 'ending']) {
    STORY[key].forEach((scene, i) => {
      for (const line of scene.lines) {
        for (const bad of BLANK_GLYPHS) {
          assert.equal(line.includes(bad), false,
            `${key}[${i}] 含空白字形 "${bad}"：${line}`);
        }
      }
    });
  }
});

test('文案的每个字符都必须有实际笔画（逐字符验证字体）', () => {
  for (const key of ['intro', 'ending']) {
    STORY[key].forEach((scene, i) => {
      for (const line of scene.lines) {
        for (const ch of line) {
          if (ch === ' ') continue;
          const rows = glyphFor(ch);
          const ink = rows.join('').split('').filter((c) => c === '#').length;
          assert.ok(ink > 0, `${key}[${i}] 字符 "${ch}" 在字体里没有笔画：${line}`);
        }
      }
    });
  }
});

test('立绘引用只指向合法的 portrait id', () => {
  const allowed = new Set([null, 'hero_portrait', 'warden_portrait']);
  for (const key of ['intro', 'ending']) {
    STORY[key].forEach((scene, i) => {
      assert.ok(allowed.has(scene.portrait), `${key}[${i}] 非法立绘：${scene.portrait}`);
    });
  }
});

test('逐字机参数合理，sceneCharCount 计算正确', () => {
  assert.ok(STORY_CHARS_PER_FRAME > 0 && STORY_CHARS_PER_FRAME < 3);
  const scene = { lines: ['AB', 'CDE'] };
  assert.equal(sceneCharCount(scene), 5);
});
