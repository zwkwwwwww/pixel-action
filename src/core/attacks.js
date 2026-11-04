// 攻击数据与命中盒（纯数据 + 纯几何，可单测）。
// 单位：帧（逻辑固定 60fps）与「世界像素」。纵深方向是 2.5D 车道的 Y。
//
// reach 的校准依据：从精灵表量测每套攻击的**剑尖视觉前伸**（相对锚点）——
//   light1 29px / light2 30px / light3 20px / special 29px（前）·29px（后）/ boss slam 67px
// 判定盒比剑尖略短 1~2px 最"手感正确"：既不会空挥打不到，也不会隔着空气命中。
// special 是横扫，视觉上前伸与后伸都约 29px，所以给它 behind —— 双向判定。

export const COMBO = {
  // 上一段 active 开始后多少帧内再次按攻击，才能接下一段
  chainWindow: 14,
  maxStep: 3,
};

// 蓄力重斩的按住阈值（逻辑帧，60fps）与满蓄上限
export const CHARGE = {
  frames: 24,     // 按住 0.4s 即可松手出重斩
  maxFrames: 54,  // 超过这个帧数不再加成（避免无限等）
};

// 持刀敌人：击杀后掉落飞刀（弓手掉的是弓，不算）
export const BLADE_CARRIERS = new Set([
  'grunt', 'brute', 'boss', 'boss_warden', 'boss_berserker',
]);

export const ATTACKS = {
  // 投掷飞刀：远端消耗型攻击，弥补纯近战在"弓手站桩"局面下的无力
  throw: {
    startup: 6, active: 1, recovery: 12,
    dmg: 20, hitstun: 16, kbX: 0.9, launch: 0,
    reach: 0, halfDepth: 0,        // 无近战判定，靠 projectile
    meterGain: 3, meterCost: 0,
    chainTo: null,
    projectile: { speed: 5.2, life: 120, offsetX: 10, offsetZ: 26, halfDepth: 6 },
  },
  heavy: {
    // 蓄力重斩：长按攻击键 ≥ CHARGE.frames 后松手触发。
    // 设计取舍：前摇短（蓄力已在按住期间消耗时间）、判定宽、伤害高、击退远，
    // 但收招长 —— 打空就要付代价，这是"风险回报"型招式。
    startup: 5, active: 5, recovery: 22,
    dmg: 26, hitstun: 24, kbX: 1.6, launch: 0,
    reach: 38, halfDepth: 20,
    meterGain: 12, meterCost: 0,
    chainTo: null,
  },
  light1: {
    startup: 3, active: 3, recovery: 8,
    dmg: 8, hitstun: 12, kbX: 0.5, launch: 0,
    reach: 27, halfDepth: 14,          // 视觉剑尖 29
    meterGain: 5, meterCost: 0,
    chainTo: 'light2',
  },
  light2: {
    startup: 3, active: 3, recovery: 10,
    dmg: 11, hitstun: 13, kbX: 0.6, launch: 0,
    reach: 28, halfDepth: 14,          // 视觉剑尖 30
    meterGain: 6, meterCost: 0,
    chainTo: 'light3',
  },
  light3: {
    // 上挑：慢、重、把敌人打飞（launch）。剑几乎竖直，前伸只有 20px
    startup: 6, active: 4, recovery: 15,
    dmg: 20, hitstun: 20, kbX: 1.0, launch: 3.2,
    reach: 20, halfDepth: 18,          // 视觉剑尖 20（旧值 28 = 多出 8px 空气判定）
    meterGain: 8, meterCost: 0,
    chainTo: null,
  },
  special: {
    // 能量必杀：横扫，视觉上前后各约 29px → 双向判定
    startup: 10, active: 8, recovery: 20,
    dmg: 42, hitstun: 28, kbX: 1.4, launch: 1.5,
    reach: 30, behind: 28, halfDepth: 26,
    meterGain: 0, meterCost: 100,
    chainTo: null,
    // 地面预警圈：前摇期间显示危险范围（半径 = 判定盒纵深，收缩到 28%）
    telegraph: { radius: 40, color: '#c74bff' },
  },
  charge: {
    // 狂战士 Boss：长距离冲锋，伤害高、击退远，但前摇长（可翻滚躲）
    startup: 14, active: 8, recovery: 22,
    dmg: 26, hitstun: 26, kbX: 2.6, launch: 0,
    reach: 72, halfDepth: 24,
    meterGain: 0, meterCost: 0,
    chainTo: null,
    telegraph: { radius: 30, color: '#ff7a2c' },
  },
  slam: {
    // Boss 专用：长前摇（给玩家反应时间）+ 大范围 + 重击退
    startup: 16, active: 5, recovery: 24,
    dmg: 26, hitstun: 26, kbX: 1.8, launch: 0,
    reach: 62, halfDepth: 28,          // Boss 武器视觉前伸 67
    meterGain: 0, meterCost: 0,
    chainTo: null,
    telegraph: { radius: 36, color: '#ff5a3c' },
  },
  bolt: {
    // 召唤者专用：法杖射出暗影法球。
    // 与弓手的箭区分：更慢（玩家能看清）、更大（判定更宽）、更痛、
    // 且带起手预警圈 —— 法术应该有"仪式感"，而不是像箭一样瞬时飞来。
    startup: 14, active: 2, recovery: 20,
    dmg: 16, hitstun: 22, kbX: 1.1, launch: 0,
    reach: 0, halfDepth: 0,
    meterGain: 0, meterCost: 0,
    chainTo: null,
    // 法球从法杖宝珠位置射出（高于弓心），体积更大所以 halfDepth 更宽
    projectile: {
      speed: 2.6, life: 170, offsetX: 14, offsetZ: 40, halfDepth: 12,
      kind: 'bolt',
    },
    telegraph: { radius: 34, color: '#c74bff' },
  },
  shoot: {
    // 弓手专用：没有近战判定盒，靠 projectile 在 active 帧生成一支箭
    startup: 8, active: 1, recovery: 16,
    dmg: 9, hitstun: 12, kbX: 0.6, launch: 0,
    reach: 0, halfDepth: 0,
    meterGain: 0, meterCost: 0,
    chainTo: null,
    // 箭从**弓中心**出射：弓在身体中心附近（横向 +4px），高度约 38px（脚上方，弓把手位置）
    projectile: { speed: 3.4, life: 150, offsetX: 4, offsetZ: 32, halfDepth: 7 },
  },
};

/** 当前帧是否处于攻击判定窗口（左闭右开，帧是浮点也安全）。 */
export function isActive(def, frame) {
  const f = Math.floor(frame);
  return f >= def.startup && f < def.startup + def.active;
}

/**
 * 攻击命中盒：以角色身体中心为基准，按面朝方向在前方展开。
 * `def.behind` 额外向后展开（横扫类招式，如必杀）。
 * @returns {{x1:number,x2:number,y1:number,y2:number}}
 */
export function hitbox(def, actor) {
  const back = def.behind || 0;
  const x1 = actor.facing > 0 ? actor.x - back : actor.x - def.reach;
  const x2 = actor.facing > 0 ? actor.x + def.reach : actor.x + back;
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


