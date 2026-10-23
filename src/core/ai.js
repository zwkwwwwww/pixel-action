// 敌人 AI：靠近 → 进入距离 → 出招 → 冷却。全部是确定性的纯逻辑。
import { startAttack, createActor } from './actor.js';
import { WORLD } from './actor.js';

export const AI_PROFILES = {
  grunt: {
    type: 'melee', speed: 0.95, turnSpeed: 1.4,
    range: 26, depthRange: 14, cooldown: 70, attack: 'light1',
  },
  brute: {
    // 重甲：慢、硬、攻击更重
    type: 'melee', speed: 0.52, turnSpeed: 0.9,
    range: 30, depthRange: 16, cooldown: 110, attack: 'light2',
  },
  ranger: {
    // 远程：保持距离，对齐车道后放箭；太近就后撤
    type: 'ranged', speed: 0.72, turnSpeed: 1.0,
    range: 150, minDist: 78, depthRange: 16, cooldown: 96, attack: 'shoot',
  },
  flyer: {
    // 飞行：悬空（近战够不到），之字形逼近后俯冲。必须用飞刀/跳跃攻击处理
    type: 'melee', speed: 0.78, turnSpeed: 1.2,
    range: 30, depthRange: 18, cooldown: 96, attack: 'light1',
  },
  shield: {
    // 盾兵：慢、正面硬（伤害 -80%），必须绕后或蓄力重斩破防
    type: 'melee', speed: 0.62, turnSpeed: 0.8,
    range: 28, depthRange: 15, cooldown: 88, attack: 'light1',
  },
  boss: {
    type: 'melee', speed: 0.8, turnSpeed: 1.1,
    range: 42, depthRange: 22, cooldown: 76, attack: 'slam',
  },
};

function moveToward(e, targetX, targetY, speed, depthScale = 0.65) {
  const dx = targetX - e.x;
  const dy = targetY - e.y;
  const len = Math.hypot(dx, dy) || 1;
  e.x += (dx / len) * speed;
  e.y += (dy / len) * speed * depthScale;
  e.y = Math.max(0, Math.min(WORLD.DEPTH_MAX, e.y));
}

export function enemyThink(world) {
  const p = world.player;
  if (p.dead) return;
  for (const e of world.enemies) {
    if (e.dead) continue;
    if (e.aiTimer > 0) e.aiTimer--;
    if (e.state !== 'idle') continue; // 出招/受击/倒地期间不思考

    const prof = e.ai || AI_PROFILES[e.kind] || AI_PROFILES.grunt;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const adx = Math.abs(dx);
    e.facing = dx >= 0 ? 1 : -1;

    if (prof.type === 'ranged') {
      // 射程内（且车道对齐）就一直举着弓：不放下，只在冷却结束时放箭
      e.aiming = adx >= prof.minDist && adx <= prof.range && Math.abs(dy) <= prof.depthRange;
      if (adx < prof.minDist) {
        moveToward(e, e.x - Math.sign(dx) * 40, p.y, prof.speed, 0.5); // 后撤
      } else if (adx > prof.range) {
        moveToward(e, p.x, p.y, prof.speed, 0.6);
      } else if (Math.abs(dy) > prof.depthRange) {
        // 车道没对齐：先走到玩家那条车道，否则箭会擦身而过
        moveToward(e, e.x, p.y, prof.speed, 1.0);
      } else if (e.aiTimer <= 0) {
        // 对空预判：玩家在空中时，弓手等一小段再射，让箭更可能撞上落点
        const playerAir = (p.z || 0) > 8;
        if (playerAir && (e.airShotDelay || 0) < 12) {
          e.airShotDelay = (e.airShotDelay || 0) + 1;
        } else {
          e.airShotDelay = 0;
          startAttack(e, prof.attack);
          e.aiTimer = prof.cooldown;
        }
      }
      continue;
    }

    // ——— Boss 阶段系统 ———
    // phases: [{ at: 0.6, speed: 1.4, cooldown: 0.6, attacks: [...], summon: 2 }]
    // 血量跨过 at 时切到该阶段；同一次跨过只触发一次（e.phase 记录已到阶段数）。
    const hpRatio = e.hp / e.maxHp;
    if (e.phases && e.phases.length) {
      let target = 0;
      for (let i = 0; i < e.phases.length; i++) {
        if (hpRatio <= e.phases[i].at) target = i + 1;
      }
      if (target > (e.phase || 0)) {
        e.phase = target;
        const ph = e.phases[target - 1];
        // 进场一次性事件：召唤援军 / 播报阶段
        if (ph.summon) {
          for (let i = 0; i < ph.summon; i++) {
            const add = createActor({
              side: 'enemy', kind: ph.summonKind || 'grunt',
              x: e.x + (i % 2 ? 26 : -26), y: e.y,
              hp: 30, maxHp: 30, ai: AI_PROFILES.grunt,
            });
            world.enemies.push(add);
            world.actors.push(add);
          }
        }
        world.events.push({ type: 'bossPhase', uid: e.uid, phase: target, x: e.x, y: e.y });
      }
    }
    // 当前阶段的数值修正（没配 phases 时回退到老的 enrageAt 行为）
    const phase = e.phases && e.phases.length ? e.phases[Math.max(0, (e.phase || 1) - 1)] : null;
    const enraged = phase ? false : (!!e.enrageAt && hpRatio <= e.enrageAt);
    const speedMul = phase ? (phase.speed || 1) : (enraged ? 1.4 : 1);
    const cdMul = phase ? (phase.cooldown || 1) : (enraged ? 0.6 : 1);
    const speed = prof.speed * speedMul;
    const cooldown = Math.round(prof.cooldown * cdMul);

    // 飞行单位：维持悬停高度（用正弦做轻微上下浮动，读起来像在飞）
    if (e.flyer) {
      e.hoverT = (e.hoverT || 0) + 1;
      e.z = 34 + Math.sin(e.hoverT * 0.08) * 6;
    }

    const inRange = adx <= prof.range && Math.abs(dy) <= prof.depthRange;
    // 玩家在头顶（跳跃/浮空）时，近战空挥毫无意义：
    // 走到玩家落点下方等，落地瞬间正好在攻击距离内 —— 逼玩家算好滞空时间
    const playerAirborne = (p.z || 0) > 8;
    if (playerAirborne && prof.type !== 'ranged') {
      moveToward(e, p.x, p.y, speed * 0.9, 0.8);
      continue;
    }
    if (!inRange) {
      moveToward(e, p.x, p.y, speed, 0.65);
    } else if (e.aiTimer <= 0) {
      // Boss 变招：每关 Boss 带一套 attacks 列表，按顺序轮转（slam / 横扫 / 范围技）
      const list = (phase && phase.attacks) || e.attacks || prof.attacks || [prof.attack];
      e.alt = ((e.alt || 0) + 1) % list.length;
      startAttack(e, list[e.alt]);
      e.aiTimer = cooldown;
    }
  }
}


