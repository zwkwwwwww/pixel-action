// 战斗世界：角色集合、输入意图、命中结算、命中停顿、事件流。
// 这是「动作游戏手感」的唯一事实来源，渲染层只读它。
import { ATTACKS, COMBO, isActive, hitbox, overlaps } from './attacks.js';
import {
  WORLD, createActor, canAct, startAttack, startDodge, bodyBox, updateActor,
} from './actor.js';
import { InputBuffer } from './input.js';

export { WORLD };

export function createWorld({ player, enemies = [], enemyThink = null } = {}) {
  const p = createActor({ side: 'player', hp: 120, maxHp: 120, ...player, side: 'player' });
  const es = enemies.map((e) => createActor({ ...e, side: 'enemy' }));
  const world = {
    frame: 0,
    hitstop: 0,
    buffer: new InputBuffer(8),
    dir: { x: 0, y: 0 },
    player: p,
    enemies: es,
    actors: [p, ...es],
    projectiles: [],
    events: [],
    enemyThink,
    _hitstopApplied: 0,
  };
  // 便捷方法（让调用方与测试都有一致的入口）
  world.press = (action) => press(world, action);
  world.forceAttack = (actor, attackId) => forceAttack(world, actor, attackId);
  world.consumeEvents = () => consumeEvents(world);
  return world;
}

/** 记录一次动作输入。攻击键在连段窗口内会直接排队下一段。 */
export function press(world, action) {
  const p = world.player;
  if (action === 'attack' && p.state === 'attack' && p.attack) {
    const def = ATTACKS[p.attack];
    if (def.chainTo && p.stateFrame >= def.startup && p.stateFrame <= def.startup + COMBO.chainWindow) {
      p.queued = def.chainTo;
      return;
    }
  }
  world.buffer.press(action, world.frame);
}

/** 测试/剧情用：绕过输入直接让某角色出招。 */
export function forceAttack(world, actor, attackId) {
  startAttack(actor, attackId);
}

function handleIntent(world) {
  const p = world.player;
  if (!canAct(p)) return;
  const dir = world.dir || { x: 0, y: 0 };

  // 方向移动（走路是自由状态，不受状态机切换）
  if (dir.x !== 0) p.facing = dir.x;
  p.x += dir.x * p.speedX;
  p.y = Math.max(0, Math.min(WORLD.DEPTH_MAX, p.y + dir.y * p.speedY));

  if (world.buffer.consume('dodge', world.frame, 6)) {
    startDodge(p, dir);
    return;
  }
  if (p.meter >= ATTACKS.special.meterCost && world.buffer.consume('special', world.frame, 6)) {
    p.meter -= ATTACKS.special.meterCost;
    startAttack(p, 'special');
    return;
  }
  if (world.buffer.consume('attack', world.frame, 6)) startAttack(p, 'light1');
}

function resolveHits(world) {
  for (const a of world.actors) {
    if (a.state !== 'attack' || !a.attack) continue;
    const def = ATTACKS[a.attack];
    if (!def.reach) continue; // 纯投射物招式没有近战判定盒
    if (!isActive(def, a.stateFrame)) continue;
    const box = hitbox(def, a);
    for (const b of world.actors) {
      if (b === a || b.side === a.side || b.dead) continue;
      if (a.hitTargets.has(b.uid)) continue;
      if (b.invuln > 0) continue;
      if (!overlaps(box, bodyBox(b))) continue;
      applyHit(world, a, b, def);
    }
  }
}

function applyHit(world, attacker, target, def, opts = {}) {
  // 投射物没有 hitTargets（它命中也只结算一次就销毁），这里容忍缺省
  if (attacker.hitTargets) attacker.hitTargets.add(target.uid);
  target.hp -= def.dmg;
  target.hurtTime = def.hitstun;
  target.stateFrame = 0;
  target.vx = def.kbX * attacker.facing;
  target.vy = 0;

  if (def.launch > 0) {
    target.state = 'launched';
    target.z = 0.01;
    target.vz = def.launch;
  } else {
    target.state = 'hurt';
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.dead = true;
    target.state = 'dead';
    target.stateFrame = 0;
    target.vz = 0;
    target.z = 0;
    target.vx = 0;
  }

  if (attacker.side === 'player') {
    attacker.meter = Math.min(WORLD.MAX_METER, attacker.meter + (def.meterGain || 0));
  }
  // 命中停顿：只冻结模拟，不冻结玩家输入（输入照常进缓冲）
  world.hitstop = Math.min(10, Math.max(world.hitstop, 6));

  world.events.push({
    type: 'hit',
    attacker: attacker.uid,
    uid: target.uid,
    attack: attacker.attack,
    dmg: def.dmg,
    x: target.x,
    y: target.y,
    z: target.z,
    launch: def.launch,
    killed: target.dead,
    meter: attacker.meter,
    ...opts,
  });
}

// ——— 投射物（弓手的箭）———
// 箭是独立实体：生成后自己飞、自己判碰撞，不占用角色的命中盒与 hitTargets。
let projSeq = 0;

function spawnProjectiles(world) {
  for (const a of world.actors) {
    if (a.state !== 'attack' || !a.attack) continue;
    const def = ATTACKS[a.attack];
    if (!def.projectile || a.shotFired) continue;
    if (!isActive(def, a.stateFrame)) continue;
    a.shotFired = true;
    const pr = def.projectile;
    world.projectiles.push({
      uid: `p${++projSeq}`,
      ownerUid: a.uid,
      side: a.side,
      x: a.x + a.facing * (pr.offsetX ?? 12),
      y: a.y,
      vx: a.facing * pr.speed,
      dmg: def.dmg,
      hitstun: def.hitstun,
      halfDepth: pr.halfDepth ?? 7,
      age: 0,
      life: pr.life,
      attack: a.attack,
    });
    world.events.push({
      type: 'shoot', uid: a.uid, x: a.x, y: a.y, side: a.side, facing: a.facing,
    });
  }
}

function updateProjectiles(world) {
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const pr = world.projectiles[i];
    pr.age++;
    pr.x += pr.vx;
    if (pr.age >= pr.life || pr.x < -48 || pr.x > 3248) {
      world.projectiles.splice(i, 1);
      continue;
    }
    const box = {
      x1: pr.x - 6, x2: pr.x + 6,
      y1: pr.y - pr.halfDepth, y2: pr.y + pr.halfDepth,
    };
    let hit = false;
    for (const t of world.actors) {
      if (t.side === pr.side || t.dead || t.invuln > 0) continue;
      if (!overlaps(box, bodyBox(t))) continue;
      applyHit(
        world,
        { uid: pr.ownerUid, side: pr.side, facing: Math.sign(pr.vx) || 1, meter: 0, attack: pr.attack },
        t,
        { dmg: pr.dmg, hitstun: pr.hitstun, kbX: 0.6, launch: 0, meterGain: 0 },
        { ranged: true, projectile: pr.uid },
      );
      hit = true;
      break;
    }
    if (hit) world.projectiles.splice(i, 1);
  }
}

/** 推进一个逻辑帧（固定 60fps）。 */
export function step(world) {
  world.frame++;
  if (world.hitstop > 0) {
    world.hitstop--;
    world.buffer.tick(world.frame);
    return;
  }
  handleIntent(world);
  if (world.enemyThink) world.enemyThink(world);
  for (const a of world.actors) updateActor(a);
  spawnProjectiles(world);
  updateProjectiles(world);
  resolveHits(world);
  world.buffer.tick(world.frame);

  if (world.events.length > 200) world.events.splice(0, world.events.length - 200);
}

/** 渲染/音频层取走事件（取走即清空，避免重复播放）。 */
export function consumeEvents(world) {
  const out = world.events;
  world.events = [];
  return out;
}
