import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEffects, spawnHitFx, updateEffects, MAX_PARTICLES } from '../src/core/effects.js';

const hit = (over = {}) => ({
  type: 'hit', dmg: 12, x: 120, y: 50, launch: 0, killed: false, uid: 'e1', ...over,
});

test('命中生成伤害数字与火花粒子', () => {
  const fx = createEffects();
  spawnHitFx(fx, hit());
  assert.equal(fx.numbers.length, 1);
  assert.equal(fx.numbers[0].text, '12');
  assert.ok(fx.particles.length > 0, '命中必须有粒子');
});

test('挑空/击杀的命中特效更强（数字更大或颜色不同）', () => {
  const a = createEffects();
  spawnHitFx(a, hit({ dmg: 10 }));
  const b = createEffects();
  spawnHitFx(b, hit({ dmg: 10, launch: 3, killed: true }));
  assert.ok(b.particles.length > a.particles.length, '击杀/挑空的粒子应更多');
});

test('特效会随时间过期消失（不会无限堆积）', () => {
  const fx = createEffects();
  spawnHitFx(fx, hit());
  const n0 = fx.numbers.length + fx.particles.length;
  assert.ok(n0 > 0);
  for (let i = 0; i < 240; i++) updateEffects(fx);
  assert.equal(fx.numbers.length, 0);
  assert.equal(fx.particles.length, 0);
});

test('粒子有硬上限，超了丢最旧的（防止低端机掉帧）', () => {
  const fx = createEffects();
  for (let i = 0; i < 500; i++) spawnHitFx(fx, hit());
  assert.ok(fx.particles.length <= MAX_PARTICLES, `粒子数 ${fx.particles.length} 超过上限 ${MAX_PARTICLES}`);
});

test('粒子会受重力影响并落到地面附近，不无限下坠', () => {
  const fx = createEffects();
  spawnHitFx(fx, hit());
  for (let i = 0; i < 60; i++) updateEffects(fx);
  for (const p of fx.particles) {
    assert.ok(p.y > 40 && p.y < 120, `粒子 y=${p.y} 跑飞了`);
  }
});

test('伤害数字向上飘并淡出，age 单调递增到 life 后移除', () => {
  const fx = createEffects();
  spawnHitFx(fx, hit({ dmg: 7 }));
  const num = fx.numbers[0];
  const z0 = num.z;
  for (let i = 0; i < 10; i++) updateEffects(fx);
  assert.ok(num.z > z0, '数字必须向上飘（z 增大）');
  assert.ok(num.age >= 10);
  for (let i = 0; i < num.life + 2; i++) updateEffects(fx);
  assert.equal(fx.numbers.includes(num), false, '超过 life 必须移除');
});
