// 端到端：标题 → Enter → 清掉第 1 波 → 进入第 2 波。验证「真实按键能推进关卡」。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  const titleMode = g.mode;
  down('Enter'); up('Enter');
  await wait(200);
  const afterEnter = g.mode;

  const t0 = Date.now();
  let peakEnemies = 0;
  let peakSprites = 0;

  while (Date.now() - t0 < 90000) {
    const w = g.world;
    const alive = w.enemies.filter((e) => !e.dead);
    peakEnemies = Math.max(peakEnemies, alive.length);
    peakSprites = Math.max(peakSprites, g.art.drawnSprites);
    if (g.level.segmentIndex >= 1) break;
    if (alive.length === 0) {
      down('ArrowRight'); await wait(120); up('ArrowRight');
      continue;
    }
    const near = alive.reduce((a, b) => (Math.abs(a.x - w.player.x) <= Math.abs(b.x - w.player.x) ? a : b));
    const dx = near.x - w.player.x;
    const dy = near.y - w.player.y;
    if (Math.abs(dx) > 20) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(70); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(dy) > 6) {
      down(dy > 0 ? 'ArrowDown' : 'ArrowUp'); await wait(60); up(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ'); await wait(110);
    }
    await wait(30);
  }

  return {
    titleMode,
    afterEnter,
    segmentIndex: g.level.segmentIndex,
    gateX: g.level.gateX,
    killed: g.world.enemies.filter((e) => e.dead).length,
    enemiesTotal: g.world.enemies.length,
    peakEnemies,
    peakSprites,
    playerHp: g.world.player.hp,
    meter: g.world.player.meter,
    artLoaded: g.art.loaded,
    artMissing: g.art.missing,
    audio: g.audioNow(),
    elapsedMs: Date.now() - t0,
  };
})();
