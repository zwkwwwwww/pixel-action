// 音频+BGM 取证：走到敌人附近打几下，确认 BGM 真的在播、命中音也触发。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(800);

  // 走到第一波
  down('ArrowRight');
  for (let i = 0; i < 60 && g.world.enemies.length === 0; i++) await wait(50);
  up('ArrowRight');
  await wait(200);

  // 打几下
  for (let i = 0; i < 26; i++) {
    const alive = g.world.enemies.filter((e) => !e.dead);
    if (!alive.length) break;
    const near = alive.reduce((a, b) => (Math.abs(a.x - g.world.player.x) <= Math.abs(b.x - g.world.player.x) ? a : b));
    const dx = near.x - g.world.player.x;
    const dy = near.y - g.world.player.y;
    if (Math.abs(dx) > 20) {
      down(dx > 0 ? "ArrowRight" : "ArrowLeft"); await wait(150); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(dy) > 6) {
      down(dy > 0 ? 'ArrowDown' : 'ArrowUp'); await wait(60); up(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ'); await wait(220);
    }
  }
  await wait(300);

  const a = g.audioNow();
  return {
    ctxState: a.ctxState,
    loaded: a.loaded,
    failed: a.failed,
    bgm: a.bgm,
    playedUnique: a.played,
    playedCount: a.playedCount,
    killed: g.world.enemies.filter((e) => e.dead).length,
  };
})();
