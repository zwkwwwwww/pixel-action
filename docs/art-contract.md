# 美术契约 v1（Blender → 像素精灵）

> 这份文件是「Blender 出什么、游戏怎么吃」的唯一约定。改规格先改这里，再改脚本。

## 1. 屏幕与像素规格

| 项 | 值 |
| --- | --- |
| 内部渲染分辨率 | **480 × 270** |
| 显示 | 整数倍最近邻放大（scale = floor(min(winW/480, winH/270))） |
| 主角最终可见高度 | **56 px**（±2） |
| 小怪最终可见高度 | 44~52 px |
| Boss 最终可见高度 | 96~112 px |
| 精灵帧单元（cell） | 主角/小怪 **96 × 96**；Boss **160 × 160** |
| 锚点（anchor） | 脚底中心：主角/小怪 `(48, 88)`；Boss `(80, 144)`（即 cell 内脚底位置） |
| 色板 | 全局受限色板 **≤ 48 色**，唯一真源 `art-source/palette.png`（+ `.json`），由 `bash tools/build-palette.sh` 生成；`compose_final.py --palette` 强制映射到它 |
| 采样 | 缩小必须 box/面积平均 → 最后一步 nearest；**禁止**双线性/双三次插值 |
| 后处理刚性 | 同一角色的所有帧必须共用同一 `(裁剪框, 缩放, 粘贴位置)`；由 `tools/pivot_drift.py` 闸门校验（逐剪辑变换必须唯一） |

## 2. 相机（所有角色统一）

- 正交（ORTHO），无透视畸变。
- 3/4 侧视：相机在角色正侧偏前 12°（yaw），俯视 -6°（pitch）。
- 角色面朝 **+X**（画布右侧）；向左走由游戏层水平翻转，**不重渲染**。
- 光照：主光从左上前方，冷色补光右侧，暗部靠环境色；透明背景（film_transparent）。
- 角色不可出画；渲染时按包围盒紧裁切，但保留统一 padding（脚底下方 8 px 透明）。

## 3. 动画剪辑（帧数 / fps）

| clip | 帧数 | fps | 说明 |
| --- | --- | --- | --- |
| idle | 8 | 16 | 呼吸起伏，剑随手垂 |
| walk | 10~12 | 16 | 前进循环（原地动画，位移由游戏逻辑做）。**禁止相邻两帧都接近双腿直立**——直立姿势被保持两帧（16fps 下 125ms）会造成视觉暂留，看起来像有个站直的残影叠在角色上。由 `tools/walk_gate.py` 闸门校验，必要时用 `pack_sprites.py --skip walk=N` 丢掉多余过渡帧 |
| attack1 | 6 | 21 | 横斩（快） |
| attack2 | 6 | 21 | 反手斩（快） |
| attack3 | 7 | 17 | 上挑/挑空（慢、重） |
| dodge | 6 | 24 | 侧/后闪避 |
| hurt | 3 | 21 | 受击后仰 |
| death | 9 | 15 | 倒地 |
| special | 9 | 18 | 能量必杀 |

> **第 2 轮加帧（v2）**：原始动画是 4~6 帧的稀疏 pose，60fps 下明显一顿一顿。
> 构建脚本现在会在相邻 pose 之间做线性重采样（循环剪辑用环绕插值），帧数翻倍、fps 同比例抬高，
> **动作总时长不变**，但采样密度翻倍。敌人只加 idle / walk / attack1 / hurt，
> 其余剪辑保持原帧数（敌人不使用，省下 ComfyUI 重塑时间）。

同名动画对敌人（grunt / brute / ranger）与 Boss 复用同样命名；敌人的 death 仍是 6 帧 @10fps。

## 4. 目录与命名

```
art-source/blender/
  hero.blend                 # 工程源文件（入库）
  hero/                      # 渲染产物（不入库，可重跑）
    idle/idle_00.png ...
  enemies/grunt.blend
  enemies/grunt/...
assets/sprites/
  hero.png  hero.json        # 精灵表 + 元数据（入库）
```

精灵表 JSON 结构：

```json
{
  "image": "hero.png",
  "cell": [96, 96],
  "anchor": [48, 88],
  "clips": {
    "idle":   { "fps": 8,  "loop": true,  "frames": [[0,0],[96,0],[192,0],[288,0]] },
    "attack1":{ "fps": 14, "loop": false, "frames": [[0,192],[96,192],[192,192],[288,192]] }
  }
}
```

`frames` 是 `[x, y]` 左上角像素坐标，按行优先排布。

## 5. 管线命令（目标形态，Phase 2/3 建成）

```bash
# 1) Blender 渲染帧序列（每剪辑一个目录）
blender -b art-source/blender/hero.blend -P tools/blender/render_clips.py -- --out art-source/blender/hero

# 2) 像素化后处理（缩放 + 调色板量化 + 可选抖动）
python tools/pixelize.py --in art-source/blender/hero --out tmp/hero-px --height 56

# 3) （Phase 3）ComfyUI 像素化重塑，帧间一致性闸门
node tools/comfy/restyle.mjs --in tmp/hero-px --out tmp/hero-restyled --character hero

# 4) 打包精灵表 + JSON
python tools/pack_sprites.py --in tmp/hero-restyled --out assets/sprites --name hero
```

## 6. 验收

- 每剪辑帧数齐全，缺帧必须报错并指出帧号。
- 精灵表 cell 尺寸、anchor、帧矩形与上面一致。
- 目视：剪影可读（缩小到 56 px 仍能看出头/肩/剑），帧间无跳变，无半透明糊边。
- 出场子代理只许改 `art-source/blender/` 与 `tools/blender/`，不得动 `src/`、`assets/`、`tests/`。
