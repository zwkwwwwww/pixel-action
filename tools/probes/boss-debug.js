// 调试：Boss 战为什么打不到
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(200);
  g.level.spawnedSegments = new Set([0, 1, 2]);
  g.level.segmentIndex = 3;
  g.level.wave = [];
  g.level.gateX = null;
  for (const e of g.world.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  g.world.player.x = 1980;
  g.world.player.y = 41;
  down('ArrowRight'); await wait(700); up('ArrowRight');
  await wait(600);

  const boss = g.world.enemies.find((e) => e.kind === 'boss');
  const log = [];
  for (let i = 0; i < 40; i++) {
    const alive = boss && !boss.dead;
    if (!alive) break;
    const dx = boss.x - g.world.player.x;
    log.push({
      i,
      px: Math.round(g.world.player.x),
      bx: Math.round(boss.x),
      dx: Math.round(dx),
      by: Math.round(boss.y),
      py: Math.round(g.world.player.y),
      pstate: g.world.player.state,
      bstate: boss.state,
      bhp: boss.hp,
      gate: g.level.gateX,
      camLock: g.level.camLockX,
      cam: Math.round(g.camX),
    });
    if (Math.abs(dx) > 20) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(140); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(boss.y - g.world.player.y) > 6) {
      down(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp'); await wait(90); up(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ'); await wait(180);
    }
  }
  return { boss: boss ? { hp: boss.hp, x: Math.round(boss.x), dead: boss.dead } : null, log: log.slice(-12) };
})();
