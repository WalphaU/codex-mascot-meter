<div align="center">
  <img src="src/assets/app-icon.png" width="104" alt="Codex 余额 Plus 图标" />
  <h1>Codex 余额 Plus（社区版）</h1>
  <p><strong>看看 Codex 还剩多少额度，也让桌面多一个会呼吸、会眨眼的小伙伴。</strong></p>
  <p>Windows x64 · v0.4.0 · Electron 38 · 源码 MIT</p>
  <p><a href="https://github.com/WalphaU/codex-mascot-meter/releases/latest">下载最新版</a> · <a href="CHANGELOG.md">与原版有什么不同</a> · <a href="#从源码运行">从源码运行</a></p>
</div>

这是原「Codex 余额助手」的升级版。它会跟随 Codex 当前选中的本地项目，显示任务进度、Token 消耗和账号用量窗口；想让桌面清爽一点时，也可以切成只显示人物的动态桌宠。

本项目是非官方社区工具，与 OpenAI 没有隶属、赞助或背书关系。

## 相比原来的 v0.2.6

- **新增动态桌宠。** 保留精简模式和详细面板，增加连续呼吸、眨眼、点击点头、拖拽挣扎和松手落地反馈。
- **两种额度一起看。** 同时显示 5 小时和周额度，各有重置倒计时；任一窗口剩余不超过 10% 时提醒，原版为主窗口不超过 20%。
- **面板更省地方。** 详细窗口从 432×800 缩到 432×680 DIP，高度减少 15%。移除「最近项目日志」列表，保留字号、统计、趋势图和运行信息。
- **显示和切换更稳。** 补全模型与推理强度读取；低额度状态下继续显示任务进度；从屏幕边缘展开时校正面板位置。

这里直接对比原仓库和当前版本，中间开发记录不展开。完整说明见 [更新日志](CHANGELOG.md)。

## 三种显示模式

| 精简桌宠 | 详细面板 | 动态桌宠 |
|---|---|---|
| ![精简桌宠](artifacts/widget-compact-preview.png) | ![详细面板](artifacts/widget-detail-preview.png) | ![动态桌宠](artifacts/widget-dynamic-preview.png) |
| 项目、进度和两种额度 | Token、趋势图和运行信息 | 待机、点击、拖拽和落地 |

截图使用演示数据。

点击精简模式左上角的人物按钮进入动态桌宠；点击人物或详细按钮打开数据面板。在动态模式下，把鼠标移到人物附近即可看到返回按钮。人物与返回按钮之间留有悬停区域，移动过去时按钮不会立刻消失。

动态桌宠支持鼠标拖动，也可以聚焦后按 Enter 或空格触发互动。连续点击会合并为一次回应，拖拽可以立即打断动作。当前版本安静待机，不会定时随机走动、睡觉或传送。

## 下载与使用

1. 在 [Releases](https://github.com/WalphaU/codex-mascot-meter/releases/latest) 下载 `Codex-Meter-Plus-v0.4.0-windows-x64.zip`。
2. 完整解压，保留 resources、DLL、PAK 等文件，不要只移动 EXE。
3. 双击 `Codex余额Plus.exe`，然后在 Codex 中选择一个本地项目。

从旧版升级时，先退出旧桌宠，再把新版解压到新文件夹运行。旧目录可以保留，方便需要时切回去。

系统要求：Windows 10/11 x64，且本机已经使用过 Codex。EXE 尚未进行商业代码签名；Windows SmartScreen 可能提示「未知发布者」。

## 指标口径

| 指标 | 来源与含义 |
|---|---|
| 5 小时 / 周额度 | 本机日志中最新账号级窗口的 `100 - used_percent`；不是现金余额 |
| 低额度提醒 | 任一可用窗口剩余比例不超过 10%；完成状态会短暂优先展示 |
| 当前任务消耗 | 当前项目最近用户会话的累计 `total_token_usage.total_tokens` |
| 项目累计消耗 | 按项目分配和根路径聚合主会话与子会话，保留累计高水位 |
| 缓存命中 | 项目累计 `cached_input_tokens ÷ input_tokens` |
| 任务进度 | 有 update_plan 时展示步骤进度；运行中没有计划时显示进行中 / LIVE，不编造百分比 |
| 模型与推理强度 | 读取任务上下文和 thread_settings_applied，必要时沿用项目最近的有效设置 |
| 输出速度 | 最近有效输出 Token 样本的增量除以时间；超过两分钟没有样本时不继续显示旧速度 |
| 消耗历史 | 按天汇总，点击日期查看分时数据；支持键盘、滑块和箭头 |

任务是否完成仍以 Codex 完成事件为准。完成状态最多展示 15 秒，也可以点击人物提前结束展示。

## 从源码运行

需要 Node.js 20+、npm 和 Windows PowerShell。

```powershell
npm install
npm start
npm run check
npm test
```

默认跟随 Codex 当前项目，也可以指定目录：

```powershell
$env:CODEX_METER_PROJECT = 'C:\path\to\project'
npm start
```

构建便携版：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-portable.ps1
```

默认输出到 `dist/Codex-Meter-Plus-win32-x64`，已有目录不会被覆盖。可用 CODEX_METER_PORTABLE_TARGET 指定项目目录内的新输出路径。

使用便携版运行时做界面验证和截图：

```powershell
$env:CODEX_METER_ELECTRON_RUNTIME = (Resolve-Path 'dist/Codex-Meter-Plus-win32-x64').Path
npm run test:interaction-smoke
npm run test:drag-smoke
npm run test:pet-animation-smoke
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-electron-smoke.ps1 -Script scripts/pet-entry-smoke.cjs
npm run preview:capture
```

## 运行开销

原有的增量日志读取、快照复用、IPC 去重和图表按需重绘继续保留。新增动画使用本地图集和 Canvas 2D 连续补间，不需要额外安装动画运行库；这是程序化二维动画，不是 Live2D。待机目标为 60 FPS，实际帧率取决于设备负载。

隐藏窗口、退出动态模式或开启系统「减少动态效果」后，会停止待机绘制。素材加载或绘制失败时回退静态人物，额度与任务面板仍可使用。

实现细节见 [架构说明](docs/ARCHITECTURE.md)，贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 隐私与授权

应用只读访问本机 Codex 状态与会话日志，不修改账号、配置和会话数据，也不上传提示词、项目文件或日志。结果依赖本机日志格式与更新时间，上游变动可能需要适配。

源码采用 [MIT License](LICENSE)。人物、图标、动画图集和截图的授权边界见 [ASSET_LICENSE.md](ASSET_LICENSE.md)，安全问题请参阅 [SECURITY.md](SECURITY.md)。Codex、ChatGPT、OpenAI 及其标识归各自权利人所有。
