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
  id: 1,
  name: 'RUSTED STREET',
  worldW: 3200,
  viewW: VIEW_W,
  gateMargin: GATE_MARGIN,
  lockLead: LOCK_LEAD,
  pickups: [
    // 波次之间的补给箱：走过去自动拾取（回 15% 血 + 2 飞刀）
    { x: 620, y: 40 },
    { x: 1180, y: 60 },
  ],
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
      // 教学 Boss 也给一个基础阶段：半血后稍微加快，让玩家学会看阶段刻度
      phases: [{ at: 0.5, speed: 1.2, cooldown: 0.8 }],
    },
  },
};

export function createLevel(level = LEVEL) {
  return {
    def: level,
    segmentIndex: 0,
    // 地面补给箱：走到附近自动拾取（回血 / 补弹）
    pickups: ((level && level.pickups) || []).map((pk) => ({ x: pk.x, y: pk.y, taken: false })),
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
    ai: cfg.ai || AI_PROFILES[cfg.kind] || AI_PROFILES.grunt,
  });
  // Boss 机制字段：createActor 只认白名单字段，机制参数要在生成后补挂
  if (cfg.attacks) actor.attacks = cfg.attacks;
  if (cfg.summonAt != null) actor.summonAt = cfg.summonAt;
  if (cfg.enrageAt != null) actor.enrageAt = cfg.enrageAt;
  // Boss 阶段表（血条分段机制）
  if (cfg.phases) { actor.phases = cfg.phases; actor.phase = 0; }
  // 盾兵：正面格挡（伤害 -80%），绕后或重斩才能破
  if (cfg.kind === 'shield' || cfg.shield) actor.shield = true;
  if (cfg.kind === 'flyer' || cfg.flyer) { actor.flyer = true; actor.z = 34; }
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
    // 清完一波给喘息奖励：补 1 把飞刀 + 回一点血，
    // 让「打不过就硬扛」变成「稳住节奏就有资源」，减少纯消耗战
    const pl = world.player;
    if (pl && !pl.dead) {
      pl.ammo = Math.min(9, (pl.ammo || 0) + 1);
      const heal = Math.round(pl.maxHp * 0.08);
      pl.hp = Math.min(pl.maxHp, pl.hp + heal);
      world.events.push({
        type: 'waveClear', x: pl.x, y: pl.y, heal, ammo: pl.ammo,
        wave: lv.segmentIndex, total: lv.def.segments.length,
      });
    }
  }

  // 最后一波清完 → Boss 登场（同样把屏幕右缘当战场边界）
  if (lv.segmentIndex >= lv.def.segments.length && !lv.bossSpawned && player.x >= lv.def.boss.triggerX) {
    lv.bossSpawned = true;
    lockForWave(lv, camX, player.x, lv.def.boss.spawn.x);
    lv.bossActor = spawn(world, lv.def.boss.spawn);
  }

  // 地面补给箱：进入拾取范围就自动吃掉。
  // 放在"波次间"能走到的地方，给玩家一个主动回血/补弹的机会，
  // 而不是只能靠清波奖励被动恢复。
  for (let i = lv.pickups.length - 1; i >= 0; i--) {
    const pk = lv.pickups[i];
    if (pk.taken) continue;
    if (Math.abs(player.x - pk.x) > 22 || Math.abs(player.y - pk.y) > 20) continue;
    pk.taken = true;
    const heal = Math.round(player.maxHp * 0.15);
    player.hp = Math.min(player.maxHp, player.hp + heal);
    player.ammo = Math.min(9, (player.ammo || 0) + 2);
    world.events.push({
      type: 'pickupBox', x: pk.x, y: pk.y, heal, ammo: player.ammo,
    });
    lv.pickups.splice(i, 1);
  }

  // Boss 击败演出：死亡后先给 72 帧（1.2s）的"跪地"时间，
  // 让玩家看清最后一击、听到死亡音、看到慢动作，再进结算。
  // 否则血条一空立刻弹结算，胜利的爽感会被打断。
  if (lv.bossSpawned && lv.bossActor && lv.bossActor.dead) {
    if (lv.bossDeathFrames == null) {
      lv.bossDeathFrames = 72;
      world.events.push({
        type: 'bossDown', x: lv.bossActor.x, y: lv.bossActor.y,
      });
    }
    if (lv.bossDeathFrames > 0) lv.bossDeathFrames--;
    if (lv.bossDeathFrames === 0) {
      lv.won = true;
      lv.gateX = null;
      lv.camLockX = null;
    }
  }
}

/** 相机的最大世界 X：锁定时就是锁定机位，否则是关卡末端。 */
export function cameraLimit(lv) {
  const viewW = lv.def.viewW ?? VIEW_W;
  return lv.camLockX == null ? lv.def.worldW : lv.camLockX + viewW;
}


