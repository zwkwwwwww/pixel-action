// 动画：把「逻辑状态」翻译成「精灵剪辑 + 帧号」。纯逻辑，可在 node 单测。
// 渲染层拿到帧号后只负责把精灵表的某个格子贴到屏幕上。

export const ANIM = {
  LOGIC_FPS: 60,
  STATE_CLIP: {
    idle: 'idle',
    walk: 'walk',
    attack: 'attack?', // 由 attack id 决定具体剪辑
    dodge: 'dodge',
    hurt: 'hurt',
    launched: 'hurt',  // 浮空暂时复用受击（没有专用浮空帧）
    down: 'hurt',
    getup: 'hurt',
    dead: 'death',
  },
  ATTACK_CLIP: {
    light1: 'attack1',
    light2: 'attack2',
    light3: 'attack3',
    special: 'special',
  },
};

/** 该角色此刻应该播哪个剪辑。 */
export function clipForActor(actor, moving = false) {
  if (actor.dead || actor.state === 'dead') return 'death';
  if (actor.state === 'attack') return ANIM.ATTACK_CLIP[actor.attack] || 'attack1';
  if (actor.state === 'idle') return moving ? 'walk' : 'idle';
  return ANIM.STATE_CLIP[actor.state] || 'idle';
}

/**
 * 给定剪辑元数据与已播放秒数，算出帧下标。
 * @param {{fps:number, loop:boolean, frames:any[]}} meta
 * @param {number} seconds
 */
export function frameIndexAt(meta, seconds) {
  const n = meta.frames.length;
  if (n === 0) return 0;
  const raw = Math.floor(Math.max(0, seconds) * meta.fps);
  if (meta.loop) return ((raw % n) + n) % n;
  return Math.min(n - 1, raw);
}

/** 逻辑帧 → 秒（状态机是按逻辑帧推进的）。 */
export function stateSeconds(actor) {
  return actor.stateFrame / ANIM.LOGIC_FPS;
}
