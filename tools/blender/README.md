# Blender 主角管线（hero）

> 目标：用 Blender 5.2 无头渲染出「女剑士」低模 9 组动作的透明底帧序列，供 `tools/pixelize.py` 缩到 56 px 后打包进 `assets/sprites/`。
> 规格的唯一来源是 [`docs/art-contract.md`](../../docs/art-contract.md)，本文件只记录**怎么跑、怎么改、踩过什么坑**。

---

## 1. 文件

| 文件 | 作用 |
| --- | --- |
| `tools/blender/build_hero.py` | 从零重建 `hero.blend`：几何、材质、骨骼、9 个 action、相机、灯光、渲染设置 |
| `tools/blender/render_clips.py` | 无头渲染每个剪辑的每一帧 → 384×384 透明 PNG + 96×96 最近邻预览 |
| `tools/blender/make_evidence.py` | 生成 contact sheet 和单帧检查图（供人眼验收） |
| `tools/blender/verify_clips.py` | 验收测试：核对 `.blend` 结构 / 帧数 / 透明 / 出画 / 最近邻一致性 |
| `tools/blender/inspect_blend.py` | 只读导出 `.blend` 的 JSON 摘要（被 verifier 调用，也可单独用） |
| `art-source/blender/hero.blend` | 工程源文件（网格 + 骨骼 + 9 action + 相机灯光） |
| `art-source/blender/hero/<clip>/<clip>_NN.png` | 渲染产物，384×384 RGBA，`film_transparent` |
| `art-source/blender/hero/_cell96/<clip>/...` | 96×96 最近邻预览（**只用于核对，不是最终资产**） |
| `art-source/blender/hero/_render_report.json` | 每帧耗时 / bbox / alpha 覆盖率 |
| `art-source/evidence/hero-contact-sheet.png` | 9 剪辑全帧 contact sheet |
| `art-source/blender/evidence/check_*.png` | 单帧检查图（含 96 cell 锚点十字线） |

---

## 2. 精确命令

环境：Blender **5.2.1 LTS** @ `E:/Program Files/Blender Foundation/Blender 5.2/blender.exe`；
后处理 Python 用分析环境（带 Pillow/numpy）：`C:/Users/zwkww/.dsh/profiles/desktop/node_modules/dsh-blender/.venv/Scripts/python.exe`。
所有命令都在**项目根** `pixel-action/` 下执行。

### 2.1 重建 .blend（改了模型 / 骨骼 / 动作才需要）

```bash
"E:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_hero.py
```

输出 `art-source/blender/hero.blend`，并把 9 个 action 以 `use_fake_user=True` + 静音 NLA 轨保存。

### 2.2 渲染全部剪辑（一条命令重跑）

```bash
"E:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b art-source/blender/hero.blend -P tools/blender/render_clips.py -- --out art-source/blender/hero
```

实测耗时（RTX 5060 Laptop，EEVEE 16 samples）：**首帧 ~12 s**（shader 编译），之后 **0.15–0.18 s/帧**，
41 帧总计 **18–21 s**。

只跑部分剪辑 / 调整参数：

```bash
# 只渲染 idle 和 attack1
... -P tools/blender/render_clips.py -- --out art-source/blender/hero --clips idle,attack1
# 不生成 96 预览
... --no-cell
# 改采样
... --samples 8
```

### 2.3 生成验收图

```bash
"C:/Users/zwkww/.dsh/profiles/desktop/node_modules/dsh-blender/.venv/Scripts/python.exe" tools/blender/make_evidence.py
```

### 2.4 跑验收测试（必须绿）

```bash
"C:/Users/zwkww/.dsh/profiles/desktop/node_modules/dsh-blender/.venv/Scripts/python.exe" tools/blender/verify_clips.py
```

它检查：9 个 action 名称 / 自定义属性 `fps` `loop` `frame_count`、9 根骨骼、ORTHO 相机、384×384、
film_transparent、每剪辑帧数与文件名、四角 alpha=0、剪影不出画、96 预览与 4× 最近邻逐像素一致、
contact sheet 与单帧检查图存在。任一失败退出码 1 并列出问题。

---

## 3. 规格落地值

| 项 | 值 | 说明 |
| --- | --- | --- |
| 网格 | 619 verts / 741 tris，9 个纯色材质 | skin / hair / coat / coat_dark / pants / boot / leather / trim / metal |
| 身高 | 1.70 单位，脚底 z=0，面朝 +X | 双马尾 + 短外套后摆 + 右肩甲 + 护腕 + 单手持剑 |
| 骨骼 | root / hips / spine / head / armL / armR / legL / legR / weapon | 9 根，全部刚性绑定（每件网格 1 个 vgroup 权重 1.0） |
| 渲染分辨率 | 384×384 | 4× 超采样：最终 96 cell、56 px 角色 |
| 相机 | ORTHO，`ortho_scale = 1.70 × 384 / 224 = 2.914286` | yaw 12° / pitch −6°（相机在角色侧前方 12°、俯视 6°，距离 6） |
| 相机目标点 | `(0, 0, 1.214286)` | = (192−32) px × (ortho_scale/384)，保证脚底落在画面底边上方 32 px（= cell 8 px） |
| 引擎 | `BLENDER_EEVEE`（5.2 枚举） | 16 TAA samples，`film_transparent`，Standard 色彩变换 |
| 灯光 | Key / Fill / Rim 三盏 SUN + 世界环境光 | 主光左上前方，冷色补光，暖色轮廓光 |

### 剪辑表

| clip | 帧数 | fps | loop | 动作设计 |
| --- | --- | --- | --- | --- |
| idle | 4 | 8 | ✓ | 呼吸起伏，剑垂下 |
| walk | 6 | 12 | ✓ | 原地循环；剑臂稳定（weapon 反向补偿），自由臂摆动 |
| attack1 | 4 | 14 | ✗ | 举剑过顶 → 大幅斜劈（横斩） |
| attack2 | 4 | 14 | ✗ | 反手横斩：剑横在胸前 → 向外后方反抽 |
| attack3 | 5 | 12 | ✗ | 下蹲蓄力 → 由下向上挑空，剑最终竖直向上 |
| dodge | 4 | 16 | ✗ | 后撤闪避：压低 + 后仰 + root 后移再收回 |
| hurt | 2 | 14 | ✗ | 受击后仰、双臂外张、整身后退 |
| death | 6 | 10 | ✗ | 以 `root` 为轴整体向后倒地，最后一帧平躺 |
| special | 6 | 12 | ✗ | 蓄力（剑低垂）→ 举剑过顶 → 下砸 → 收势 |

每帧都是**显式关键帧**（没有插值歧义），action 上带自定义属性：`act["fps"]`、`act["loop"]`、`act["frame_count"]`。

---

## 4. 怎么改

### 4.1 改帧数 / fps

**先改契约** `docs/art-contract.md`，然后同步 4 处（故意不共享常量，避免 Blender 外无法 import）：

1. `tools/blender/build_hero.py`
   - 对应 `clip_xxx()` 返回的 pose 列表长度 = 帧数（每个 pose 一帧，从第 1 帧开始）；
   - 文件末尾 `CLIPS = [("idle", clip_idle, 8, True), ...]` 里的 fps / loop。
2. `tools/blender/render_clips.py` 顶部 `CLIPS = {"idle": (4, 8, True), ...}`。
3. `tools/blender/verify_clips.py` 顶部 `CLIPS`。
4. `tools/blender/make_evidence.py` 顶部 `CLIPS`。

改完跑 2.1 → 2.2 → 2.4。

### 4.2 加 / 改一个 pose

`pose()` 是**在 BASE 站姿上做加法**，参数是**世界轴角度（度）**和**世界位移（米）**：

```python
pose(
    root={"tx": -0.1, "tz": 0.05},   # 整体位移（世界轴，米）
    hips={"tz": -0.06},              # 骨盆下沉
    spine={"ry": 18, "rz": -12},     # 前倾 18°、向左转 12°
    head={"ry": -8},
    armR={"ry": -60, "rx": -10},     # 持剑手
    armL={"ry": 30},
    legR={"ry": -25}, legL={"ry": 20},
    weapon={"ry": 25},               # 手腕：正的 ry 让剑尖向下压
)
```

轴的含义（角色面朝 +X）：

| 轴 | 效果 |
| --- | --- |
| `rx` | 侧倾：+ 倒向 −Y（远离镜头一侧） |
| `ry` | 俯仰：对竖直骨（spine/head）+ 向前倒；对下垂骨（arm/leg）− 向前摆 |
| `rz` | 偏航：+ 转向 +Y（角色左侧） |
| `tx/ty/tz` | 世界位移（米），一般只给 `root` / `hips` |

剑尖角度公式（所有摆动都在 XZ 平面）：`φ = -35° - (armR.ry + weapon.ry)`，
`φ=0` 水平向前，`φ=90` 竖直向上，`φ=-90` 竖直向下。改攻击幅度时先算这个，能省很多渲染。

### 4.3 改相机

在 `build_hero.py` 的 `camera / lights / render settings` 段：

```python
ORTHO_SCALE = 1.70 * 384 / 224.0        # 角色 224 render px 高
WORLD_PER_PX = ORTHO_SCALE / 384.0
CAM_TARGET  = Vector((0, 0, (192 - 32) * WORLD_PER_PX))   # 脚底距底边 32 px
yaw, pitch  = math.radians(12), math.radians(6)
```

- 改角色最终像素高度：改 `1.70 * 384 / 224` 里的 224（= 目标 cell 高度 × 4）。
- 改锚点 padding：改 `192 - 32` 的 32（= 8 cell px × 4）。
- 改机位角度：改 `yaw` / `pitch`；注意 `pitch` 会让 Y 方向深度在画面上产生竖直位移，
  剪影 bbox 会比 224 高一点（当前 229 px ≈ 57.2 cell px），下游 `pixelize.py --height 56` 会归一化。
- 改分辨率：同时改 `render_clips.py` 的 `SUPERSAMPLE = 4`（= 渲染尺寸 / 96）和 verifier 的 `RENDER_SIZE`。

---

## 5. 已知坑 / 设计取舍

1. **引擎枚举不是 `BLENDER_EEVEE_NEXT`**。Blender 5.2.1 的 `engine` 枚举只有 `BLENDER_EEVEE`。
   脚本会自动探测；网上/契约里写的 4.2 名字直接赋值会 `TypeError`。
2. **首帧慢**：EEVEE 首次渲染要编译 shader（~12 s），后面 0.15 s/帧。不要误判为卡死。
3. **Blender 5.x slotted actions**：action 必须绑定 slot 才会驱动骨架。
   `build_hero.py` 用「先 `action=None` 再 `keyframe_insert`」让 Blender 自动建 action + slot；
   `render_clips.py` 切换 action 时显式 `animation_data.action_slot = action.slots[0]`。
   自己用 `bpy.data.actions.new()` 创建再直接赋值，可能整个剪辑不动。
4. **NLA 只是仓库**：9 条 NLA 轨全部 `mute=True`，文件保存时激活 action 是 `idle`；渲染时用 `--clips` 切 action。
5. **96 预览是 4× 最近邻 + alpha 阈值 0.5**（`>=0.5 → 255`，否则 0）。384 原帧有约 1.4% 的半透明抗锯齿边，
   阈值化是为了满足「无半透明糊边」。如果 `tools/pixelize.py` 改用 box 预滤波，结果会有细微差异，二者选一即可
   （契约允许 nearest 或 box→nearest）。
6. **剑的宽面朝相机**：剑刃宽度在 XZ 平面内、厚度沿 Y。如果给剑加上绕刃轴的腕转，侧视图里剑会变成 1 px 发丝。
7. **腿只有一根刚性骨**（无膝关节）：走/蹲是风格化的，**死亡不是 ragdoll**，而是绕 `root` 整体向后倒，
   末帧平躺并抬高 `root.tz = 0.09`，避免衣摆插到地面以下。脚底锚点因此会略微离地（可接受）。
8. **`art-source/` 被 `.gitignore` 忽略**：`hero.blend` 按契约应入库，但当前规则会把它挡掉。
   需要入库时用 `git add -f art-source/blender/hero.blend`，或由负责人调整 `.gitignore`（本阶段未改）。
9. **验收图的 bbox 高度**：idle/walk 才检查 56±2 cell px；attack/special 举剑帧的 bbox 会到 ~76 cell px，
   这是剑而不是角色变高。
10. **`_cell96/` 只是对照图**，不要打包进游戏；正式像素化走 `tools/pixelize.py`。

---

## 6. 自检清单

- [x] `hero.blend`：1 网格 + 9 骨骼 + 9 action（`use_fake_user` + NLA 存档）
- [x] 41 帧全部渲染完成，帧数 = 契约表
- [x] 384×384 RGBA，四角 alpha=0，剪影不出画
- [x] 96 预览与 4× 最近邻逐像素一致（41/41）
- [x] contact sheet & 单帧检查图已生成并人眼核对
- [x] `verify_clips.py` → `RESULT: PASS`
