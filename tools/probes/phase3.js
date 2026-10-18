// 第 2 轮验收：弓手真的射箭、箭真的能命中、音效解码、镜头移动连续。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(500);

  // 跳到第 3 波（ranger 波），站到对射距离内
  g.level.spawnedSegments = new Set([0, 1]);
  g.level.segmentIndex = 2;
  g.level.wave = [];
  g.level.gateX = null;
  for (const e of g.world.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  g.world.player.x = 1332;
  g.world.player.y = 41;
  await wait(900);

  const rangers = g.world.enemies.filter((e) => e.kind === 'ranger');
  const hp0 = g.world.player.hp;

  // 站桩吃箭（验证「能打中」），同时采样投射物与镜头
  let maxProjectiles = 0;
  let sawArrow = false;
  let shotEvents = 0;
  const camSamples = [];
  for (let i = 0; i < 120; i++) {
    await wait(50);
    maxProjectiles = Math.max(maxProjectiles, g.world.projectiles.length);
    if (g.world.projectiles.length) sawArrow = true;
    shotEvents = g.lastEvents.filter((e) => e.type === 'shoot').length;
    camSamples.push(g.camX);
    if (g.world.player.hp < hp0 - 10) break;
  }

  // 镜头连续性：相邻采样（50ms≈3 逻辑帧）的位移应该很小
  let maxCamJump = 0;
  for (let i = 1; i < camSamples.length; i++) {
    maxCamJump = Math.max(maxCamJump, Math.abs(camSamples[i] - camSamples[i - 1]));
  }

  const a = g.audioNow();
  return {
    rangers: rangers.length,
    sawArrow,
    maxProjectiles,
    shotEvents,
    hpBefore: hp0,
    hpAfter: g.world.player.hp,
    arrowDamaged: g.world.player.hp < hp0,
    cameraLag: Number(Math.abs(g.camTarget - g.camX).toFixed(2)),
    maxCamJumpPer150ms: Number(maxCamJump.toFixed(2)),
    audio: { loaded: a.loaded, failed: a.failed, played: a.played, bgm: a.bgm },
    spriteFrames: g.art.loaded.length,
  };
})();
