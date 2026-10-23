// 战斗世界：角色集合、输入意图、命中结算、命中停顿、事件流。
// 这是「动作游戏手感」的唯一事实来源，渲染层只读它。
import { ATTACKS, COMBO, BLADE_CARRIERS, isActive, hitbox, overlaps } from './attacks.js';
import {
  WORLD, createActor, canAct, startAttack, startDodge, startJump, bodyBox, updateActor,
} from './actor.js';
import { InputBuffer } from './input.js';

// 飞刀弹药上限（拾取不会超过这个数）
const AMMO_MAX = 9;

export { WORLD };

export function createWorld({ player, enemies = [], enemyThink = null } = {}) {
  const p = createActor({ side: 'player', hp: 240, maxHp: 240, ...player, side: 'player' });
  // createActor 只认白名单字段，玩家专属资源要在生成后补挂
  p.ammo = player.ammo ?? 5;
  const es = enemies.map((e) => {
    const a = createActor({ ...e, side: 'enemy' });
    // createActor 只认白名单字段：Boss 的机制参数要在这里补挂，否则 AI 读不到
    if (e.phases) { a.phases = e.phases; a.phase = e.phase || 0; }
    if (e.attacks) a.attacks = e.attacks;
    if (e.summonAt != null) a.summonAt = e.summonAt;
    if (e.enrageAt != null) a.enrageAt = e.enrageAt;
    if (e.kind === 'shield' || e.shield) a.shield = true;
    // 飞行单位：悬空，近战够不到
    if (e.kind === 'flyer' || e.flyer) { a.flyer = true; a.z = 34; }
    return a;
  });
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
  // 闪避取消（新技能）：闪避中按攻击 → 立刻取消闪避并接上挑
  if (p.state === 'dodge' && p.stateFrame >= 4 && world.buffer.consume('attack', world.frame, 6)) {
    p.state = 'idle';
    p.stateFrame = 0;
    p.invuln = 0;
    startAttack(p, 'light3');
    return;
  }
  // 后摇取消（灵活性核心）：攻击判定结束后（recovery 段）按闪避 → 立刻翻滚打断
  if (p.state === 'attack' && p.attack) {
    const def = ATTACKS[p.attack];
    const activeEnd = def.startup + def.active;
    if (p.stateFrame >= activeEnd && world.buffer.consume('dodge', world.frame, 6)) {
      p.state = 'idle';
      p.stateFrame = 0;
      p.attack = null;
      p.hitTargets.clear();
      startDodge(p, world.dir || { x: 0, y: 0 });
      return;
    }
  }
  if (!canAct(p)) return;
  const dir = world.dir || { x: 0, y: 0 };
  const airborne = p.state === 'jump' || p.z > 0.5;

  // 方向移动：地面全速，空中打折（airControl），保留跳跃中的微调
  if (dir.x !== 0) p.facing = dir.x;
  const moveScale = airborne ? WORLD.JUMP.airControl : 1;
  p.x += dir.x * p.speedX * moveScale;
  p.y = Math.max(0, Math.min(WORLD.DEPTH_MAX, p.y + dir.y * p.speedY * moveScale));

  // 跳跃 / 二段跳。放在闪避之后、攻击之前：跳起来还能马上出招
  if (world.buffer.consume('jump', world.frame, 6)) {
    startJump(p, dir);
  }

  // 远程道具：有弹药才能投；投完就不能再扔
  if (world.buffer.consume('throw', world.frame, 6) && (p.ammo ?? 0) > 0) {
    p.ammo = (p.ammo ?? 0) - 1;
    startAttack(p, 'throw');
    return;
  }
  if (world.buffer.consume('dodge', world.frame, 6)) {
    startDodge(p, dir);
    return;
  }
  // 蓄力重斩：按住攻击键够久后松手（窗口给 12 帧余量，松手晚一点也能吃到）
  if (world.buffer.consume('heavy', world.frame, 12)) {
    startAttack(p, 'heavy');
    return;
  }
  if (p.meter >= ATTACKS.special.meterCost && world.buffer.consume('special', world.frame, 6)) {
    p.meter -= ATTACKS.special.meterCost;
    startAttack(p, 'special');
    return;
  }
  if (world.buffer.consume('attack', world.frame, 6)) startAttack(p, 'light1');
}

/**
 * Boss 起手预警：把带 telegraph 配置的招式，在起手帧推一条事件给渲染层。
 * 只在敌人（side === 'enemy'）上生效——玩家自己的必杀不需要"敌人预警圈"。
 */
function emitTelegraphs(world) {
  for (const a of world.actors) {
    if (!a.justAttacked) continue;
    const attackId = a.justAttacked;
    a.justAttacked = null;
    if (a.side !== 'enemy') continue;
    const def = ATTACKS[attackId];
    if (!def || !def.telegraph) continue;
    const t = def.telegraph;
    world.events.push({
      type: 'telegraph',
      uid: a.uid,
      x: a.x + a.facing * (def.reach * 0.45),
      y: a.y,
      radius: t.radius,
      color: t.color,
      life: def.startup,
    });
  }
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
      // 高度判定：飞行单位悬在高空，地面攻击够不到；
      // 玩家跳起来（z 升高）或用飞刀才能打到 —— 逼玩家用立体的打法
      if (b.flyer) {
        const reachZ = (a.z || 0) + 34;      // 近战有效高度
        if ((b.z || 0) > reachZ) continue;
      }
      applyHit(world, a, b, def);
    }
  }
}

function applyHit(world, attacker, target, def, opts = {}) {
  // 投射物没有 hitTargets（它命中也只结算一次就销毁），这里容忍缺省
  if (attacker.hitTargets) attacker.hitTargets.add(target.uid);
  // 空中追打：打中浮空中的敌人（launched）算"空连"，给额外能量并在事件里标记。
  // 判定盒本身不看 z，所以地面攻击天然能摸到空中的敌人——这里只补奖励与反馈。
  const airHit = target.state === 'launched' && target.z > 6;

  // ——— 盾兵格挡 ———
  // 玩家从**正面**打盾兵会被挡住（伤害 -80%），必须绕后或蓄力重斩破防。
  // 判定：攻击者站在目标面朝的一侧 = 正面。重斩（heavy）和必杀（special）无视盾牌。
  let blocked = false;
  if (target.shield && !target.dead) {
    const fromFront = Math.sign(attacker.x - target.x) === target.facing;
    const breaksGuard = def.dmg >= 20 || def.launch > 0;
    // 破防：正面吃重击/上挑 → 盾牌被打开，进入 guardBreak 窗口
    // （期间不再格挡，也不会立刻举盾），持续 90 帧 ≈ 1.5s，够打完一轮连段
    if (target.guardBreak > 0) {
      blocked = false;
    } else if (fromFront && breaksGuard) {
      blocked = false;
      target.guardBreak = 90;
      world.events.push({
        type: 'guardBreak', uid: target.uid, x: target.x, y: target.y,
      });
    } else if (fromFront) {
      blocked = true;
    }
  }
  const appliedDmg = blocked ? Math.max(1, Math.round(def.dmg * 0.2)) : def.dmg;
  target.hp -= appliedDmg;
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
    // 空连额外回能：奖励"把敌人挑起来继续打"
    if (airHit) {
      attacker.meter = Math.min(WORLD.MAX_METER, attacker.meter + 4);
      // 空中追打不落地，保持浮空节奏（轻微上顶）
      target.vz = Math.max(target.vz, 1.6);
    }
  }
  // 击杀掉落：持刀敌人死后掉一把飞刀，形成「打->补弹」的资源循环
  if (target.dead && attacker.side === 'player' && BLADE_CARRIERS.has(target.kind)) {
    attacker.ammo = Math.min(AMMO_MAX, (attacker.ammo ?? 0) + 1);
    world.events.push({ type: 'pickup', uid: attacker.uid, x: target.x, y: target.y, ammo: attacker.ammo });
  }

  // 命中停顿：只冻结模拟，不冻结玩家输入（输入照常进缓冲）
  // 命中停顿按伤害分级：轻击 6 帧、重斩/击杀 10 帧、Boss 大招 12 帧。
  // 固定值会让所有命中"手感一样重"，分级之后轻重招才有区分度。
  const stopFrames = target.dead ? 10 : Math.min(12, 5 + Math.round(def.dmg / 6));
  world.hitstop = Math.min(12, Math.max(world.hitstop, stopFrames));

  world.events.push({
    type: 'hit',
    attacker: attacker.uid,
    uid: target.uid,
    attack: attacker.attack,
    attackerSide: attacker.side,
    targetSide: target.side,
    targetKind: target.kind,
    dmg: appliedDmg,
    blocked,
    // 玩家挨打时，攻击者是否来自背后（用于更强的受击反馈）
    // 玩家朝右(facing=1)时，攻击者在左边(x 更小) → 来自背后。
    // 即 sign(attacker - target) === -target.facing
    fromBehind: target.side === 'player'
      ? Math.sign(attacker.x - target.x) === -target.facing
      : false,
    x: target.x,
    y: target.y,
    z: target.z,
    airHit,
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
      z: pr.offsetZ ?? 0,   // 离地高度：箭从弓心（约 38px）射出，而不是脚底
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
      // 投射物不受高度限制：飞刀/箭能打到空中的飞行单位
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
  emitTelegraphs(world);
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
