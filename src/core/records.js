// 通关记录：纯函数 + 可注入 storage，方便单测（node 里没有 localStorage）。
// 只记三样：最快通关时间、通关次数、历史最好评价。

export const STORAGE_KEY = 'rusted-moon-records-v1';

const GRADES = ['C', 'B', 'A', 'S'];

/** 毫秒 → "01:23.4" */
export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const tenth = Math.floor((total % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenth}`;
}

/**
 * 评价：时间档（≤90s=2 / ≤150s=1 / ≤240s=0 / 更慢=-1）+ 残血 ≥70% 加 1 档，
 * 再夹到 0~3。这样「快但残血」拿 A，「中速满血」也拿 A，只有又快又稳才 S。
 * 返回 'S' | 'A' | 'B' | 'C'
 */
export function rateRun({ timeMs, hp, maxHp }) {
  const seconds = timeMs / 1000;
  const hpRatio = maxHp > 0 ? Math.max(0, hp) / maxHp : 0;
  let score = -1;
  if (seconds <= 90) score = 2;
  else if (seconds <= 150) score = 1;
  else if (seconds <= 240) score = 0;
  if (hpRatio >= 0.7) score += 1;
  return GRADES[Math.max(0, Math.min(GRADES.length - 1, score))];
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadRecords(storage = defaultStorage()) {
  const empty = { bestTimeMs: null, clears: 0, bestGrade: null };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      bestTimeMs: Number.isFinite(parsed.bestTimeMs) ? parsed.bestTimeMs : null,
      clears: Number.isFinite(parsed.clears) ? parsed.clears : 0,
      bestGrade: GRADES.includes(parsed.bestGrade) ? parsed.bestGrade : null,
    };
  } catch {
    return empty;
  }
}

function betterGrade(a, b) {
  const ia = a ? GRADES.indexOf(a) : -1;
  const ib = b ? GRADES.indexOf(b) : -1;
  return GRADES[Math.max(0, ia, ib)];
}

/** 记录一次通关，返回 { records, grade, isNewBest }。 */
export function saveClear(storage, { timeMs, hp, maxHp }) {
  const prev = loadRecords(storage);
  const grade = rateRun({ timeMs, hp, maxHp });
  const isNewBest = prev.bestTimeMs === null || timeMs < prev.bestTimeMs;
  const records = {
    bestTimeMs: isNewBest ? Math.round(timeMs) : prev.bestTimeMs,
    clears: prev.clears + 1,
    bestGrade: betterGrade(prev.bestGrade, grade),
  };
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch { /* 隐私模式/配额满就静默不存 */ }
  }
  return { records, grade, isNewBest };
}
