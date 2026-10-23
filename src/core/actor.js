// 角色（玩家/敌人通用）：状态机 + 物理 + 状态切换。
// 纯逻辑，不碰 DOM/Canvas —— 所有动作游戏手感规则都必须能在 node 里被测试。
import { ATTACKS } from './attacks.js';

export const WORLD = {
  FPS: 60,
  GRAVITY: 0.55,      // 挑空后每帧重力（世界像素/帧²）
  DEPTH_MAX: 82,      // 纵深车道总深度（屏幕像素）
  BODY_HALF_W: 8,
  BODY_HALF_D: 10,
  PLAYER_SPEED_X: 1.8,  // 108 px/s
  PLAYER_SPEED_Y: 1.05,
  KNOCKBACK_DECAY: 0.82,
  // 翻滚：位移更远（4.4 vs 3.2），无敌覆盖整个翻滚。
  // +1 是因为 invuln 在 updateActor 开头先递减、命中判定在其后，
  // 等于 total 才能保证最后一帧仍然免伤。
  // speed 决定翻滚距离：位移 ≈ speed × Σ(0.9^n) ≈ speed × 9.0（22 帧）。
  // 4.4 → 39px（旧），7.2 → 65px（当前）—— 更接近"滚过去一段身位"的手感。
  DODGE: { total: 22, iframes: 23, speed: 7.2, passThrough: true },
  // 跳跃：轻跳（短按）与高跳（按住到顶）共用一个初速，够用且好调
  JUMP: { vz: 4.6, speedX: 1.9, airControl: 0.55, maxAirJumps: 1 },
  DOWN_TIME: 26,
  GETUP_TIME: 12,
  MAX_METER: 100,
};

let uidSeq = 0;

export function createActor(cfg = {}) {
  return {
    uid: cfg.uid || `${cfg.side || 'npc'}-${++uidSeq}`,
    side: cfg.side || 'enemy',
    kind: cfg.kind || 'grunt',
    x: cfg.x ?? 0,
    y: cfg.y ?? WORLD.DEPTH_MAX / 2,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: cfg.facing ?? (cfg.side === 'player' ? 1 : -1),
    hp: cfg.hp ?? 40,
    maxHp: cfg.maxHp ?? cfg.hp ?? 40,
    meter: 0,
    state: 'idle',
    stateFrame: 0,
    attack: null,
    queued: null,
    hitTargets: new Set(),
    hurtTime: 0,
    invuln: 0,
    dead: false,
    // AI 用
    ai: cfg.ai || null,
    aiTimer: 0,
    aiming: false,   // 弓手在射程内一直举弓（决定 idle 播 aim 还是 idle）
    airJumps: 0,     // 剩余二段跳次数
    speedX: cfg.speedX ?? (cfg.side === 'player' ? WORLD.PLAYER_SPEED_X : 0.9),
    speedY: cfg.speedY ?? (cfg.side === 'player' ? WORLD.PLAYER_SPEED_Y : 0.7),
    // 体型（命中盒半宽/半深）：Boss 比小怪大，不能沿用同一个盒子
    bodyHalfW: cfg.bodyHalfW ?? WORLD.BODY_HALF_W,
    bodyHalfD: cfg.bodyHalfD ?? WORLD.BODY_HALF_D,
  };
}

export function canAct(a) {
  // 空中也能出招（跳跃攻击），否则跳跃就只是位移、少了进攻选择
  return !a.dead && (a.state === 'idle' || a.state === 'jump');
}

export function startAttack(a, attackId) {
  if (!ATTACKS[attackId]) throw new Error(`未知攻击: ${attackId}`);
  a.state = 'attack';
  a.attack = attackId;
  a.stateFrame = 0;
  a.queued = null;
  a.hitTargets.clear();
  a.shotFired = false; // 每次出招只允许放一支箭
  a.vx = 0;
  a.vy = 0;
  // 供 world 层消费：这一帧刚起手（用来生成地面预警圈）
  a.justAttacked = attackId;
}

export function startDodge(a, dir) {
  a.state = 'dodge';
  a.stateFrame = 0;
  a.invuln = WORLD.DODGE.iframes;
  // 无方向输入时朝**面向方向**前滚：滚翻的直觉是"往前翻过去"，
  // 而且朝前滚能更快脱离来袭方向（向后滚等于顺着箭跑，反而被追更久）。
  const dx = dir && dir.x !== 0 ? dir.x : a.facing;
  a.vx = dx * WORLD.DODGE.speed;
  a.vy = 0;
}

/**
 * 起跳。空中还能再跳一次（airJumps 计数），让走位更灵活。
 * 返回是否真的起跳（空中次数用完就失败）。
 */
export function startJump(a, dir) {
  const jumping = a.z > 0.5 || a.state === 'jump';
  if (jumping && (a.airJumps || 0) <= 0) return false;
  if (jumping) a.airJumps = (a.airJumps || 0) - 1;
  else a.airJumps = WORLD.JUMP.maxAirJumps;
  a.state = 'jump';
  a.stateFrame = 0;
  a.vz = WORLD.JUMP.vz;
  a.z = Math.max(a.z, 0.01);
  // 起跳时若有方向输入，带一点水平初速（跳跃位移）
  if (dir && dir.x !== 0) a.vx = dir.x * WORLD.JUMP.speedX;
  return true;
}

/** 落地：清掉空中状态与二段跳次数。 */
export function landJump(a) {
  a.z = 0;
  a.vz = 0;
  a.airJumps = 0;
  a.state = 'idle';
  a.stateFrame = 0;
}

export function bodyBox(a) {
  return {
    x1: a.x - (a.bodyHalfW ?? WORLD.BODY_HALF_W),
    x2: a.x + (a.bodyHalfW ?? WORLD.BODY_HALF_W),
    y1: a.y - (a.bodyHalfD ?? WORLD.BODY_HALF_D),
    y2: a.y + (a.bodyHalfD ?? WORLD.BODY_HALF_D),
  };
}

function land(a) {
  a.z = 0;
  a.vz = 0;
  if (a.hp <= 0) {
    a.dead = true;
    a.state = 'dead';
    a.stateFrame = 0;
  } else {
    a.state = 'down';
    a.stateFrame = 0;
  }
}

/** 推进一个角色的状态机与物理，每逻辑帧调用一次。 */
export function updateActor(a) {
  a.stateFrame++;
  if (a.invuln > 0) a.invuln--;
  if (a.guardBreak > 0) a.guardBreak--;

  switch (a.state) {
    case 'attack': {
      const def = ATTACKS[a.attack];
      const total = def.startup + def.active + def.recovery;
      if (a.stateFrame >= total) {
        if (a.queued && ATTACKS[a.queued]) {
          const next = a.queued;
          startAttack(a, next); // 连段：无缝进下一段
        } else if (a.z > 0.5) {
          // 空中出招结束：回到 jump 继续受重力，落地由 jump 分支处理
          a.state = 'jump';
          a.stateFrame = 0;
          a.attack = null;
        } else {
          a.state = 'idle';
          a.stateFrame = 0;
          a.attack = null;
        }
      }
      break;
    }
    case 'jump':
      // 跳跃：重力积分 + 落地判定。水平速度由 handleIntent 的空中控制提供。
      a.z += a.vz;
      a.vz -= WORLD.GRAVITY;
      if (a.z <= 0) landJump(a);
      break;
    case 'dodge':
      if (a.stateFrame >= WORLD.DODGE.total) {
        a.state = 'idle';
        a.stateFrame = 0;
      }
      break;
    case 'hurt':
      if (a.stateFrame >= a.hurtTime) {
        a.state = 'idle';
        a.stateFrame = 0;
      }
      break;
    case 'launched':
      a.z += a.vz;
      a.vz -= WORLD.GRAVITY;
      if (a.z <= 0 && a.vz < 0) land(a);
      break;
    case 'down':
      if (a.stateFrame >= WORLD.DOWN_TIME) {
        a.state = 'getup';
        a.stateFrame = 0;
      }
      break;
    case 'getup':
      if (a.stateFrame >= WORLD.GETUP_TIME) {
        a.state = 'idle';
        a.stateFrame = 0;
      }
      break;
    case 'dead':
    case 'idle':
    default:
      break;
  }

  // 速度位移：硬直/浮空/倒地是击退，闪避是翻滚冲刺，跳跃保留起跳初速
  if (a.state === 'hurt' || a.state === 'launched' || a.state === 'down') {
    a.x += a.vx;
    a.vx *= WORLD.KNOCKBACK_DECAY;
    if (Math.abs(a.vx) < 0.05) a.vx = 0;
  } else if (a.state === 'dodge') {
    // 翻滚位移：整个闪避期间保持冲刺速度，收招时衰减掉
    a.x += a.vx;
    a.vx *= 0.9;
  } else if (a.state === 'jump' || a.state === 'attack') {
    // 跳跃/空中出招：保留水平惯性（落地或收招后自然停止）
    if (a.z > 0.5) {
      a.x += a.vx;
      a.vx *= 0.94;
    } else {
      a.vx = 0;
    }
  }
  a.x = Math.max(WORLD.BODY_HALF_W, Math.min(3192, a.x));
  a.y = Math.max(0, Math.min(WORLD.DEPTH_MAX, a.y));
}
