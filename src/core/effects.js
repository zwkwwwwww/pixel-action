// 打击特效的纯逻辑：伤害数字 + 火花粒子。只维护数据，画由 render/fx.js 负责。
// 所有上限都是硬的——低端机不能因为一次连击把帧率打穿。

export const MAX_PARTICLES = 240;
export const PARTICLE_GRAVITY = 0.34;

export function createEffects() {
  return { numbers: [], particles: [], telegraphs: [] };
}

/**
 * 地面预警圈：Boss 起手时在地面画一个随时间收缩的红圈，前摇结束瞬间爆发。
 * 这是"可读性"设施——玩家必须能在大招落地前看到危险区域。
 * @param {{x:number,y:number,r:number,life:number,color?:string}} cfg
 */
export function spawnTelegraph(fx, cfg) {
  fx.telegraphs.push({
    x: cfg.x,
    y: cfg.y,
    r0: cfg.r,
    r1: cfg.r1 ?? cfg.r * 0.28,
    age: 0,
    life: cfg.life,
    color: cfg.color || '#ff5a3c',
  });
  while (fx.telegraphs.length > 8) fx.telegraphs.shift();
}

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

/** 由一次 hit 事件生成特效。 */
export function spawnHitFx(fx, ev) {
  const strong = ev.launch > 0 || ev.killed;
  fx.numbers.push({
    x: ev.x,
    y: ev.y,
    z: 26,
    vz: 0.95,
    text: String(Math.round(ev.dmg)),
    age: 0,
    life: 46,
    color: strong ? '#ffd166' : '#ffffff',
    scale: strong ? 2 : 1,
    outline: '#0a0d12',
  });

  const count = strong ? 16 : 8;
  for (let i = 0; i < count; i++) {
    fx.particles.push({
      x: ev.x + rnd(-5, 5),
      y: ev.y + rnd(-4, 4),
      z: rnd(10, 26),
      vx: rnd(-1.5, 1.5),
      vz: rnd(0.4, 2.4),
      age: 0,
      life: strong ? rnd(34, 60) : rnd(22, 40),
      color: strong ? (i % 2 ? '#ffd166' : '#ff8a4c') : (i % 2 ? '#ffe9b0' : '#ffb46b'),
      size: strong ? (i % 3 === 0 ? 2 : 1) : 1,
    });
  }
  while (fx.particles.length > MAX_PARTICLES) fx.particles.shift();
}

/** 每个逻辑帧推进一次。 */
export function updateEffects(fx) {
  for (let i = fx.numbers.length - 1; i >= 0; i--) {
    const n = fx.numbers[i];
    n.age++;
    n.z += n.vz;
    n.vz *= 0.94;
    if (n.age >= n.life) fx.numbers.splice(i, 1);
  }
  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.age++;
    p.x += p.vx;
    p.z += p.vz;
    p.vz -= PARTICLE_GRAVITY;
    if (p.z <= 0) {
      p.z = 0;
      p.vz = Math.abs(p.vz) * 0.28;
      p.vx *= 0.7;
    }
    if (p.age >= p.life) fx.particles.splice(i, 1);
  }
  for (let i = fx.telegraphs.length - 1; i >= 0; i--) {
    const t = fx.telegraphs[i];
    t.age++;
    if (t.age >= t.life) fx.telegraphs.splice(i, 1);
  }
}

/** 特效是否需要继续推进（全空时可以跳过更新）。 */
export function isEmpty(fx) {
  return fx.numbers.length === 0 && fx.particles.length === 0 && fx.telegraphs.length === 0;
}
