# 贡献指南

## 开发环境

需要 Node.js 22+、npm 和 Git。在仓库目录执行：

```powershell
npm install
npm run build
npm run check
npm test
```

`check` 只做部分入口文件的语法检查，不能代替测试。测试在 `.test-output/` 创建和修改独立 fixture；受限环境可能阻止回环连接或 Git 子进程，应记录实际报错，并在允许这些操作的本地终端复查。

需要交互查看时，构建后运行：

```powershell
npm run demo
```

演示会在 `.test-output/` 创建独立仓库，不修改本项目历史。面板中的写操作会改变演示仓库。

## 修改与验证

保持改动范围清晰，说明解决的问题、行为变化和实际执行的验证。涉及 Git 写操作时，测试应覆盖目标校验、仓库状态变化、失败与冲突路径；不要用开发仓库验证破坏性操作。

插件打包逻辑的测试位于 `test/packaging.test.mjs`，上下文、面板生命周期和偏好存储测试分别位于对应的 `workspace-*`、`panel-manager`、`preferences` 测试文件。涉及这些行为时运行对应测试；真实桌面宿主行为需另行实测，不能由模拟宿主测试代替。

文档按读者任务分工：README 提供入口；安装、使用和故障排查解释用户操作；[架构说明](docs/current-implementation.md)记录内部边界。功能变化先更新负责该事实的文档，其他页面只保留简短说明和链接。

## 报告问题与提交改动

在 [GitHub Issues](https://github.com/Daoming-Chen/codex-git-graph/issues) 报告问题时，请提供版本或提交 SHA、操作系统、Node.js／Git／Codex 版本、启动方式、复现步骤，以及预期和实际结果。附上必要的错误信息或截图；分享前删除令牌、私有仓库地址和敏感文件内容。

提交改动的基本流程：

1. Fork 仓库并创建工作分支。
2. 完成修改，按影响范围更新文档。
3. 运行相关验证，在 PR 中说明执行结果和未验证范围。
4. 向本仓库提交 Pull Request，说明问题和修改后的行为。

仓库目前没有项目 LICENSE，项目许可证尚未确定。第三方声明不等同于项目授权，以上贡献流程也不构成使用或分发授权。

## 架构与历史资料

实现入口和安全约束见[架构与安全边界](docs/current-implementation.md)。`docs/review/` 是历史调研、设计和验收档案，不是当前使用说明；需要追溯时参阅[归档索引](docs/review/00-review-index.md)。

