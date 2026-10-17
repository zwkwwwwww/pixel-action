// 特效取证：真实操作打出连击，在粒子/飘字存活时截一帧并报告计数。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  // 标题画面：先 Enter 进游戏
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter', bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));

  // 走到第一波
  down('ArrowRight');
  for (let i = 0; i < 80 && g.world.enemies.length === 0; i++) await wait(50);
  up('ArrowRight');
  await wait(100);

  // 靠近并攻击，连按三下
  let peak = { numbers: 0, particles: 0 };
  for (let round = 0; round < 40; round++) {
    const alive = g.world.enemies.filter((e) => !e.dead);
    if (!alive.length) break;
    const near = alive.reduce((a, b) => (Math.abs(a.x - g.world.player.x) <= Math.abs(b.x - g.world.player.x) ? a : b));
    const dx = near.x - g.world.player.x;
    const dy = near.y - g.world.player.y;
    if (Math.abs(dx) > 18) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(50); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(dy) > 5) {
      down(dy > 0 ? 'ArrowDown' : 'ArrowUp'); await wait(45); up(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ'); await wait(28); up('KeyJ');
      await wait(120);
      peak.numbers = Math.max(peak.numbers, g.fx.numbers.length);
      peak.particles = Math.max(peak.particles, g.fx.particles.length);
    }
  }
  return {
    peakNumbers: peak.numbers,
    peakParticles: peak.particles,
    nowNumbers: g.fx.numbers.length,
    nowParticles: g.fx.particles.length,
    killed: g.world.enemies.filter((e) => e.dead).length,
    hp: g.world.player.hp,
    meter: g.world.player.meter,
  };
})();
