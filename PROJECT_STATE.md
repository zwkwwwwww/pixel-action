# 项目状态

> 本文件是项目的唯一可信记忆。AI 每轮内循环开始必读，每次 commit 前必更新。保持精简（150 行以内），过期信息及时清理。

## 战略规划（Total Plan）

- 游戏名：**《锈月回响 / Echoes of the Rusted Moon》**（暂定，人类可改名）
- 游戏类型：横版清版（belt-scroll）2.5D 动作游戏，单关垂直切片
- 核心机制：玩家操控女剑士在 X 轴前进、Y 轴 4 条纵深车道走位；普攻三连 + 挑空 + 闪避无敌帧 + 能量必杀，清掉 3 波敌人后击败 Boss 即通关；HP 归零失败。
- 目标平台：桌面浏览器（Chrome/Edge），内部渲染 480×270，整数倍放大；窄窗口触屏适配为非验收项。
- 技术栈 / 引擎：原生 HTML5 Canvas + ES Module，**零框架零依赖**；Blender 5.2 做低模与动画渲染；ComfyUI（Z-Image-Turbo）做像素化重塑与场景/UI/音频生成。
- 架构模式：纯逻辑层（`src/core/`，可在 node 单测，不碰 DOM/Canvas）/ 渲染层（`src/render/`）/ 接线层（`src/main.js`）；美术管线脚本在 `tools/blender/`、`tools/comfy/`。
- 美术管线（本项目的核心难点）：
  1. Blender 脚本建低模 + 骨骼，逐剪辑摆帧 → 正交相机 3/4 侧视渲染 PNG 帧序列（透明底，统一光照）
  2. Python 后处理：最近邻缩放、受限调色板量化、可选抖动 → 硬像素
  3. ComfyUI：Z-Image-Turbo（GGUF 8 步 / cfg 1）+ ControlNet Union 结构锁，按"整张精灵表一次性重塑"或"逐帧固定种子低 denoise"方式补细节，帧间像素差做一致性闸门
  4. 打包精灵表 + JSON 元数据（帧矩形/锚点/帧时长）→ `assets/`
- 运行方式：见下方「运行方式」。
- 里程碑：
  - Phase 0（引导期）：项目骨架 + 480×270 Canvas 渲染循环 + 占位方块可跑动 + 单测与 CDP 取证骨架
  - Phase 1：动作纯逻辑核心（状态机、输入缓冲、三连、闪避无敌帧、碰撞盒、受击/击飞、AI、波次关卡）与单测；色块版可打穿
  - Phase 2：Blender 主角管线（低模+骨骼+9 组动画+渲染+像素化+精灵表）接入游戏
  - Phase 3：ComfyUI 像素化重塑管线（结构锁 + 一致性闸门），主角/敌人全量过管线
  - Phase 4：3 种敌人 + Boss + 关卡场景与视差背景 + 战斗配平
  - Phase 5：特效/命中停顿/震屏/粒子 + ACE-Step 音效 BGM + HUD/结算 + 性能与端到端验收 + 合 main 并打 tag

## 当前状态

- 当前 Phase：**第 30 轮：连击评级 + 新手引导提示，待人类验收**
- 当前分支：`main`，tag 见 `phase-slice-2`
- 运行状态：**正常**
- 最近测试结果：`node --test "tests/**/*.test.mjs"` → **160 pass / 0 fail**
- 第 2 轮四项改动与证据：
  1. **音效**：短音效从 ACE-Step 换成 DSP 合成（`tools/sfx-synth.py`），BGM 仍用 ACE。
     起音时间 swing 375ms→4.4ms、hit 666ms→1.0ms、dodge 质心 180→1859Hz、death 旧版峰值仅 0.011（几乎无声）→新版可听。
     证据 `art-source/reports/audio-compare.json`；浏览器实测 `loaded:9 / failed:[]`，播放 `sfx_bow/sfx_hit/sfx_swing`。
  2. **弓手射击**：新增投射物系统（`world.projectiles` + `ATTACKS.shoot`），弓手会走位对齐车道再放箭。
     实测 `rangers:1 / shotEvents:2 / 玩家 hp 111→95 / sawArrow:true`；闪避无敌帧可躲箭（单测覆盖）。
  3. **动画加帧**：构建脚本对关键帧做线性重采样（循环剪辑环绕插值），hero 41→66 帧（idle 8/walk 12/attack1 6…），
     敌人/Boss 41→54 帧；fps 同比例抬高，动作总时长不变。帧间一致性全绿（最大 0.055）。
  4. **平滑镜头**：阻尼跟随 + 朝向前瞻（26px），150ms 内最大位移 0.08px；相机取整一次供所有图层共用。
- 新增脚本：`tools/sfx-synth.py`（音效合成）、`tools/audio-manifest.py`（重建清单）、
  `tools/audio-analyze.py`（音效客观指标对比）、`tools/comfy/restyle-denser.sh`（增量重塑）。

## 第 16 轮：Boss 地面预警圈

- **问题**：Boss 大招（slam/special/charge）只有动作前摇，玩家看不出"会打在哪一片"。
- **做法**：
  - `effects.js` 新增 `telegraphs` 容器 + `spawnTelegraph()`（上限 8 个，寿命到自动移除）。
  - `attacks.js` 给三个 Boss 招式加 `telegraph: { radius, color }`：
    slam 36px 红、charge 30px 橙、special 40px 紫。
  - `actor.startAttack()` 打 `justAttacked` 标记 → `world.emitTelegraphs()` 只在 **enemy** 起手时
    推 `telegraph` 事件（玩家自己的必杀不画敌人预警圈）→ `main.js` 消费并生成圈。
  - 渲染：椭圆（半径 ×0.38 压扁贴合 2.5D 地面），前摇期间从 r0 收缩到 28%，
    末段闪烁提示"马上落"。
- **验证**：浏览器实测 `peakTelegraphs=1 / radius=36`，
  截图 `art-source/evidence/telegraph-live.png` 可见地面红圈。
- 单测 4 条（`tests/telegraph.test.mjs`）：寿命回收、上限 8、Boss 起手推事件、玩家不推。

## 第 15 轮：狂战士新模型（第三个 Boss）

- `build_berserker()`：矮壮驼背 + 宽肩毛皮 + 双刃巨斧 + 犄角/黄眼，732 verts / 882 polys。
  与骑士（直立巨剑）、召唤者（长袍法杖）形成三种剪影。
- 踩坑记录（都值得记）：
  1. **斧刃方向**：侧视机位画面平面是 XZ，用 Y（纵深）展开会让刃口冲向镜头，看起来像"飘浮碎片"。
     正确做法是 `perp = (0.3, 0, -0.9)`（垂直于柄且在 XZ 内）+ `prism` 显式平面。
  2. **重复几何**：多次字符串替换在文件里留下了**两套斧头**（旧 `axe_face`/`axe_edge` + 新 `axe_blade`），
     白碎片就是旧代码画的。修法：整段替换而非逐块 Replace。
- 产物：`boss_berserker.json` version `f22cc7afadc4`，35 帧 AI 重塑，三道闸门全绿。
- 游戏内证据：`art-source/evidence/three-bosses.png`（三个 Boss 同屏，7 张表 loaded、missing 空）。
- **工作区已改名为 `D:\DeepSeekHarness Workspace`**（旧路径 `DeepSeekHarness的工作区` 仅剩空壳）。

## 第 14 轮：召唤者（新模型，不是换色）

- `build_enemies.py` 新增 `build_warden()`：复用 Boss 的 9 骨骨架与 9 组动作，
  几何换成**兜帽 + 长袍 + 垂肩布 + 法杖（发光宝珠/三爪/护环）**，390 verts / 450 polys。
  材质前缀 `wa_`，紫袍 + 青玉发光。
- 产物：`art-source/blender/enemies/warden.blend` → 35 帧渲染 → `assets/sprites/boss_warden.*`
  （`cell 160x160 / anchor 80,144 / 1920x800 / version 35676f004ab4`）。
- 三道闸门全绿：frame_diff（idle 0.0149）、pivot_drift（transforms 1）、walk_gate。
- **AI 重塑已完成**：35 帧全部过 ComfyUI（Z-Image + ControlNet，strength 0.9 / denoise 0.5），
  版本 `9071d135ef6e`。之前卡死的原因是 8GB 显存下队列里残留任务 + 中断不生效；重启 ComfyUI 后一次跑通（约 12 分钟）。
- **环境坑**：本会话 PATH 里的 `python` 换成了不带 Pillow 的 workbuddy 版本，restyle 的预处理会报 `No module named PIL`。
  修法：把 `C:\Users\zwkww\AppData\Local\Programs\Python\Python313` 放到 PATH 最前再跑。
- ComfyUI 端口：**8890**（8888 被 Windows 保留区间 8789-8888 占用）。
- 游戏内证据：`art-source/evidence/warden-ingame.png`（骑士与召唤者同屏）。

## 第 13 轮：上三分位箭 + 第三关 + 闪避取消

- 箭的离地高度 38→**32px**（角色 48px 的**上三分位**，用户指定），`offsetZ: 32`。
- 第三关 **CLOCK TOWER**（`STAGE_3`）：3 波共 13 敌 + Boss HP 700 / 移速 1.0，`bg: bg_boss`；
  `STAGES` 2→3，HUD 与结算自动跟随 `STAGES.length`。
- 新技能 **闪避取消**：闪避中（`stateFrame >= 4`）按攻击 → 立刻取消闪避接**上挑**（light3）。
  实现位置 `world.handleIntent`，必须早于 `canAct` 早退（闪避中 canAct 为假）。
- 单测 104 全绿（关卡表断言改为 3 关、新增终章 Boss 血量递增断言）。

## 第 12 轮：箭从弓心射出 + 连击

- **箭的出射点**：`ATTACKS.shoot.projectile` 增加 `offsetZ: 38`、`offsetX: 12→4`。
  - 依据：从 `_compose.json` 的 box/scale 反算，弓的握把在 cell 坐标 (44.4, 49.3)，相对锚点 (48,88)
    就是"横向 −3.6px、脚上方 **38.7px**"。所以箭应从离地 38px 处射出，而不是原来固定 16px。
  - `world.js` 投射物新增 `z`；`main.js` 画箭用 `GROUND+pr.y-pr.z`。
  - 浏览器实测：箭生成于 `x=326, z=38, vx=-3.4`（弓手在 330），截图中箭与弓同高。
  - 单测新增 1 条：`箭从弓中心（约 38px 高）射出，而不是脚底`。
- **最大连击**：`state.maxCombo` 记录整局最高连击；HUD 在连击 ≥2 时显示 `COMBO xN`（右上）；
  通关结算多一行 `MAX COMBO xN`（牌匾加高 96→112）。
- **待办**：连击 HUD 尚未用真实命中的浏览器探针验证（注入假人未被命中，原因待查）。

## 第 11 轮：弓弦换侧

- 用户反馈"弦在远离玩家的一侧"。前几轮试过的 **weapon 旋转**（+90°、rz180、ry+180）都不对：
  ry 类旋转会把弓**长轴转成水平**（就是"完全不对"的那一版），rz 几乎不改变朝向。
- 最终修法：**改网格**，把弓的 `v`（弓腹/弦所在方向）取反：
  `v = Vector((-0.98, 0, 0.20))`，弓仍竖直、弓面仍朝镜头，但弦与弓弧换到另一侧。
  姿态回到未加 +90° 的原始值（weapon ry 62/61、52/58/62/54/26）。
- 产物：`ranger.json` 版本 `93389db7587a`（aim 2 + shoot 6 帧重渲重塑）。
- 经验：**侧视机位下判断"弦朝哪边"，用 weapon 欧拉角会同时改变弓的平面**；
  要只翻面不改平面，必须动网格的 v 轴。

## 第 10 轮：举弓时弓面朝玩家

- **诊断**：用材质染色渲一帧（弦=红、弓身=蓝）确认——弓在侧视机位下是**侧着**的，
  玩家看到的是一块弓背侧面，弦只是一条边缘线；这就是"看不到弓弦"的原因。
- **修法**：`clip_aim` / `clip_shoot` 的 `weapon.ry` 在反向补偿基础上**再加 90°**
  （62→152 等）。绕长轴转 90° 后整个 C 形与弓弦正对镜头，弦在朝向目标的一侧。
  - `idle` / `walk` 不变（弓在身侧低垂，侧着更自然）
- 产物：`ranger.json` 版本 `b238e8c04cbe`（aim 2 + shoot 6 帧重渲重塑）。
- 证据：`tmp/ranger-bow-faceon.png`（原始渲染 aim/shoot 关键帧）、
  `tmp/ranger-idle-aim-sheet.png`（精灵表对比）、`art-source/evidence/ranger-bow-front.png`。
- 备注：诊断脚本 `tmp/_debug_bow.py`（材质染色）、`tmp/_debug_flip2.py`（把 weapon 旋转写进关键帧再渲染，
  否则渲染会重算动画覆盖手动 pose）。

## 第 9 轮：修正弓的朝向

- **Bug**：第 8 轮把 `armR`（+16）和 `weapon`（+54）**同向叠加**，弓被转了 ~70° 变成横的 ——
  `weapon` 是 `armR` 的子骨，必须**反向补偿**。
- 修法：新增 `_retarget_bow(poses, keep, tilt)`，`weapon.ry = -armR.ry * keep + tilt`。
  - `clip_idle_ranger`：armR +19~24（手放低）、keep 1.0 + tilt −8 → 弓竖直低垂、略前倾
  - `clip_walk_ranger`：套用共享 walk（keep 0.9 + tilt −8）→ 走路时弓不再随手臂来回甩
  - `aim`/`shoot` 本来就是竖直的（armR −66 / weapon +62 已近似抵消），未改
- 产物：`ranger.json` 版本 `e893b6520510`（idle 8 + walk 12 帧重渲重塑）。
- 证据：`art-source/evidence/ranger-bow-facing.png`（游戏内左=放下、右=举弓，两把弓都竖直）；
  `tmp/ranger-bow-dir.png`（原始渲染 idle/walk/aim 四帧对比）。

## 第 8 轮：弓手待机放低弓

- `clip_idle` 是四个角色共用的，所以新增**按角色覆盖**机制：`CLIP_OVERRIDES = {"ranger": {"idle": clip_idle_ranger}}`，
  `clips_for(kind)` 先套覆盖再追加 `EXTRA_CLIPS`。
- `clip_idle_ranger`：呼吸节奏不变，持弓手臂放低（armR +13~18）、弓向后倾（weapon ry +50~56）
  → 待机时弓接近**横持在腰际**，与 `aim` 的竖弓形成明显对比。
- 产物：`ranger.json` 版本 `9cb5a4abe2d4`（idle 8 帧已重渲重塑，aim/shoot 未变）。
- 证据：`art-source/evidence/ranger-idle-vs-aim.png`（游戏内两个弓手并排：左=放下、右=举弓，
  实测 `low.aiming=false / aim.aiming=true`）；`tmp/ranger-idle-aim-sheet.png`（精灵表 7x 对比）。

## 第 7 轮：弓手射程内持续拉弓

- 行为：`enemyThink` 给 ranger 打 `aiming` 标记 —— 在 `minDist..range` 之间且车道对齐时**一直举弓**，
  冷却中也保持；太远/太近/车道未对齐则放下弓（`aiming=false`）。
- 表现：`clipForActor` 在 `state==='idle' && !moving && aiming` 时选 `aim` 剪辑；
  走路/受击/攻击仍用各自剪辑，攻击时播 `shoot`。
- 新剪辑 `aim`：2 帧 @6fps 循环（满弓 + 轻微呼吸），与 `shoot` 第 3 帧同源 → 瞄准切放箭不跳姿势。
- 产物：`assets/sprites/ranger.json` rows 6→7，`aim:2`，版本 `22d04b7d2509`。
- 证据：`art-source/evidence/ranger-aim.png`（浏览器实测 `aiming:true, state:idle`）；
  `tests/ai.test.mjs` 新增「射程内举弓 / 超距放下 / 贴脸后撤不举弓」。

## 第 6 轮：弓手拉弓 + 关间停顿

- **弓手拉弓**：`build_enemies.py` 新增 `clip_shoot()`（举弓 → 拉弦 → 满弓 → 放箭 → 回位，6 帧 @17fps），
  只有 ranger 有这套帧（`EXTRA_CLIPS` + `clips_for(kind)`），其它角色不多渲。
  - 坑 1：`weapon` 是 `armR` 的**子骨**，抬臂会让整张弓跟着转 70° —— 必须给 weapon 反向补偿（+52~+62）才能让弓保持竖直。
  - 坑 2：`render_clips.py` 的 `CLIPS` 是硬编码字典，需加 `shoot` 并用 `--clips` 限定只渲弓手的剪辑。
  - 坑 3：3/4 侧视里远侧手臂被斗篷挡住，靠**躯干拧腰 + 后仰**表达拉弓，而不是指望看到弦手。
  - 游戏侧：`ANIM.ATTACK_CLIP.shoot = 'shoot'`；`build-enemy-sprites.sh` 给 ranger 加 `shoot` 剪辑与 `shoot=17` fps。
  - 产物：`assets/sprites/ranger.json` rows 5→6，`clips.shoot:6`，版本 `c1dde5c23f99`。
- **关间停顿**：打完非最后一关 → 冻结战斗，显示 `STAGE n CLEAR` + 本关用时 + `NEXT STAGE ...`，
  **墙钟 2 秒**后进下一关（帧计数会被"卡顿后一次补 5 步"追平，实测 400ms 就跑完，所以必须用 `performance.now()`）。
- 证据：`art-source/evidence/stage1-clear.png`；`tmp/ranger-shoot.png`（6 帧拉弓检查条）。

## 第 5 轮：第二关 MOONLIT FOUNDRY

- 关卡数据抽到 `src/core/stages.js`：`STAGES = [STAGE_1, STAGE_2]`，**第一关沿用原 LEVEL**（加了 id/name）。
- 第二关：3 波共 **10 个敌人**（双弓手、双壮汉）+ Boss（HP 560 / 移速 0.9），
  世界宽 3400，触发点 260/820/1380，Boss 触发 2100。
- 流程：打完第一关 Boss → `advanceStage()` 重建关卡、清场、回血、镜头归零，
  显示 2.5s 横幅 `STAGE 2 MOONLIT FOUNDRY`；**用时跨关累计**，只有打完最后一关才结算写纪录。
- 背景：`tools/comfy/backgrounds.mjs` 新增 `bg_stage2`（铸造厂/齿轮/熔炉，seed 7404），
  生成 56s；`main.js` 按 `level.def.id` 选背景，Boss 战统一用 `bg_boss`。
- 结算标题在双关卡下显示 **ALL STAGES CLEAR**。
- 证据：`art-source/evidence/stage2.png`（新背景 + 横幅 + HUD `STAGE 2/2`）；
  `tests/stages.test.mjs` 5 条（关卡表/触发点与世界宽/第二关刷怪落闸/清完才出 Boss/真实 step 循环）。

## 第 4 轮：完成度（暂停 / 纪录 / 结算）

- **暂停**：`Esc` 切换。暂停只冻结逻辑（`frame()` 跳过 `logicStep`），画面继续绘制并显示遮罩；
  暂停中 `R` 重开、`M` 静音。实测 `world.frame` 暂停期间 81→81（冻结），恢复后 81→105。
- **通关纪录**：`src/core/records.js`（纯逻辑，可注入 storage 以便单测）。存
  `{ bestTimeMs, clears, bestGrade }` 到 `localStorage['rusted-moon-records-v1']`。
- **结算评价**：时间档（≤90s=2 / ≤150s=1 / ≤240s=0 / 更慢=-1）+ 残血 ≥70% 加一档 → C/B/A/S。
  只有"又快又稳"才 S；快但残血是 A。结算页显示 TIME / RANK / NEW BEST，标题页显示 BEST + CLEARS。
- 证据：`art-source/evidence/pause-menu.png`；`tests/records.test.mjs` 5 条（格式化/分档/新纪录/不覆盖最佳/坏数据降级）。

## 第 3 轮：关卡边界 = 当前这一屏的右缘（不画任何线）

- 小怪/精英头顶血条保持显示（上一轮曾误判关掉，已恢复）；想隐藏改 `SHOW_ENEMY_HP = false`。
- **关卡边界不再画任何竖线**：波次触发时把镜头**锁在触发瞬间的真实相机位置**，
  玩家被夹在屏幕右缘内 —— 你眼前这一屏就是战场，右缘就是墙。
- 锁定值取真实相机位置（不是 triggerX 推导）：推导值与当前机位不同会让每次开波镜头滑一下，
  而且边界会落在离眼睛更远的地方（用户实测反馈）。
  兜底：相机滞后于玩家 / 敌人出生在屏幕外时，锁位只向前补，绝不把玩家往回拉。
- 边界余量 `GATE_MARGIN = 4`、夹紧 10px：角色停住时视觉上贴住屏幕右缘（屏幕 X 466 / 480）。
- 相关常量：`VIEW_W=480`、`GATE_MARGIN=4`（`src/core/level.js`）。
- 实测三波开波：`lockDelta` 0.06 / 0.22 / 0.22 px，锁后镜头位移 ≤ 0.03 px（等于静止），
  三波边界都在屏幕 X 466；Boss 战与通关回归通过。
- 单测 86 条全绿，其中 4 条新契约：锁位=当前相机、相机滞后不拉回玩家、最右敌人必须在屏内、边界夹紧。

## 运行方式（已实测）

| 用途 | 命令 |
| --- | --- |
| 启动静态服务器 | `python -m http.server 9500 --bind 127.0.0.1`（**必须把输出重定向到文件**，否则管道写满会卡死请求） |
| 打开游戏 | `http://127.0.0.1:9500/` → 标题画面按 **Enter** |
| 操作 | WASD 走位 / J 攻击（三连）/ K 闪避 / L 必杀 / **Esc 暂停** / M 静音 / R 重开 |
| 单测 | `node --test "tests/**/*.test.mjs"` |
| 重建 hero 精灵表（含 ComfyUI 重塑） | `bash tools/build-sprites.sh hero` |
| 重建敌人精灵表 | `bash tools/build-enemy-sprites.sh` |
| 背景重生成 | `node tools/comfy/backgrounds.mjs [--force]` |
| 音频重生成 | `node tools/comfy/audio-batch.mjs [--force]` |
| 帧间一致性 | `python tools/frame_diff.py --in tmp/final-hero --threshold 0.22` |
| 浏览器取证 | `node tools/browser-probe.mjs --url http://127.0.0.1:9500/ --wait 1800 --shot art-source/evidence/x.png --eval-file tools/probes/phase2.js` |
| 素材总览图 | `python tools/contact_sheet.py` |

## 代码地图（当前真实存在的文件）

- `index.html` — canvas#game + 内联图标
- `src/main.js` — 标题/战斗场景、输入、固定步长循环、相机、绘制、音频事件、取证接口 `globalThis.__game`
- `src/core/world.js` — 战斗世界（输入意图/命中结算/命中停顿/事件流）
- `src/core/actor.js` — 角色状态机与物理（挑空/倒地/起身/无敌帧）
- `src/core/attacks.js` — 攻击数据表（三连 + 必杀 + Boss slam）与命中盒几何
- `src/core/ai.js` — 三种敌人 + Boss 的 AI 配置与思考函数
- `src/core/level.js` — 波次触发、屏幕边界锁、Boss 出场与通关判定（关卡引擎）
- `src/core/stages.js` — 关卡表：RUSTED STREET / MOONLIT FOUNDRY（纯数据）
- `src/core/input.js` — 方向映射 + 输入缓冲
- `src/core/animation.js` — 状态 → 剪辑 → 帧号映射（纯逻辑）
- `src/core/records.js` — 通关纪录：时间格式化 / C-A-S 评价 / localStorage 读写（纯逻辑）
- `src/core/effects.js` — 飘字/粒子纯逻辑（硬上限 240）
- `src/render/scale.js` — 480×270 整数倍缩放视口
- `src/render/sprites.js` — 精灵表加载 + 朝向翻转 + 缺剪辑回退
- `src/render/pixelfont.js` — 5×7 点阵字体（HUD 无抗锯齿）
- `src/render/audio.js` — WebAudio 播放/BGM/静音/取证
- `src/data/*` — 由脚本生成的数据（暂无）
- `tools/blender/` — Blender 主角建模/渲染/验收脚本 + README
- `tools/blender/enemies/` — 敌人/Boss 建模/渲染脚本
- `tools/comfy/` — ComfyUI 客户端、像素化重塑、背景、音频
- `tools/pixelize.py` `compose_final.py` `pack_sprites.py` `frame_diff.py` `contact_sheet.py`
- `tools/build-sprites.sh` `build-enemy-sprites.sh` — 一条命令重建
- `assets/sprites/` `assets/bg/` `assets/audio/` — 游戏直接加载的成品
- `tests/*.test.mjs` — 72 条纯逻辑单测

## 环境事实（已实测）

- Blender 5.2.1 LTS @ `E:/Program Files/Blender Foundation/Blender 5.2/blender.exe`
- ComfyUI @ `http://127.0.0.1:8888`（本机安装 + 共享模型池 `E:/Comfy-Desktop/ComfyUI-Shared/models`；
  已补 `extra_model_paths.yaml`；日志 `../pixel-action-logs/`）
- 出图配方：`z_image_turbo-Q5_K_M.gguf` + `Qwen3-4B-Q4_K_M.gguf`(lumina2) + `ae.safetensors`，
  ControlNet `Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps`；8 步 / cfg 1 / euler+simple
- 音频配方：ACE-Step 1.5 turbo + qwen_0.6b/4b + ace_1.5_vae，8 步 / cfg 1
- GPU RTX 5060 Laptop 8GB；Node v24.21.0；Python 3.13.14
- 坑：DSH 内置浏览器缺 Electron → CDP 探针；Windows 保留端口 → 用 9500；`node --test tests/` 需 glob；
  静态服务器输出必须重定向；ComfyUI 逐帧重塑约 12~14s/帧

## 遗留 Bug 清单

- [ ] 敌人 attack2/attack3 未重塑，播放时回退 attack1（可接受，记录在案）
- [ ] 背景透视比角色大一号（风格化处理，已用暗化 + 程序化地面统一观感）

## 下一步计划

1. 等敌人重塑（88 帧）与音频跑完 → 跑 `tools/build-enemy-sprites.sh` → 接进游戏。
2. 端到端取证：三波 + Boss 的 CDP 截图；性能取证（满场粒子的帧内耗时）。
3. 更新 README / 交付说明，跑 contact sheet，合 main 打 tag `phase-slice`。

