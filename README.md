# Codex Git Graph

在 Codex 右侧浏览本地 Git 提交图、分支、标签和多个 Worktree，逐文件审阅差异并完成本地暂存与提交。数据来自本机 Git，不需要 GitHub 或 GitLab 登录。

## 功能

- 28px 连续提交表、合并父边、引用与 Worktree 标记；深色、浅色和系统主题。
- 脏工作区各有 WIP 节点，空仓库可直接审阅文件并创建首次提交。识别 detached、锁定、失效和裸仓库。
- 查找已加载提交并导航命中；按完整引用查询可达祖先；定位 HEAD、引用跳转、两端点 A → B 树差异和合并父选择。
- 结构化文件清单、已暂存/未暂存/未跟踪/冲突分组、文件级统一 diff。未跟踪文本最多预览 256 KiB，二进制与子模块有明确提示。
- 明确选择文件后暂存或取消暂存；提交仅包含 index，保留未暂存内容。普通提交遵循本机 hooks 和签名配置。
- 创建分支、完全干净的工作区切换本地分支、使用新分支和新目录创建 Worktree。
- 默认 300 条历史，按 300 条续载，最多 2000 条；查找只覆盖已加载范围。

## 开发与打开

需要 Node.js 22+、npm 和 Git。当前验证环境为 Windows；其他平台没有实测保证。

```powershell
npm install
npm run build
npm start -- --repo "D:\path\to\repository"
```

在 Codex 右侧浏览器打开服务输出的完整回环链接。服务需保持运行；按 Ctrl+C 结束。未传 `--repo` 时使用当前目录。

```powershell
npm run demo
```

演示命令只在 `.test-output/` 下创建独立仓库，不修改本项目历史。演示中的写操作会改变该测试仓库。

## 安装本地插件

1. 运行 `npm run build`。`plugins/codex-git-graph/dist/` 包含打包服务和自包含面板。
2. 将 `marketplace.example.json` 的插件条目合并到 `.agents/plugins/marketplace.json`，保留已有配置。
3. 重启 Codex，在插件目录选择「Git Graph · 本地开发」并安装。
4. 在目标仓库聊天中输入「打开当前仓库的 Git Graph，显示所有 Worktree」。技能将明确的仓库路径传给 `git_graph_open`。

构建生成的 `.mcp.json` 使用本机 Node.js 与构建文件绝对路径。移动仓库、更换 Node.js 或换机器后需重新构建并刷新插件；此包面向本地开发安装。

工具注册官方 MCP Apps 资源及 thread entrypoint。本机原生 stdio 固定工具入口仍未完成安装后验证，不能承诺出现永久 Git Graph 按钮。已验证的入口是工具返回 `panelUrl`，再由 Codex `open_in_codex` 放到右侧浏览器。不会自动跟随聊天切换仓库，也没有代理运行状态或 PR/CI 联动。

回环地址仅表示服务所在主机。SSH、WSL 和跨主机转发尚未验证；不要公开服务或创建公网隧道。

## 读写边界

HTTP 服务绑定单个仓库，只监听 `127.0.0.1`；API 需要随机 Bearer 令牌，校验 Host/Origin，不开放 CORS。GET 只查询，写操作仅 POST JSON。MCP 写工具独立声明可写；MCP 继承进程文件权限，没有额外的仓库授权隔离。

写入经过 prepare/execute：绑定已审阅状态与文件内容指纹，执行前重验、两分钟过期、按 Git common dir 串行执行。operationId 在本进程内去重；重启或另一个服务进程不共享记录。多个 Git 查询不是原子事务，外部进程仍可能在复核后修改仓库。失败保留输入，超时标记结果未知并读取实际 HEAD；不自动重试或清理残留目录。

Git 使用参数数组和 literal pathspec；目标 Worktree 验证 common dir，文件只能来自返回清单。未跟踪文件不读取符号链接目标内容；普通文件指纹流式计算，预览限制读取量。错误输出对常见 URL userinfo、GitHub token 和 token/password/authorization/secret 字段脱敏，但任意 hook 可输出其他私密内容，展开诊断前应留意实际内容。

不提供远程获取/推送、stash、merge/rebase、历史重写、force、丢弃或删除操作。远程引用是本地最近获取的状态。

## 开发验证

```powershell
npm run build
npm run check
npm test
```

测试只在 `.test-output/` 创建和修改独立 fixture。受限环境可能阻止回环连接或 Git 子进程，需在允许这些操作的本地终端运行。实现与实测范围见 [第二版报告](docs/review/05-implementation-report.md)。

| 文件 | 职责 |
| --- | --- |
| `src/git.mjs` | Git 查询、NUL 解析与有界 diff |
| `src/actions.mjs` | 文件清单、逐文件 diff、prepare/execute 和版本校验 |
| `src/graph.mjs` | 拓扑与 WIP 布局 |
| `src/http.mjs`、`src/server.mjs` | 共享服务的 HTTP/MCP 传输 |
| `src/ui/` | 同一套响应式面板 |
| `test/` | 真实 Git、通信与压力 fixture |

接口依据：[Plugin Extensions](https://developers.openai.com/plugins/build/extensions)、[MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)、[Package your plugin](https://developers.openai.com/plugins/build/plugins)。
