// 性能取证：进入游戏后制造高负载（多敌人 + 粒子），统计帧内逻辑/绘制耗时。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(200);

  // 直接推进到第二波（敌人更多），再连续攻击制造粒子
  g.world.player.x = 790;
  await wait(400);

  const t0 = performance.now();
  const f0 = g.perf.frames;
  for (let i = 0; i < 40; i++) {
    down('KeyJ'); await wait(26); up('KeyJ');
    await wait(90);
  }
  const elapsed = performance.now() - t0;
  const frames = g.perf.frames - f0;
  const pf = g.perf;

  // 峰值粒子数
  let peakParticles = 0;
  for (let i = 0; i < 30; i++) {
    peakParticles = Math.max(peakParticles, g.fx.particles.length);
    await wait(30);
  }

  return {
    framesMeasured: frames,
    totalLogicMs: Math.round(pf.logic * 10) / 10,
    totalDrawMs: Math.round(pf.draw * 10) / 10,
    avgLogicMs: Math.round((pf.logic / pf.frames) * 1000) / 1000,
    avgDrawMs: Math.round((pf.draw / pf.frames) * 1000) / 1000,
    maxLogicMs: Math.round(pf.logicMax * 100) / 100,
    maxDrawMs: Math.round(pf.drawMax * 100) / 100,
    fps: Math.round((frames / elapsed) * 10000) / 10,
    peakParticles,
    enemies: g.world.enemies.filter((e) => !e.dead).length,
    particlesCapHonored: g.fx.particles.length <= 240,
  };
})();
