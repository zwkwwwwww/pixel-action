import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeViewport, BASE_W, BASE_H } from '../src/render/scale.js';

test('视口常量是 480x270 的 16:9 内部渲染尺寸', () => {
  assert.equal(BASE_W, 480);
  assert.equal(BASE_H, 270);
  assert.ok(Math.abs(BASE_W / BASE_H - 16 / 9) < 0.001);
});

test('1920x1080 窗口得到整数倍 4 缩放且无留边', () => {
  const v = computeViewport(1920, 1080);
  assert.equal(v.scale, 4);
  assert.equal(v.cssW, 1920);
  assert.equal(v.cssH, 1080);
  assert.equal(v.offsetX, 0);
  assert.equal(v.offsetY, 0);
});

test('1440x900 窗口取较小的整数倍并居中留边', () => {
  const v = computeViewport(1440, 900);
  assert.equal(v.scale, 3); // min(1440/480=3, 900/270=3.33) -> 3
  assert.equal(v.cssW, 1440);
  assert.equal(v.cssH, 810);
  assert.equal(v.offsetX, 0);
  assert.equal(v.offsetY, 45);
});

test('缩放永远是整数，绝不做小数倍拉伸', () => {
  for (const [w, h] of [[1000, 700], [1280, 720], [1366, 768], [853, 480], [500, 281]]) {
    const v = computeViewport(w, h);
    assert.ok(Number.isInteger(v.scale), `scale ${v.scale} for ${w}x${h}`);
    assert.ok(v.cssW <= w && v.cssH <= h);
  }
});

test('窗口小于内部分辨率时 scale 至少为 1（不缩成 0）', () => {
  const v = computeViewport(320, 180);
  assert.equal(v.scale, 1);
  assert.equal(v.cssW, 480);
  assert.equal(v.cssH, 270);
});

test('非法窗口尺寸兜底为 1 倍，不返回 NaN', () => {
  for (const bad of [[0, 0], [-10, 100], [NaN, 100], [undefined, 200]]) {
    const v = computeViewport(...bad);
    assert.equal(v.scale, 1);
    assert.ok(Number.isFinite(v.cssW) && Number.isFinite(v.cssH));
  }
});

test('整数像素偏移：offset 必须是整数，否则放大后会出现半像素模糊', () => {
  for (const [w, h] of [[1001, 703], [1919, 1079], [777, 555]]) {
    const v = computeViewport(w, h);
    assert.ok(Number.isInteger(v.offsetX));
    assert.ok(Number.isInteger(v.offsetY));
  }
});
