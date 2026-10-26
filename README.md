# WorkGraph

WorkGraph按工作项展示项目进展，将仓库中的工作记录关联到真实 Git 提交。当前版本支持读取工作状态、查看关联提交和差异，并保留 Git 提交图、分支和 Worktree 管理。

默认进入「工作进展」，读取当前仓库的 `.workgraph.json` 和 HEAD 最近 300 条提交。点击顶部「Git 历史」可切换到原有 Git 操作界面。工作记录需要手动维护，尚未实现自动记录、恢复点或自动验收。配置方法与数据边界见 [WorkGraph 使用说明](docs/work-graph.md)。

现有 Git 历史界面是后续界面的视觉基准。产品概念与实施前决策见[项目开发视图产品概念](docs/project-development-concept.md)。

## 可以用来做什么

- 按工作项查看当前状态、下一步和关联提交，单独查看未提交文件；状态来自工作记录，不代表验证或用户验收。
- 看清提交、合并、分支、标签和多个 Worktree 的关系，定位 HEAD 或比较两个提交。
- 逐文件查看已暂存、未暂存、未跟踪和冲突内容，选择文件暂存，再创建提交。
- 在面板中管理分支、标签、Stash 和远程仓库，执行 Fetch、Pull、Push 及历史操作。
- 用新分支和新目录创建 Worktree，识别已被其他 Worktree 占用的分支。

本地历史读取不需要 GitHub 或 GitLab 登录；远程同步使用本机 Git 的现有认证。

## 开始使用

需要 Node.js 22+、npm 和 Git。当前实测环境为 Windows；其他平台尚未验证。

在终端运行以下命令，将最后一行的路径替换为要查看的仓库：

```powershell
git clone https://github.com/Daoming-Chen/codex-work-graph.git workgraph
cd workgraph
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
- [WorkGraph 工作记录与数据边界](docs/work-graph.md)
- [故障排查](docs/troubleshooting.md)
- [贡献指南](CONTRIBUTING.md) · [架构与安全边界](docs/current-implementation.md)
- [项目开发视图产品概念](docs/project-development-concept.md)（规划，待细化）

## 许可证

仓库目前未提供项目 LICENSE，不能据此认定已授予开源使用、修改或分发许可。第三方素材的声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
