// 关卡：波次触发、闸门、Boss 出场与通关判定。纯逻辑。
import { createActor } from './actor.js';
import { AI_PROFILES } from './ai.js';

export const LEVEL = {
  worldW: 3200,
  segments: [
    {
      triggerX: 240, gateX: 400,
      spawns: [
        { kind: 'grunt', x: 356, y: 64 },
        { kind: 'grunt', x: 392, y: 24 },
      ],
    },
    {
      triggerX: 780, gateX: 980,
      spawns: [
        { kind: 'grunt', x: 900, y: 62 },
        { kind: 'brute', x: 944, y: 30 },
        { kind: 'grunt', x: 872, y: 12 },
      ],
    },
    {
      triggerX: 1320, gateX: 1540,
      spawns: [
        { kind: 'ranger', x: 1452, y: 70 },
        { kind: 'grunt', x: 1484, y: 44 },
        { kind: 'grunt', x: 1462, y: 14 },
      ],
    },
  ],
  boss: {
    triggerX: 2000, gateX: 2520,
    spawn: { kind: 'boss', x: 2400, y: 41, hp: 420, maxHp: 420, speedX: 0.8, speedY: 0.6 },
  },
};

export function createLevel(level = LEVEL) {
  return {
    def: level,
    segmentIndex: 0,
    gateX: null,
    wave: [],
    spawnedSegments: new Set(),
    bossSpawned: false,
    bossActor: null,
    won: false,
  };
}

function spawn(world, cfg) {
  const actor = createActor({
    side: 'enemy',
    ...cfg,
    ai: AI_PROFILES[cfg.kind] || AI_PROFILES.grunt,
  });
  world.enemies.push(actor);
  world.actors.push(actor);
  return actor;
}

/** 每个逻辑帧调用一次；负责刷怪、闸门与胜负。 */
export function updateLevel(world, lv) {
  if (lv.won) return;
  const player = world.player;
  const seg = lv.def.segments[lv.segmentIndex];

  // 闸门：把玩家夹在战场内（先夹紧再判断触发，避免一帧穿门）
  if (lv.gateX != null && player.x > lv.gateX) player.x = lv.gateX;

  if (seg && !lv.spawnedSegments.has(lv.segmentIndex) && player.x >= seg.triggerX) {
    lv.spawnedSegments.add(lv.segmentIndex);
    lv.gateX = seg.gateX;
    lv.wave = seg.spawns.map((s) => spawn(world, s));
  }

  if (seg && lv.wave.length > 0 && lv.wave.every((e) => e.dead)) {
    lv.wave = [];
    lv.gateX = null;
    lv.segmentIndex++;
  }

  // 最后一波清完 → Boss 登场
  if (lv.segmentIndex >= lv.def.segments.length && !lv.bossSpawned && player.x >= lv.def.boss.triggerX) {
    lv.bossSpawned = true;
    lv.gateX = lv.def.boss.gateX;
    lv.bossActor = spawn(world, lv.def.boss.spawn);
  }

  if (lv.bossSpawned && lv.bossActor && lv.bossActor.dead) {
    lv.won = true;
    lv.gateX = null;
  }
}

/** 相机的最大世界 X（闸门落下来时镜头也不能越过）。 */
export function cameraLimit(lv) {
  return lv.gateX == null ? lv.def.worldW : lv.gateX;
}
