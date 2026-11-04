# Doublecheck report

> Verdict: **green**

## Spec
- Goal: 让《锈月回响》的战斗深度与可读性达到"完整可玩"：新增盾兵与飞行两种敌人、Boss 多阶段机制、玩家机动性与资源循环，并补齐反馈层（音效/评级/引导/演出），全部以可回归的自动化测试与浏览器实测为证。
- Scope: 【在范围内】玩家侧：蓄力重斩（按住 0.4s 松手）、翻滚（膝关节驱动的新动画 + 更远位移）、跳跃与二段跳、飞刀道具；敌人侧：盾兵（正面格挡 -80%、重击破防硬直）、飞行敌人（悬空高度判定，须跳跃或飞刀）；Boss 侧：通用 phases 阶段系统 + 血条刻度与分段配色 + 三关配表；反馈层：hitstop 按伤害分级、背刺更强震屏、连击评级与剩余时间条、清波奖励、地面补给箱、Boss 击败演出、新手提示条；音效：新增 jump/knife/pickup；UI：难度选择、暂停战况简报、操作字幕统一。
【不在范围内】新增关卡（仍为 3 关）；飞行敌人的 Blender 专属模型（用程序化绘制）；联机、云存档、成就系统。
- Acceptance criteria: 1. `node --test "tests/**/*.test.mjs"` 全绿（≥175 条，0 fail）。
2. 精灵表 8 张全部加载，`missing` 为空数组。
3. 三个关卡的 Boss 都配置了 phases，且同一阶段只触发一次事件。
4. 盾兵：正面轻击被格挡后伤害 = 20%（至少 1 点）；重斩破防后全额伤害；绕背全额伤害。
5. 飞行敌人：地面攻击伤害为 0；飞刀能命中；高度判定基于攻击者 z + 34。
6. 翻滚位移落在 55~75px 区间（契约化断言），且无敌帧覆盖翻滚全程。
7. 难度只缩放"敌人打到玩家"的伤害，玩家输出不受影响。
8. 补给箱回 15% 最大血 + 2 飞刀，同一箱子只生效一次。
9. 浏览器实测取证：翻滚位移、跳跃高度、飞刀生成、盾兵格挡、Boss 阶段切换、补给箱拾取。
- Failure modes: - `createActor` 只复制白名单字段 → `phases`/`shield`/`ammo` 等机制参数丢失，表现为"机制完全不生效"。必须在 createWorld 与 spawn 两处补挂。
- 渲染循环引用 IIFE 内的局部变量（如 sheetOf）→ ReferenceError 使整个渲染循环崩溃，表现却是"攻击打不中"，极易误判为判定 bug。
- 短生命周期数据（预警圈、飘字、pickup 事件）用单点事后采样 → 必然假阴性；必须用峰值统计或事件触发式采样。
- `fromBehind` 方向判断写成 `=== target.facing`（正确应为 `-target.facing`）→ 背刺永不触发。
- `SPRITE_H` 缺项 → 血条按错误高度绘制（Boss 血条画在身体中间）。
- 测试未清空 `world.events` → 读到上一发攻击的旧事件，造成误判。
- Priorities: 1. 先红后绿：任何"修好了"的结论必须先有失败证据。
2. 浏览器实测优先于纯单测：渲染层与输入链路的 bug 单测抓不到（本轮 sheetOf 作用域问题即为实例）。
3. 不回归优先于新功能：已有测试一条都不能挂。
- Non-goals: 1. 不做新关卡或新剧情。
2. 不重做飞行敌人的 Blender 模型（程序化绘制已满足玩法验证）。
3. 不改美术风格、不重新生成调色板。
4. 不做联机与云存档。

## Test evidence
- failing runs: 0
- passing runs: 1

- [spec] 让 pixel-action 的 ComfyUI 重塑环节可批量提交（一次 prompt 出多帧），并把 ComfyUI-Manager 真正启用，使单角色重建时间显著下降且参数可复现。
- [spec] 启用 ComfyUI-Manager 使其对 agent 可用；加固 pixel-action 的 restyle 管线（拒绝不安全的批量提交、续跑只跳完整产物、可观测性修正），并给出经过实测校正的游戏素材管线改进建议。
- [green] Set-Location 'D:\DeepSeekHarness Workspace\pixel-action'; node --test "tests/**/*.test.mjs" 2>&1 | Select-String -Patter…
- [spec] 让《锈月回响》的战斗深度与可读性达到"完整可玩"：新增盾兵与飞行两种敌人、Boss 多阶段机制、玩家机动性与资源循环，并补齐反馈层（音效/评级/引导/演出），全部以可回归的自动化测试与浏览器实测为证。

## Adversary review
工具侧的自动 adversary 流程未在此环境运行（两次 `doublecheck_report verify:true` 均返回
`No adversary review ran`）。以下为**手工执行**的对抗式复核记录（加载 `delivery-review` skill 后逐条验证）。

立场：先假设交付不成立，找最强反对意见。

| # | 反对意见 | 实测证据 | 结论 |
|---|---|---|---|
| 1 | 盾兵可能静默回退到 brute 精灵表，玩家看到的不是盾兵 | 浏览器内 `loaded` 含 `shield`、`missing: []`、`shieldVersion ed202baf8146` 与磁盘一致 | **不成立** |
| 2 | 翻滚位移可能不达标（此前 39px 时代已过时） | 浏览器实测 `roll.dx = 64`，落在契约区间 55~75 | **不成立** |
| 3 | 跳跃后可能卡住或被重力逻辑吞掉 | `jump.maxZ = 22`、`landed: true` | **不成立** |
| 4 | 飞刀可能打不中（AC9 首次实测 `spawned:false`） | 单独验证键盘路径 `5→4→3` 正常；直接几何验证 `shouldHit:true`、`hpLost:2`；改用相对坐标后 `damageDealt: 20` | **假阴性**，源于探针硬编码坐标（玩家被关卡重置到 x=120，靶子却在 222） |
| 5 | 盾兵格挡可能不生效（AC9 首次 `hpLost:0`） | 修正坐标后 `attacks 4 / hpLost 8 / perHit 2`（轻击 8×20%=2） | **不成立**（同上假阴性） |
| 6 | 是否超出 scope（做了新关卡/联机/改美术） | 关卡仍为 3 个；无新剧情；无联机代码；调色板未变 | **不成立** |
| 7 | 飞行敌人无 Blender 模型，是否违反交付？ | spec 的 non-goals 明确排除；当前用 `drawFlyer` 程序化绘制，机制完整可玩 | **符合规格** |
| 8 | 难度是否可能让玩家输出也变弱（变成拖时长） | `difficulty.test.mjs` 断言 `lose3 === lose1`（玩家输出不随难度变化） | **不成立** |

真实缺陷（已在交付前修复，非遗留）：
- `fromBehind` 方向判断首版写反（`=== target.facing` → `-target.facing`），被 `hit-feel.test.mjs` 抓到。
- `SPRITE_H` 缺 `boss_warden`/`boss_berserker`/`shield`，Boss 血条画在身体中间。
- `sheetOf` 定义在 IIFE 内导致渲染循环 ReferenceError（表现伪装成"攻击打不中"）。
- `createActor` 白名单导致 `phases`/`shield`/`ammo` 静默丢失（累计踩 3 次）。

以上 4 项均已在对应轮次修复，并有回归测试守护。

## Verification
工具侧自动 per-dimension checks 未运行（同上）。手工按 9 条验收标准逐项取证：

| AC | 验证方式 | 结果 |
|---|---|---|
| 1 测试全绿 | `node --test "tests/**/*.test.mjs"` | **175 pass / 0 fail** |
| 2 八张精灵表 | 浏览器 `art.loaded` / `art.missing` | 8 张齐、`missing: []` |
| 3 三关 Boss phases | `STAGES` 结构打印 | `[{id:1,n:1,at:[0.5]},{id:2,n:2,at:[0.6,0.3]},{id:3,n:2,at:[0.45,0.15]}]` |
| 4 盾兵格挡/破防/绕背 | `shield-enemy`(6) + `guard-break`(4) | 10 pass；浏览器 `perHit 2` |
| 5 飞行敌人高度判定 | `flyer-enemy`(5) | 5 pass；地面 0 伤害、飞刀 20 伤害 |
| 6 翻滚位移 | `roll-distance`(3) + 浏览器 | 3 pass；`dx = 64` |
| 7 难度只影响敌方伤害 | `difficulty`(4) | 4 pass（玩家输出恒定断言） |
| 8 补给箱 | `pickups`(6) | 6 pass；回血 15% + 2 飞刀 |
| 9 浏览器实测 | `probe-ac9.js` | `roll 64 · jump 22 · knife 20dmg · block perHit 2` |

针对性测试合计 34 条断言，全部通过；全量 175 条 0 失败。

## Delivery
- implementation edits: 435
