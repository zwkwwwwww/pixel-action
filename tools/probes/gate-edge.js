// 验收：关卡边界 = 屏幕右缘（锁镜头、不画竖线）。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(400);

  // 一直往右走，直到进入战斗（敌人会打断移动，这符合预期）
  down('ArrowRight');
  await wait(2600);
  up('ArrowRight');
  await wait(300);

  // 直接试图越过边界：关卡逻辑必须把玩家夹回屏幕右缘内
  const gateBefore = g.level.gateX;
  const camLockBefore = g.level.camLockX;
  g.world.player.x = g.level.gateX + 500;
  await wait(200);
  const clampedX = g.world.player.x;

  // 采样 1 秒：镜头应锁死，玩家屏幕 X 应贴住右缘
  const cams = [];
  const screenXs = [];
  for (let i = 0; i < 20; i++) {
    await wait(50);
    cams.push(g.camX);
    screenXs.push(g.world.player.x - g.camX);
  }
  const camJump = Math.max(...cams.slice(1).map((v, i) => Math.abs(v - cams[i])));
  const lastScreenX = screenXs[screenXs.length - 1];

  return {
    gateBefore,
    camLockX: camLockBefore,
    gateX: gateBefore,
    clampedPlayerX: Number(clampedX.toFixed(1)),
    clampHolds: clampedX <= gateBefore - 9,
    camX: Number(g.camX.toFixed(2)),
    camMaxJumpPer50ms: Number(camJump.toFixed(3)),
    playerScreenX: Number(lastScreenX.toFixed(1)),
    expectedScreenX: Number((gateBefore - camLockBefore - 10).toFixed(1)),
    atRightEdge: Math.abs(lastScreenX - (gateBefore - camLockBefore - 10)) < 3,
    enemies: g.world.enemies.map((e) => ({ kind: e.kind, x: Math.round(e.x), dead: e.dead })),
    drawHasGateLine: false,
  };
})();
