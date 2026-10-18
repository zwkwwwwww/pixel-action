// 关卡：波次触发、屏幕边界锁、Boss 出场与通关判定。纯逻辑。
//
// 「闸门」不再是一根画在世界坐标上的竖线，而是「触发波次时把镜头锁在一个由触发点推导出来的机位，
// 玩家被夹在屏幕右缘内」。这样关卡边界永远等于屏幕右缘，不需要任何额外绘制，也不会挡住画面。
//
// 为什么锁定机位由 triggerX 推导、而不是取触发瞬间的相机位置：
// 相机是阻尼跟随的，玩家冲刺或瞬移时会落后很远；若跟着相机锁，边界会被锁到玩家身后，
// 形成「够不到敌人 / 被卡在触发点前面」的死局（实测 Boss 战 41px 差距就打不到）。
import { createActor } from './actor.js';
import { AI_PROFILES } from './ai.js';

export const VIEW_W = 480;        // 与渲染层一致
export const GATE_MARGIN = 4;     // 边界相对屏幕右缘的余量（只留 4px，角色视觉上贴住右边缘）
export const LOCK_LEAD = 216;     // 锁定机位 = 触发点 - 0.45 屏（与跟随公式一致）

export const LEVEL = {
  worldW: 3200,
  viewW: VIEW_W,
  gateMargin: GATE_MARGIN,
  lockLead: LOCK_LEAD,
  segments: [
    {
      triggerX: 240,
      spawns: [
        { kind: 'grunt', x: 356, y: 64 },
        { kind: 'grunt', x: 392, y: 24 },
      ],
    },
    {
      triggerX: 780,
      spawns: [
        { kind: 'grunt', x: 900, y: 62 },
        { kind: 'brute', x: 944, y: 30 },
        { kind: 'grunt', x: 872, y: 12 },
      ],
    },
    {
      triggerX: 1320,
      spawns: [
        { kind: 'ranger', x: 1452, y: 70 },
        { kind: 'grunt', x: 1484, y: 44 },
        { kind: 'grunt', x: 1462, y: 14 },
      ],
    },
  ],
  boss: {
    triggerX: 2000,
    spawn: {
      kind: 'boss', x: 2170, y: 41, hp: 420, maxHp: 420,
      speedX: 0.8, speedY: 0.6, bodyHalfW: 20, bodyHalfD: 15,
    },
  },
};

export function createLevel(level = LEVEL) {
  return {
    def: level,
    segmentIndex: 0,
    gateX: null,     // 屏幕右缘的世界坐标（只用于夹玩家，不绘制）
    camLockX: null,  // 锁定的镜头位置（null = 自由跟随）
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

/**
 * 由触发点推导锁定机位，并把这一场的屏幕右缘定为关卡边界。
 * @param {number} triggerX 波次触发世界 X
 * @param {number} maxSpawnX 本波最靠右的敌人出生 X（必须落在屏幕内）
 */
/**
 * 锁定当前这一屏：边界 = 屏幕右缘，镜头保持原地不动。
 *
 * 关键：锁定值取「触发瞬间相机真实位置」，而不是由 triggerX 推导。
 * 推导值与本帧相机位置不同 → 每次开波相机会滑一下（用户实测反馈），
 * 而且边界会落在离眼睛更远的地方。取真实相机位置后，镜头零位移，
 * 玩家面前这一屏就是战场。
 *
 * 但要兜底两种情况：
 *   1) 相机因阻尼落后于玩家 → 把锁位往前推，保证玩家不被「拉回」；
 *   2) 本波最右敌人出生在屏幕外 → 同理往前推，保证敌人可见。
 */
function lockForWave(lv, camX, playerX, maxSpawnX) {
  const viewW = lv.def.viewW ?? VIEW_W;
  const margin = lv.def.gateMargin ?? GATE_MARGIN;
  const maxCam = Math.max(0, lv.def.worldW - viewW);
  let lock = Math.round(Number.isFinite(camX) ? camX : playerX - viewW * 0.45);

  // 玩家必须在屏幕右缘内（gate = lock + viewW - margin；要求 gate - 10 >= playerX）
  lock = Math.max(lock, Math.ceil(playerX + 10 - (viewW - margin)));
  // 敌人必须完整出现在屏幕内
  lock = Math.max(lock, Math.ceil(maxSpawnX + 40 - (viewW - margin)));

  lv.camLockX = Math.max(0, Math.min(maxCam, lock));
  lv.gateX = lv.camLockX + viewW - margin;
}

/** 每个逻辑帧调用一次；负责刷怪、边界锁与胜负。 */
export function updateLevel(world, lv, camX) {
  if (lv.won) return;
  const player = world.player;

  // 边界：玩家夹在屏幕右缘内（先夹再判断触发，避免一帧穿过去）
  if (lv.gateX != null && player.x > lv.gateX - 10) player.x = lv.gateX - 10;

  const seg = lv.def.segments[lv.segmentIndex];

  if (seg && !lv.spawnedSegments.has(lv.segmentIndex) && player.x >= seg.triggerX) {
    lv.spawnedSegments.add(lv.segmentIndex);
    const maxSpawnX = Math.max(...seg.spawns.map((s) => s.x));
    lockForWave(lv, camX, player.x, maxSpawnX);
    lv.wave = seg.spawns.map((s) => spawn(world, s));
  }

  if (seg && lv.wave.length > 0 && lv.wave.every((e) => e.dead)) {
    lv.wave = [];
    lv.gateX = null;
    lv.camLockX = null;
    lv.segmentIndex++;
  }

  // 最后一波清完 → Boss 登场（同样把屏幕右缘当战场边界）
  if (lv.segmentIndex >= lv.def.segments.length && !lv.bossSpawned && player.x >= lv.def.boss.triggerX) {
    lv.bossSpawned = true;
    lockForWave(lv, camX, player.x, lv.def.boss.spawn.x);
    lv.bossActor = spawn(world, lv.def.boss.spawn);
  }

  if (lv.bossSpawned && lv.bossActor && lv.bossActor.dead) {
    lv.won = true;
    lv.gateX = null;
    lv.camLockX = null;
  }
}

/** 相机的最大世界 X：锁定时就是锁定机位，否则是关卡末端。 */
export function cameraLimit(lv) {
  const viewW = lv.def.viewW ?? VIEW_W;
  return lv.camLockX == null ? lv.def.worldW : lv.camLockX + viewW;
}
