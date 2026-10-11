# 24帧待机原画

- 工具：内置 imagegen，参考人物编辑模式，transparent_background=true。
- 原画：exec-5eae3c8b-d2db-4c86-8b18-8b2beb2d4ef8.png。
- 排列：6列×4行，按行优先。24张独立姿态，不是同图位移复制。
- 打包：scripts/extract-idle-sheet.ps1 统一缩放和脚底位置，保留透明通道；输出24张PNG以及单张运行图集。
- 运行：不再硬切24张完整原画。PetIdlePlayer 从同一图集提取固定基准轮廓和闭眼局部贴片，以 Canvas 2D 连续形变实现6.4秒呼吸/发梢跟随循环，脚底固定，首尾位置和速度连续。眨眼80ms闭合、30ms停顿、130ms睁开。
- 目标60 FPS，隐藏/拖拽/切换模式/减少动态效果时由统一控制器停止 RAF。原24帧文件及图集保留兼容，不额外加载动画库。
- 原AI逐帧原画存在轮廓差异，因此现不使用整图硬切。这是程序化二维形变与局部素材混合，不是Live2D或新增手绘中间帧。

## 生成提示词

Use case: identity-preserve. Create a production-ready transparent 24-frame idle animation sprite sheet by editing/animating the attached character reference. The reference is the character identity and outfit, not a background.
Exactly SIX columns by FOUR rows = 24 separate full-body frames in equally sized cells, chronological row-major left-to-right top-to-bottom. Wide sheet aspect ratio about 3:2 (square cells). No grid lines, labels, numbers, words, shadows on a floor, background objects or extra characters. Genuine alpha transparency throughout the empty area. Each character occupies about 82% of cell height and stays entirely inside its cell with generous transparent margins.
Preserve identical cute chibi anatomy, silver-white hair with teal inner strands, mint green eyes, dark teal knot hair accessory, white sailor blouse with black collar and mint piping, black ribbon with teal emblem, black pleated skirt, white socks and black/teal shoes. Fixed front-facing full-body camera, consistent drawing style and identical scale. Feet anchored at identical cell coordinates, no stepping, walking, jumping, turning or location drift. Small natural motion within each pose, not 24 unrelated poses.
One calm continuous idle loop: frames 1-6 relaxed inhale chest rises subtly, head lifts 1-2%, hair tips trail gently outward; frames 7-9 eyelids smoothly half-close then close; frames 10-12 reopen into a soft content expression at inhale peak; frames 13-18 slow exhale shoulders relax, bow and sleeves settle, hair tips follow softly; frames 19-24 ease to the exact initial neutral pose with tiny trailing hair motion. Draw intermediate eyelid, mouth, shoulder, sleeve and hair details in every frame. No eating, drinking, reading, teleport, props or sleeping. Arms rest naturally down beside the body throughout. Make frame 24 very close to frame 1 for a seamless loop. All 24 are individually drawn in-between frames, with stable line art, silhouette, face identity, fixed foot position and coherent spacing. Transparent pixels, not a painted checkerboard.

Additional packing revision: EXACT 6 columns x 4 rows; transparent margins on all four sides; full-body silhouettes isolated with consistent character size; no marks or props.
