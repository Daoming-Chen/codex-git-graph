# Codex Git Graph

在 Codex 右侧浏览 Git 提交图、分支、标签和多个 Worktree，审阅差异、管理引用并执行 Git 操作。历史读取使用本机 Git；远程同步沿用本机 Git 的认证配置。

## 功能

- 28px 连续提交表、合并父边、引用与 Worktree 标记；深色、浅色和系统主题。
- 脏工作区各有 WIP 节点，空仓库可直接审阅文件并创建首次提交。识别 detached、锁定、失效和裸仓库。
- 查找已加载提交的摘要、作者、日期、引用和 SHA；多引用／通配符筛选、第一父提交、reflog、引用显隐；定位 HEAD、引用跳转、两端点 A → B 树差异和合并父选择。
- 结构化文件清单、已暂存/未暂存/未跟踪/冲突分组、文件级统一 diff。未跟踪文本最多预览 256 KiB，二进制与子模块有明确提示。
- 明确选择文件后暂存或取消暂存；提交仅包含 index，保留未暂存内容。普通提交遵循本机 hooks 和签名配置。
- 创建、切换、重命名和删除分支；检出提交、创建远程跟踪分支；标签创建、详情、签名、删除与推送；Remote 增改删及 Prune。
- Fetch、Pull（快进／合并／变基）、普通 Push 和设置上游。远程分支删除绑定最近获取的 SHA，远程变化时拒绝执行。
- Merge、Rebase、Cherry-pick、Revert、Reset、线性历史 Drop；冲突文件标记解决，继续／中止进行中的操作。
- Stash 保存、应用、弹出、删除、恢复 index、创建分支；指定文件丢弃修改或清理未跟踪文件。
- 历史提交与工作目录比较，查看修改前／后／当前文件，复制路径；提交签名与包含关系；目录分组、列宽调整、日期格式和 Issue／PR URL 模板。
- 审阅进度和仓库配置保存在 Git common dir 的 `codex-git-graph-state.json`，跨服务端口和 Worktree 共用；审阅记录保留 90 天。仓库配置支持导出／导入。
- 默认 300 条历史，每次续载 300 条；单次查询最多 2000 条，可通过分页继续浏览。查找仍只覆盖已加载范围。
- 使用新分支和新目录创建 Worktree，识别被其他 Worktree 占用的分支。

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

分发配置使用根目录 `plugin.json` 和 `mcp.json`，通过宿主支持的 `${PLUGIN_ROOT}` 定位打包服务，不依赖开发仓库路径。目标机器仍需在 PATH 中提供 Node.js 22+ 和 Git。构建生成的 `.mcp.json` 仅供旧版宿主本机开发使用，迁移时应使用根目录的可迁移配置；旧版配置仍需在新位置重新构建。

构建后运行 `node scripts/package.mjs <新目录>` 生成不含本机开发配置的分发包，再将该目录加入目标机器的 marketplace。目标父目录须已存在，脚本不会覆盖现有目录。完整步骤与恢复方式见[可迁移安装与面板生命周期](docs/install-lifecycle.md)。

工具注册官方 MCP Apps 资源及 thread entrypoint。无显式路径时，服务从标准 MCP roots 解析仓库：只有一个可访问的本地 Git 仓库时自动绑定；多个候选或缺少上下文时显示选择提示。面板在连接、宿主上下文变更、重新聚焦及前台轮询时重查 roots；切换仓库会清空详情、筛选和操作输入，并阻止旧请求覆盖新界面。标准 roots 不保证代表当前聊天，原生按钮是否出现、宿主是否提供随聊天变化的 roots，仍需安装后实测。工具返回的 `panelUrl` 也可由 Codex `open_in_codex` 放到右侧浏览器；此回环面板始终绑定打开时的仓库。

服务最多保留 10 个仓库监听器，达到上限时回收最近最少使用且没有请求正在执行的监听器；30 分钟无认证 API 活动的监听器也会回收。关闭后可重新打开，获得新链接和令牌；进程退出会清理监听器。旧链接在回收或重启后失效，需重新调用 `git_graph_open`。服务不会自动重试结果未知的写操作。没有代理运行状态或 PR/CI 状态联动；PR／MR 入口按配置打开创建表单。

回环地址仅表示服务所在主机。SSH、WSL 和跨主机转发尚未验证；不要公开服务或创建公网隧道。

## 读写边界

HTTP 服务绑定单个仓库，只监听 `127.0.0.1`；API 需要随机 Bearer 令牌，校验 Host/Origin，不开放 CORS。GET 只查询，写操作仅 POST JSON。MCP 仅将 `git_graph_open` 暴露给模型；上下文、详情、偏好和 Git 操作接口声明为仅供 App 使用。可见性声明由宿主执行，不构成额外的仓库授权隔离；MCP 继承进程文件权限。

写入经过 prepare/execute：绑定已审阅状态与文件内容指纹，执行前重验、两分钟过期、按 Git common dir 串行执行。operationId 在本进程内去重；重启或另一个服务进程不共享记录。多个 Git 查询不是原子事务，外部进程仍可能在复核后修改仓库。失败保留输入，超时标记结果未知并读取实际 HEAD；不自动重试或清理残留目录。

Git 使用参数数组和 literal pathspec；目标 Worktree 验证 common dir，文件只能来自返回清单。未跟踪文件不读取符号链接目标内容；普通文件指纹流式计算，预览限制读取量。错误输出对常见 URL userinfo、GitHub token 和 token/password/authorization/secret 字段脱敏，但任意 hook 可输出其他私密内容，展开诊断前应留意实际内容。

删除、丢弃、Reset、Rebase 和 Drop 在准备阶段要求明确确认。文件操作绑定其所属 Worktree 和已审阅版本；Stash 操作绑定提交 SHA 与列表状态。同步前应核对目标 Remote 和分支；Fetch 前的远程引用仍是本地最近获取的状态。

不提供普通强制推送、交互式 Rebase 编辑器、Worktree 删除或冲突编辑器。Drop 支持当前分支上的单父线性提交，不支持根提交或跨合并链。冲突内容需先在编辑器中修改，再刷新面板标记解决。URL 模板只打开 Issue／PR／MR 页面，不代为提交表单。文件内容与 diff 显示最多 256 KiB；当前文件查看在面板内完成，不等同于 VS Code 编辑器集成。

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
| `src/remote-actions.mjs`、`src/history-actions.mjs` | 远程引用、历史及工作区写操作校验 |
| `src/review.mjs` | 元数据、历史与工作目录比较、文件内容 |
| `src/preferences.mjs` | 仓库偏好与审阅进度持久化 |
| `src/graph.mjs` | 拓扑与 WIP 布局 |
| `src/http.mjs`、`src/server.mjs` | 共享服务的 HTTP/MCP 传输 |
| `src/ui/` | 同一套响应式面板 |
| `test/` | 真实 Git、通信与压力 fixture |

接口依据：[Plugin Extensions](https://developers.openai.com/plugins/build/extensions)、[MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)、[Package your plugin](https://developers.openai.com/plugins/build/plugins)。
