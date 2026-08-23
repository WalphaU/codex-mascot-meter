# 参与贡献

感谢你愿意改进 Codex 余额助手。提交代码前，请先确认改动不会改变指标口径或泄露本机 Codex 数据。

## 开发环境

- Windows 10/11 x64
- Node.js 20+
- npm
- Windows PowerShell 5.1 或 PowerShell 7

```powershell
npm install
npm run check
npm test
npm run preview:capture
```

## 提交流程

1. 从 `main` 创建短生命周期分支。
2. 每个提交只处理一个清晰问题，并使用可读的提交信息。
3. 修改日志解析或指标口径时补充自动化测试。
4. 修改界面、人物状态或图表时更新视觉回归截图。
5. 在 Pull Request 中说明行为变化、验证方式和兼容风险。

## 数据安全

请勿提交以下内容：

- `.codex` 目录、JSONL 会话日志或真实提示词。
- 访问令牌、Cookie、账号标识、私有项目路径。
- 包含真实额度、任务名称或用户信息的截图。
- 未经授权的第三方素材或字体。

## 代码约定

- 保持 Electron `contextIsolation` 和 `sandbox` 开启，不在渲染进程启用 Node.js。
- 文件操作必须保持只读，不修改 Codex 日志和配置。
- 优先扩展 `codex-monitor-v2.cjs`，避免恢复旧版监控器。
- 不伪造任务百分比；无法从日志确认时显示实时状态或未知值。
- 界面交互需要兼顾键盘操作和可访问名称。

## 问题反馈

普通缺陷请使用 Bug 模板；安全问题不要创建公开 Issue，请遵循 [SECURITY.md](SECURITY.md)。
