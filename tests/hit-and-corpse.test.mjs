// 连打节奏 & 死亡尸体的纯逻辑测试（不碰 DOM / WebAudio）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hitVariation, nextCombo, COMBO_WINDOW_MS } from '../src/core/hit-rhythm.js';
import { clipForActor, frameIndexAt, stateSeconds } from '../src/core/animation.js';

test('连段内音高按三级循环上升，第 4 下是重音', () => {
  const v = [0, 1, 2, 3].map((c) => hitVariation(c));
  assert.equal(v[0].heavy, false);
  assert.equal(v[1].heavy, false);
  assert.equal(v[2].heavy, false);
  assert.equal(v[3].heavy, true, '第 4 下（combo=3）必须是重音');

  // 前三级递增（0.96 → 0.995 → 1.03）
  assert.ok(v[0].rate < v[1].rate && v[1].rate < v[2].rate, `速率未递增: ${v.map((x) => x.rate)}`);
  assert.ok(v[3].rate < v[0].rate, '重音应该比普通命中更低');
});

test('超过窗口就重置连段', () => {
  assert.equal(nextCombo(2, 1000, 900), 3, '窗口内应 +1');
  assert.equal(nextCombo(2, 1000, 1000 - COMBO_WINDOW_MS - 1), 0, '超窗口应归零');
  assert.equal(nextCombo(0, 1000, 0), 0, '很久没命中应从 0 开始');
});

test('死亡角色播 death 剪辑并冻结在最后一帧（不再压成灰色条）', () => {
  const dead = { dead: true, state: 'dead', stateFrame: 400 };
  assert.equal(clipForActor(dead, false), 'death');

  const meta = { fps: 10, loop: false, frames: [[0, 0], [96, 0], [192, 0]] };
  assert.equal(frameIndexAt(meta, stateSeconds(dead)), 2, '超时后必须停在最后一帧');

  const fresh = { dead: true, state: 'dead', stateFrame: 0 };
  assert.equal(frameIndexAt(meta, stateSeconds(fresh)), 0, '刚死时从第一帧开始播');
});
