// 关卡表：每关一套波次 + Boss。纯数据，级别逻辑在 level.js。
//
// 第一关沿用原来的 RUSTED STREET；第二关照搬同一套敌人，但**数量与组合更狠**：
// 波次更多、双弓手、双壮汉，Boss 血量与追击速度上调。
// 数值目标：第一关 ~70~110s 通关，第二关 ~100~150s（对应 C-B-A-S 的时间档）。

import { LEVEL } from './level.js';
import { AI_PROFILES } from './ai.js';

export const STAGE_1 = LEVEL;

export const STAGE_2 = {
  id: 2,
  name: 'MOONLIT FOUNDRY',
  worldW: 3400,
  viewW: 480,
  pickups: [
    { x: 700, y: 24 },
    { x: 1320, y: 56 },
  ],
  gateMargin: 4,
  lockLead: 216,
  segments: [
    {
      triggerX: 260,
      spawns: [
        { kind: 'grunt', x: 372, y: 66 },
        { kind: 'grunt', x: 404, y: 22 },
        { kind: 'brute', x: 430, y: 44 },
        { kind: 'shield', x: 470, y: 20 },
      ],
    },
    {
      triggerX: 820,
      spawns: [
        { kind: 'ranger', x: 936, y: 72 },
        { kind: 'ranger', x: 908, y: 30 },
        { kind: 'flyer', x: 960, y: 48 },
        { kind: 'flyer', x: 990, y: 16 },
        { kind: 'grunt', x: 962, y: 50 },
      ],
    },
    {
      triggerX: 1380,
      spawns: [
        { kind: 'brute', x: 1508, y: 62 },
        { kind: 'shield', x: 1544, y: 34 },
        { kind: 'brute', x: 1544, y: 26 },
        { kind: 'grunt', x: 1470, y: 44 },
        { kind: 'grunt', x: 1518, y: 10 },
      ],
    },
  ],
  boss: {
    triggerX: 2100,
    spawn: {
      kind: 'boss_warden', ai: AI_PROFILES.bossRanged, x: 2268, y: 41, hp: 560, maxHp: 560,
      attacks: ['bolt'],
      phases: [
        // 一阶段：半血召唤援军，逼玩家分心清场
        { at: 0.6, summon: 2 },
        // 二阶段：召唤者亲自下场，提速 + 更短的出手间隔
        { at: 0.3, speed: 1.35, cooldown: 0.65, attacks: ['bolt', 'special'] },
      ],
      speedX: 0.9, speedY: 0.65, bodyHalfW: 20, bodyHalfD: 15,
    },
  },
};

export const STAGE_3 = {
  id: 3,
  name: 'CLOCK TOWER',
  bg: 'bg_boss',
  worldW: 3600,
  viewW: 480,
  pickups: [
    { x: 700, y: 24 },
    { x: 1320, y: 56 },
  ],
  gateMargin: 4,
  lockLead: 216,
  segments: [
    {
      triggerX: 280,
      spawns: [
        { kind: 'brute', x: 396, y: 40 },
        { kind: 'ranger', x: 430, y: 66 },
        { kind: 'grunt', x: 400, y: 18 },
        { kind: 'grunt', x: 452, y: 50 },
      ],
    },
    {
      triggerX: 900,
      spawns: [
        { kind: 'ranger', x: 1020, y: 72 },
        { kind: 'ranger', x: 996, y: 26 },
        { kind: 'brute', x: 1044, y: 48 },
        { kind: 'grunt', x: 980, y: 10 },
      ],
    },
    {
      triggerX: 1500,
      spawns: [
        { kind: 'brute', x: 1620, y: 62 },
        { kind: 'brute', x: 1652, y: 24 },
        { kind: 'shield', x: 1690, y: 42 },
        { kind: 'shield', x: 1712, y: 12 },
        { kind: 'ranger', x: 1600, y: 44 },
        { kind: 'ranger', x: 1660, y: 8 },
        { kind: 'grunt', x: 1584, y: 30 },
      ],
    },
  ],
  boss: {
    triggerX: 2250,
    spawn: {
      kind: 'boss_berserker', ai: AI_PROFILES.boss, x: 2420, y: 41, hp: 700, maxHp: 700,
      attacks: ['charge', 'slam', 'special'],
      phases: [
        // 一阶段：狂暴，移速与出手频率大幅提升
        { at: 0.45, speed: 1.4, cooldown: 0.6 },
        // 二阶段：拼命，只打冲锋，但间隙更短
        { at: 0.15, speed: 1.55, cooldown: 0.5, attacks: ['charge', 'slam'] },
      ],
      speedX: 1.0, speedY: 0.7, bodyHalfW: 20, bodyHalfD: 15,
    },
  },
};

export const STAGES = [STAGE_1, STAGE_2, STAGE_3];

/** 该关总敌人数（含 Boss），用于难度对比与测试。 */
export function stageEnemyCount(stage) {
  return stage.segments.reduce((n, seg) => n + seg.spawns.length, 0) + 1;
}



