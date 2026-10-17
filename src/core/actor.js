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
  DODGE: { total: 18, iframes: 20, speed: 3.2 },
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
    speedX: cfg.speedX ?? (cfg.side === 'player' ? WORLD.PLAYER_SPEED_X : 0.9),
    speedY: cfg.speedY ?? (cfg.side === 'player' ? WORLD.PLAYER_SPEED_Y : 0.7),
  };
}

export function canAct(a) {
  return !a.dead && a.state === 'idle';
}

export function startAttack(a, attackId) {
  if (!ATTACKS[attackId]) throw new Error(`未知攻击: ${attackId}`);
  a.state = 'attack';
  a.attack = attackId;
  a.stateFrame = 0;
  a.queued = null;
  a.hitTargets.clear();
  a.vx = 0;
  a.vy = 0;
}

export function startDodge(a, dir) {
  a.state = 'dodge';
  a.stateFrame = 0;
  a.invuln = WORLD.DODGE.iframes;
  const dx = dir && dir.x !== 0 ? dir.x : -a.facing;
  a.vx = dx * WORLD.DODGE.speed;
  a.vy = 0;
}

export function bodyBox(a) {
  return {
    x1: a.x - WORLD.BODY_HALF_W,
    x2: a.x + WORLD.BODY_HALF_W,
    y1: a.y - WORLD.BODY_HALF_D,
    y2: a.y + WORLD.BODY_HALF_D,
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

  switch (a.state) {
    case 'attack': {
      const def = ATTACKS[a.attack];
      const total = def.startup + def.active + def.recovery;
      if (a.stateFrame >= total) {
        if (a.queued && ATTACKS[a.queued]) {
          const next = a.queued;
          startAttack(a, next); // 连段：无缝进下一段
        } else {
          a.state = 'idle';
          a.stateFrame = 0;
          a.attack = null;
        }
      }
      break;
    }
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

  // 击退位移（只在使用硬直/浮空/倒地时生效，避免走路时被残余速度拖拽）
  if (a.state === 'hurt' || a.state === 'launched' || a.state === 'down') {
    a.x += a.vx;
    a.vx *= WORLD.KNOCKBACK_DECAY;
    if (Math.abs(a.vx) < 0.05) a.vx = 0;
  }
  a.x = Math.max(WORLD.BODY_HALF_W, Math.min(3192, a.x));
  a.y = Math.max(0, Math.min(WORLD.DEPTH_MAX, a.y));
}
