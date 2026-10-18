// 验收：三波开波瞬间镜头是否零位移、边界是否就是当前屏幕右缘。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(300);

  const samples = [];
  const triggers = [];
  let lastLock = null;
  const timer = setInterval(() => {
    const lock = g.level.camLockX;
    samples.push({ cam: g.camX, px: g.world.player.x, lock });
    if (lock != null && lastLock == null) triggers.push(samples.length - 1);
    lastLock = lock;
  }, 16);

  for (let wave = 0; wave < 3; wave++) {
    down('ArrowRight');
    const t0 = Date.now();
    while (g.level.camLockX == null && Date.now() - t0 < 6000) await wait(25);
    await wait(500);
    up('ArrowRight');
    for (const e of g.world.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
    await wait(450); // 等清波解锁
  }
  clearInterval(timer);

  const report = triggers.map((idx, i) => {
    const hi = Math.min(samples.length - 1, idx + 10);
    let afterMax = 0;
    for (let k = idx + 1; k <= hi; k++) afterMax = Math.max(afterMax, Math.abs(samples[k].cam - samples[k - 1].cam));
    const lock = samples[idx].lock;
    return {
      wave: i + 1,
      camAtTrigger: Number(samples[idx].cam.toFixed(2)),
      camLockX: lock,
      lockDelta: Number(Math.abs(samples[idx].cam - lock).toFixed(3)),
      transitionStep: idx + 1 < samples.length ? Number(Math.abs(samples[idx + 1].cam - samples[idx].cam).toFixed(3)) : 0,
      frozenMaxStepAfter: Number(afterMax.toFixed(3)),
      boundaryScreenX: Number((g.level.def.viewW ?? 480) - (g.level.def.gateMargin ?? 4) - 10),
    };
  });

  return {
    triggers: report,
    segmentsCleared: g.level.segmentIndex,
    allLockedToCamera: report.every((r) => r.lockDelta < 1.5),
    noCameraJump: report.every((r) => r.frozenMaxStepAfter < 0.2),
  };
})();
