// Boss 取证：把玩家推进到 Boss 触发点，验证 Boss 出场、体型、横扫攻击与受伤。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(150);

  // 直接推进到 Boss 触发点（跳过前两波，聚焦 Boss 表现）
  g.world.player.x = 1980;
  g.world.player.y = 41;
  down('ArrowRight'); await wait(600); up('ArrowRight');
  await wait(700);

  const boss = g.world.enemies.find((e) => e.kind === 'boss');
  const spawnInfo = boss ? { hp: boss.hp, x: Math.round(boss.x), w: boss.bodyHalfW, state: boss.state } : null;

  // 靠近 Boss 并攻击 3 次，看是否真的能打掉血
  const hp0 = boss ? boss.hp : null;
  for (let i = 0; i < 12 && boss && !boss.dead; i++) {
    const dx = boss.x - g.world.player.x;
    if (Math.abs(dx) > 24) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(120); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(boss.y - g.world.player.y) > 6) {
      down(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp'); await wait(90); up(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ'); await wait(220);
    }
  }

  return {
    bossSpawned: g.level.bossSpawned,
    spawnInfo,
    bossHpAfter: boss ? boss.hp : null,
    bossDamaged: boss ? hp0 - boss.hp : 0,
    bossState: boss ? boss.state : null,
    bossDrawingSprite: !!(g.art.loaded || []).includes('boss'),
    bgm: g.audioNow().bgm,
    playerHp: g.world.player.hp,
    cameraX: Math.round(g.camX),
  };
})();
