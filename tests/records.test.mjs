// 通关记录：耗时格式化、评价分档、存档读写。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatTime, rateRun, loadRecords, saveClear, STORAGE_KEY } from '../src/core/records.js';

function fakeStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    map,
  };
}

test('formatTime 输出 mm:ss.t', () => {
  assert.equal(formatTime(0), '00:00.0');
  assert.equal(formatTime(83400), '01:23.4');
  assert.equal(formatTime(60000), '01:00.0');
  assert.equal(formatTime(-5), '00:00.0');
});

test('评价按用时分档，残血高可升一档', () => {
  assert.equal(rateRun({ timeMs: 80000, hp: 120, maxHp: 120 }), 'S');   // 90s 内 + 满血
  assert.equal(rateRun({ timeMs: 80000, hp: 60, maxHp: 120 }), 'A');    // 90s 内但半血
  assert.equal(rateRun({ timeMs: 120000, hp: 120, maxHp: 120 }), 'A'); // 2 分内 + 满血
  assert.equal(rateRun({ timeMs: 120000, hp: 60, maxHp: 120 }), 'B');   // 2 分内 + 半血
  assert.equal(rateRun({ timeMs: 200000, hp: 60, maxHp: 120 }), 'C');   // 偏慢 + 半血
  assert.equal(rateRun({ timeMs: 300000, hp: 20, maxHp: 120 }), 'C');   // 超时 + 残血
});

test('首次通关写入记录并标记新纪录', () => {
  const s = fakeStorage();
  const r = saveClear(s, { timeMs: 85000, hp: 120, maxHp: 120 });
  assert.equal(r.isNewBest, true);
  assert.equal(r.grade, 'S');
  assert.equal(r.records.clears, 1);
  assert.equal(r.records.bestTimeMs, 85000);

  const loaded = loadRecords(s);
  assert.deepEqual(loaded, r.records);
  assert.ok(s.map.has(STORAGE_KEY));
});

test('更慢的通关不覆盖最佳时间，但累计次数与最好评价', () => {
  const s = fakeStorage();
  saveClear(s, { timeMs: 85000, hp: 120, maxHp: 120 });
  const r = saveClear(s, { timeMs: 200000, hp: 30, maxHp: 120 });
  assert.equal(r.isNewBest, false);
  assert.equal(r.records.bestTimeMs, 85000, '最佳时间应保持不变');
  assert.equal(r.records.clears, 2);
  assert.equal(r.records.bestGrade, 'S', '历史最好评价不能被更差的一局拉低');
});

test('没有 storage 或数据损坏时安全降级', () => {
  assert.deepEqual(loadRecords(null), { bestTimeMs: null, clears: 0, bestGrade: null });
  const bad = fakeStorage({ [STORAGE_KEY]: '{not json' });
  assert.deepEqual(loadRecords(bad), { bestTimeMs: null, clears: 0, bestGrade: null });
  // 坏数据上继续保存也应可用
  const r = saveClear(bad, { timeMs: 100000, hp: 120, maxHp: 120 });
  assert.equal(r.records.clears, 1);
  assert.equal(saveClear(null, { timeMs: 1, hp: 1, maxHp: 1 }).records.clears, 1);
});
