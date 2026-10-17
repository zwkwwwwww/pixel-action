// 攻击数据与命中盒（纯数据 + 纯几何，可单测）。
// 单位：帧（逻辑固定 60fps）与「世界像素」。纵深方向是 2.5D 车道的 Y。

export const COMBO = {
  // 上一段 active 开始后多少帧内再次按攻击，才能接下一段
  chainWindow: 14,
  maxStep: 3,
};

export const ATTACKS = {
  light1: {
    startup: 3, active: 3, recovery: 8,
    dmg: 8, hitstun: 12, kbX: 0.5, launch: 0,
    reach: 26, halfDepth: 14,
    meterGain: 5, meterCost: 0,
    chainTo: 'light2',
  },
  light2: {
    startup: 3, active: 3, recovery: 10,
    dmg: 11, hitstun: 13, kbX: 0.6, launch: 0,
    reach: 28, halfDepth: 14,
    meterGain: 6, meterCost: 0,
    chainTo: 'light3',
  },
  light3: {
    // 上挑：慢、重、把敌人打飞（launch）
    startup: 6, active: 4, recovery: 15,
    dmg: 20, hitstun: 20, kbX: 1.0, launch: 3.2,
    reach: 28, halfDepth: 16,
    meterGain: 8, meterCost: 0,
    chainTo: null,
  },
  special: {
    // 能量必杀：起手慢、范围大、伤害高
    startup: 10, active: 8, recovery: 20,
    dmg: 42, hitstun: 28, kbX: 1.4, launch: 1.5,
    reach: 44, halfDepth: 26,
    meterGain: 0, meterCost: 100,
    chainTo: null,
  },
  slam: {
    // Boss 专用：长前摇（给玩家反应时间）+ 大范围 + 重击退
    startup: 16, active: 5, recovery: 24,
    dmg: 26, hitstun: 26, kbX: 1.8, launch: 0,
    reach: 52, halfDepth: 28,
    meterGain: 0, meterCost: 0,
    chainTo: null,
  },
};

/** 当前帧是否处于攻击判定窗口（左闭右开，帧是浮点也安全）。 */
export function isActive(def, frame) {
  const f = Math.floor(frame);
  return f >= def.startup && f < def.startup + def.active;
}

/**
 * 攻击命中盒：以角色身体中心为基准，按面朝方向在前方展开。
 * @returns {{x1:number,x2:number,y1:number,y2:number}}
 */
export function hitbox(def, actor) {
  const bodyGap = 2; // 攻击盒从身体边缘起算，避免贴脸时穿过
  const x1 = actor.facing > 0 ? actor.x + bodyGap : actor.x - def.reach;
  const x2 = actor.facing > 0 ? actor.x + def.reach : actor.x - bodyGap;
  return {
    x1, x2,
    y1: actor.y - def.halfDepth,
    y2: actor.y + def.halfDepth,
  };
}

/** 两个轴对齐盒是否相交（含贴边）。 */
export function overlaps(a, b) {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}
