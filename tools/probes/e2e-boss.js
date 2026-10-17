// Boss 取证：把玩家推进到 Boss 触发点，验证 Boss 出场、体型、横扫攻击与受伤。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(150);

  // 跳过前两波（这是「Boss 表现」专项取证，不是完整通关取证）：
  // 直接把关卡推进到 Boss 段，避免传送到一半被波次闸门夹回来。
  g.level.spawnedSegments = new Set([0, 1, 2]);
  g.level.segmentIndex = 3;
  g.level.wave = [];
  g.level.gateX = null;
  for (const e of g.world.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  g.world.player.x = 1980;
  g.world.player.y = 41;
  down('ArrowRight'); await wait(700); up('ArrowRight');
  await wait(900);

  const boss = g.world.enemies.find((e) => e.kind === 'boss');
  const spawnInfo = boss ? { hp: boss.hp, x: Math.round(boss.x), w: boss.bodyHalfW, state: boss.state } : null;

  // 靠近 Boss 并攻击，统计真实命中
  const hp0 = boss ? boss.hp : null;
  let attacks = 0;
  let minDx = 999;
  let playerXEnd = g.world.player.x;
  for (let i = 0; i < 40 && boss && !boss.dead; i++) {
    const dx = boss.x - g.world.player.x;
    minDx = Math.min(minDx, Math.abs(dx));
    playerXEnd = g.world.player.x;
    if (Math.abs(dx) > 20) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(140); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(boss.y - g.world.player.y) > 6) {
      down(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp'); await wait(90); up(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ');
      attacks++;
      await wait(180);
    }
  }

  return {
    bossSpawned: g.level.bossSpawned,
    spawnInfo,
    bossHpAfter: boss ? boss.hp : null,
    bossDamaged: boss ? hp0 - boss.hp : 0,
    bossState: boss ? boss.state : null,
    attacks,
    minDx: Math.round(minDx),
    playerXEnd: Math.round(playerXEnd),
    bossXEnd: boss ? Math.round(boss.x) : null,
    bossDrawingSprite: !!(g.art.loaded || []).includes('boss'),
    bgm: g.audioNow().bgm,
    playerHp: g.world.player.hp,
    cameraX: Math.round(g.camX),
  };
})();
