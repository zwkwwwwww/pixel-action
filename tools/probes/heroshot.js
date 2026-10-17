// 宣传级截图：跳到第 2 波（3 个敌人），打两下但保留敌人存活，截图时画面里同时有主角/多个敌人/特效。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(400);

  // 清掉第 1 波，进第 2 波（不杀，保留在画面里）
  g.level.spawnedSegments = new Set([0]);
  g.level.segmentIndex = 1;
  g.level.wave = [];
  g.level.gateX = null;
  for (const e of g.world.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  g.world.player.x = 830;
  g.world.player.y = 41;
  await wait(500);

  // 靠近最近的敌人并打两下
  for (let i = 0; i < 10; i++) {
    const alive = g.world.enemies.filter((e) => !e.dead);
    if (alive.length <= 1) break;
    const near = alive.reduce((a, b) => (Math.abs(a.x - g.world.player.x) <= Math.abs(b.x - g.world.player.x) ? a : b));
    const dx = near.x - g.world.player.x;
    if (Math.abs(dx) > 26) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(90); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ'); await wait(160);
    }
  }
  // 等一帧让特效处于存活状态再截图
  down('KeyJ'); await wait(26); up('KeyJ');
  await wait(90);

  return {
    aliveEnemies: g.world.enemies.filter((e) => !e.dead).length,
    particles: g.fx.particles.length,
    numbers: g.fx.numbers.length,
    hp: Math.round(g.world.player.hp),
    segmentIndex: g.level.segmentIndex,
    artLoaded: g.art.loaded,
  };
})();
