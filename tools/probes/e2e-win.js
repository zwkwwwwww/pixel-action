// 通关/失败画面取证：把 Boss 血打到 1，真实攻击击杀，验证 STAGE CLEAR 与胜利音效。
(async () => {
  const g = globalThis.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const down = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const up = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));

  down('Enter'); up('Enter');
  await wait(200);

  // 跳过前两波（专注验证通关结算与胜利音效）
  g.level.spawnedSegments = new Set([0, 1, 2]);
  g.level.segmentIndex = 3;
  g.level.wave = [];
  g.level.gateX = null;
  for (const e of g.world.enemies) { e.dead = true; e.hp = 0; e.state = 'dead'; }
  g.world.player.x = 1980;
  g.world.player.y = 41;
  down('ArrowRight'); await wait(700); up('ArrowRight');
  await wait(900);

  const boss = g.world.enemies.find((e) => e.kind === 'boss');
  if (!boss) return { error: 'Boss 未出现', gate: g.level.gateX };
  boss.hp = 1;

  // 靠近并击杀
  for (let i = 0; i < 45 && !boss.dead; i++) {
    const dx = boss.x - g.world.player.x;
    if (Math.abs(dx) > 24) {
      down(dx > 0 ? 'ArrowRight' : 'ArrowLeft'); await wait(120); up(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    } else if (Math.abs(boss.y - g.world.player.y) > 6) {
      down(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp'); await wait(90); up(boss.y > g.world.player.y ? 'ArrowDown' : 'ArrowUp');
    } else {
      down('KeyJ'); await wait(26); up('KeyJ'); await wait(200);
    }
  }
  await wait(900);

  return {
    bossSpawned: g.level.bossSpawned,
    bossDead: boss.dead,
    won: g.level.won,
    stateWon: g.won,
    mode: g.mode,
    playerHp: Math.round(g.world.player.hp),
    bgm: g.audioNow().bgm,
    played: g.audioNow().played,
    artLoaded: g.art.loaded,
    artMissing: g.art.missing,
  };
})();
