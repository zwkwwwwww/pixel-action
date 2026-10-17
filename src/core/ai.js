// 敌人 AI：靠近 → 进入距离 → 出招 → 冷却。全部是确定性的纯逻辑。
import { startAttack } from './actor.js';
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
    // 远程：保持距离，太近就后撤
    type: 'ranged', speed: 0.72, turnSpeed: 1.0,
    range: 130, minDist: 74, depthRange: 18, cooldown: 120, attack: 'light1',
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
      if (adx < prof.minDist) {
        moveToward(e, e.x - Math.sign(dx) * 40, p.y, prof.speed, 0.5); // 后撤
      } else if (adx > prof.range) {
        moveToward(e, p.x, p.y, prof.speed, 0.6);
      } else if (e.aiTimer <= 0) {
        startAttack(e, prof.attack);
        e.aiTimer = prof.cooldown;
      }
      continue;
    }

    const inRange = adx <= prof.range && Math.abs(dy) <= prof.depthRange;
    if (!inRange) {
      moveToward(e, p.x, p.y, prof.speed, 0.65);
    } else if (e.aiTimer <= 0) {
      startAttack(e, prof.attack);
      e.aiTimer = prof.cooldown;
    }
  }
}
