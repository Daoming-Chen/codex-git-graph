# WorkGraph

WorkGraph（原 Codex Git Graph）以工作进展为产品方向，Git 提供底层版本管理。当前版本提供 Git 提交图、文件差异、分支和 Worktree 管理，并加入使用独立演示数据的工作进展交互原型；真实工作项管理尚未实现。

默认进入工作演示，可从顶部切换到「真实 Git」。演示只保存在页面内存，刷新后重置，不会修改真实 Git。演示步骤与边界见[工作视图交互原型](docs/work-prototype.md)。

现有 GitGraph UI 是后续界面的视觉基准。产品概念与实施前决策见[项目开发视图产品概念](docs/project-development-concept.md)。

本轮统一产品显示名称为 WorkGraph。为保持兼容，仓库地址、包名、插件目录与安装标识、`git_graph_*` 工具及现有配置存储名称暂时保留。

## 可以用来做什么

- 看清提交、合并、分支、标签和多个 Worktree 的关系，定位 HEAD 或比较两个提交。
- 逐文件查看已暂存、未暂存、未跟踪和冲突内容，选择文件暂存，再创建提交。
- 在面板中管理分支、标签、Stash 和远程仓库，执行 Fetch、Pull、Push 及历史操作。
- 用新分支和新目录创建 Worktree，识别已被其他 Worktree 占用的分支。

本地历史读取不需要 GitHub 或 GitLab 登录；远程同步使用本机 Git 的现有认证。

## 开始使用

需要 Node.js 22+、npm 和 Git。当前实测环境为 Windows；其他平台尚未验证。

在终端运行以下命令，将最后一行的路径替换为要查看的仓库：

```powershell
git clone https://github.com/Daoming-Chen/codex-git-graph.git
cd codex-git-graph
npm install
npm run build
npm start -- --repo "D:\path\to\repository"
```

在 Codex 右侧浏览器打开终端输出的完整链接，保持服务运行。按 Ctrl+C 关闭服务。

需要通过聊天打开面板时，按[本地插件安装说明](docs/install-lifecycle.md)配置插件。仓库提供源码构建和本地 marketplace 配置；真实桌面宿主中的安装流程仍需验证。

## 使用前了解

面板可以修改仓库和远程引用。执行前需核对目标仓库、Worktree、分支和操作摘要；删除、丢弃及部分历史重写操作需要明确确认。打开面板本身不代表授权写入。

- 不提供普通强制推送、交互式 Rebase 编辑器或 Worktree 删除。冲突内容需在外部编辑器修改。
- 查找只覆盖已加载的提交；文本预览和 diff 最多显示 256 KiB。
- SSH、WSL 和跨主机访问尚未验证。回环链接指向服务所在机器，不要公开服务或创建公网隧道。
- MCP Apps 原生入口和随聊天切换仓库的行为取决于宿主，不能保证在所有 Codex 版本中可用。

## 文档与贡献

- [安装与打包](docs/install-lifecycle.md)
- [使用指南](docs/usage.md)
- [故障排查](docs/troubleshooting.md)
- [贡献指南](CONTRIBUTING.md) · [架构与安全边界](docs/current-implementation.md)
- [项目开发视图产品概念](docs/project-development-concept.md)（规划，待细化）

## 许可证

仓库目前未提供项目 LICENSE，不能据此认定已授予开源使用、修改或分发许可。第三方素材的声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
