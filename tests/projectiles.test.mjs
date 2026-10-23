import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step } from '../src/core/world.js';
import { AI_PROFILES, enemyThink } from '../src/core/ai.js';
import { ATTACKS } from '../src/core/attacks.js';

const rangerWorld = (ex = 150, ey = 50) => createWorld({
  player: { x: 100, y: ey, hp: 120, maxHp: 120 },
  enemies: [{
    id: 'r1', x: ex, y: ey, hp: 40, maxHp: 40, kind: 'ranger', facing: -1,
    ai: AI_PROFILES.ranger,
  }],
  enemyThink,
});

test('弓手有远程攻击定义（带 projectile 字段）', () => {
  const shoot = ATTACKS.shoot;
  assert.ok(shoot, '缺少 ATTACKS.shoot');
  assert.ok(shoot.projectile, 'shoot 必须定义 projectile');
  assert.ok(shoot.projectile.speed > 0 && shoot.projectile.life > 0);
  assert.equal(AI_PROFILES.ranger.attack, 'shoot');
});

test('弓手在对射距离内会真的射出箭（生成投射物并产生 shoot 事件）', () => {
  const w = rangerWorld();
  let sawShoot = false;
  for (let i = 0; i < 200; i++) {
    step(w);
    if (w.projectiles.length > 0 || w.events.some((e) => e.type === 'shoot')) { sawShoot = true; break; }
  }
  assert.ok(sawShoot, '200 帧内弓手没有射出任何投射物');
});

test('箭会飞向玩家并造成伤害', () => {
  const w = rangerWorld(200, 50);
  const hp0 = w.player.hp;
  for (let i = 0; i < 300 && w.player.hp === hp0; i++) step(w);
  assert.ok(w.player.hp < hp0, `箭没有命中玩家（hp ${hp0} -> ${w.player.hp}）`);
  const hit = w.events.find((e) => e.type === 'hit');
  assert.ok(hit, '命中必须产生 hit 事件');
});

test('闪避无敌帧可以躲过箭', () => {
  const w = rangerWorld(200, 50);
  for (let i = 0; i < 300; i++) {
    if (w.projectiles.some((p) => Math.abs(p.x - w.player.x) < 40)) {
      w.press('dodge');
      break;
    }
    step(w);
  }
  const hp0 = w.player.hp;
  for (let i = 0; i < 40; i++) step(w);
  assert.equal(w.player.hp, hp0, `无敌帧内仍被箭命中：${hp0} -> ${w.player.hp}`);
});

test('箭不会误伤自己的同伴（只打对侧）', () => {
  const w = createWorld({
    player: { x: 100, y: 50, hp: 120, maxHp: 120 },
    enemies: [
      { id: 'r1', x: 150, y: 50, hp: 40, maxHp: 40, kind: 'ranger', facing: -1, ai: AI_PROFILES.ranger },
      { id: 'g1', x: 150, y: 74, hp: 40, maxHp: 40, kind: 'grunt' },
    ],
    enemyThink,
  });
  for (let i = 0; i < 240; i++) step(w);
  assert.equal(w.enemies[1].hp, 40, '同伴被自己人的箭打到了');
});

test('箭有寿命，飞出屏幕后会消失，不会无限堆积', () => {
  const w = rangerWorld(300, 50);
  for (let i = 0; i < 600; i++) step(w);
  assert.ok(w.projectiles.length < 12, `投射物堆积到 ${w.projectiles.length} 个`);
});

test('弓手贴脸时会后撤而不是站着挨打', () => {
  const w = rangerWorld(108, 50);
  const e = w.enemies[0];
  const d0 = Math.abs(e.x - w.player.x);
  for (let i = 0; i < 60; i++) step(w);
  assert.ok(Math.abs(e.x - w.player.x) >= d0, '射手贴脸时没有拉开距离');
});

test('箭命中后不会重复结算（同一支箭只打一次）', () => {
  const w = rangerWorld(200, 50);
  const hp0 = w.player.hp;
  let firstHitFrame = -1;
  for (let i = 0; i < 300; i++) {
    step(w);
    if (w.player.hp < hp0) { firstHitFrame = i; break; }
  }
  assert.ok(firstHitFrame >= 0, '测试前提：应该已经被箭命中');
  const hpAfter = w.player.hp;
  for (let i = 0; i < 30; i++) step(w);
  // 承伤只允许来自后续新箭；同一支箭不能持续扣血
  assert.ok(w.player.hp >= hpAfter - ATTACKS.shoot.dmg, '同一支箭被重复结算了');
});

test('箭从弓中心（约 38px 高）射出，而不是脚底', () => {
  const w = rangerWorld(200, 50);
  let pr = null;
  for (let i = 0; i < 200 && !pr; i++) {
    step(w);
    if (w.projectiles.length) pr = w.projectiles[0];
  }
  assert.ok(pr, '200 帧内没有射出箭');
  assert.equal(pr.z, ATTACKS.shoot.projectile.offsetZ, '箭的离地高度应等于弓心高度');
  assert.ok(pr.z >= 30 && pr.z <= 46, `弓心高度异常: ${pr.z}`);
  // 横向只比身体中心偏一点点（弓在身体中心附近），不能是从远处凭空出现
  assert.ok(Math.abs(pr.x - 200) <= 12, `出射点离弓手太远: ${Math.abs(pr.x - 200)}`);
});

