---
name: git-graph
description: 打开当前仓库的 Git Graph 面板，查看分支合并历史、Worktree 状态和提交差异。适用于要求可视化本地 Git 状态的任务。
---

从当前任务取得仓库绝对路径；不要将插件安装目录当作仓库路径。调用插件的 `git_graph_open` 工具并传入 `repositoryPath`。

支持 MCP Apps 的宿主可以通过工具的 UI 资源展示面板。工具还会返回 `panelUrl`。如果侧边面板入口未显示，使用 Codex 的 `open_in_codex` 工具，以 `target.type: "browser"`、`target.url: panelUrl`、`placement: "right"` 打开。没有该工具时，将完整链接提供给用户。

若 MCP 工具尚未加载，可通过 Node.js 运行本技能目录下的 `../../dist/server.mjs --http --repo <仓库绝对路径>`，读取标准输出的完整链接并打开。保持服务进程运行；Windows 后台启动使用隐藏窗口。不要在标准输出中自行拼接访问令牌。

面板支持读取历史、逐文件差异、已加载记录查找、引用历史过滤和两端点比较。写操作仅包含明确工作区的文件暂存/取消暂存、提交 index、创建分支、干净切分支、新分支新目录 Worktree 创建。写入前必须使用 prepare 返回的 actionId，execute 传唯一 operationId，并显示具体对象和结果；不能把打开面板当作授权自动暂存或提交。提交遵循本机 hooks 和签名配置，不绕过失败。不提供 fetch、push、stash、强制切换、丢弃文件或删除 Worktree。远程分支反映最近一次本地获取的状态。读取 Git 数据不需要 GitHub、GitLab 登录，也不应因此修改认证配置。

浏览器入口仅监听运行插件的机器的 `127.0.0.1`。远程 SSH 或 WSL 任务的地址不一定能从桌面直接访问；先检查宿主是否支持 MCP Apps 面板，不能直接访问时说明限制，不公开仓库服务或创建公网隧道。
