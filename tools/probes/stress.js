// 压力取证：把粒子堆到硬上限 240，测帧内绘制耗时（上限 8ms）。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(300);

  // 把粒子灌到上限（模拟满屏命中火花），并持续补充以维持压力
  const cap = 240;
  const f0 = g.perf.frames;
  const t0 = performance.now();
  for (let round = 0; round < 12; round++) {
    while (g.fx.particles.length < cap) {
      g.fx.particles.push({
        x: g.world.player.x + (Math.random() - 0.5) * 300,
        y: 20 + Math.random() * 60,
        z: Math.random() * 50,
        vx: (Math.random() - 0.5) * 3,
        vz: Math.random() * 2,
        age: 0,
        life: 100000,
        color: '#ffd166',
        size: 1,
      });
    }
    for (let i = 0; i < 25; i++) {
      g.fx.numbers.push({
        x: g.world.player.x + (Math.random() - 0.5) * 300, y: 20 + Math.random() * 60, z: 20,
        vz: 1, text: '99', age: 0, life: 100000, color: '#fff', scale: 1, outline: '#000',
      });
    }
    await wait(80);
  }
  const frames = g.perf.frames - f0;
  const elapsed = performance.now() - t0;
  const pf = g.perf;

  return {
    particles: g.fx.particles.length,
    numbers: g.fx.numbers.length,
    framesMeasured: frames,
    fps: Math.round((frames / elapsed) * 10000) / 10,
    avgLogicMs: Math.round((pf.logic / pf.frames) * 1000) / 1000,
    avgDrawMs: Math.round((pf.draw / pf.frames) * 1000) / 1000,
    maxDrawMs: Math.round(pf.drawMax * 100) / 100,
    underBudget: pf.draw / pf.frames < 8,
  };
})();
