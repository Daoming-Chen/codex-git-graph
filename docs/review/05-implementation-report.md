# 第二版实现与验证报告

日期：2026-10-26。实现模型：GPT-6.1 Sol。版本：0.2.0。依据 [研究](01-git-graph-research.md)、[Astra 设计](02-codex-product-design.md) 和 [实现规格](03-implementation-spec.md) 完成 P0/P1 本轮功能。此处区分已实现、自动测试、浏览器实测与尚未验证，不将未测项计为通过。

## 交付范围

重写为两行工具栏、28px 连续提交表和布局内详情；加入真实可达历史范围、查找命中导航、引用/HEAD 跳转、端点比较、结构化文件清单和逐文件 diff。实现文件暂存/取消暂存、仅提交 index、创建分支、干净切分支、新分支新目录 Worktree 创建。HTTP 与 MCP 使用同一服务实现。

新增 `src/actions.mjs` 承载文件详情、指纹与 prepare/execute。`src/git.mjs` 保留 Git 参数数组与 NUL 解析，补引用范围及真实浅克隆边界；`src/graph.mjs` 补 unborn 节点和未载入父边终止。`src/ui/` 重写布局与交互。更新 README、插件技能、manifest 和通信测试；版本在 package/lock、服务、UI 与 manifest 中统一为 0.2.0。

未暂存、提交或切换本项目；未改全局 Git 配置、未发布。写操作只在 `.test-output/` 下新建的独立 fixture 进行。保留 `.test-output/v1-baseline` 与原预览。报告不保存短期访问令牌。

## D01–D12 追踪

| 决定 | 实现与证据 | 状态 / 限制 |
| --- | --- | --- |
| D01 | `src/ui/`：40px + 36px 工具栏、28px 表头/历史行、24px 状态栏；删除大标题和卡片 | 已实现，四宽度浏览器测量行高均 28px |
| D02 | snapshot 的全历史与 scope 查询；活动 Worktree 独立于提交选择 | 已实现，选择别的对象不改变操作工作区 |
| D03 | WIP 稳定路径 ID，连各自 HEAD；真实 SHA 唯一，干净 Worktree 标在 HEAD | 已实现，多个 Worktree 同父、真实 merge 与 detached fixture 已测 |
| D04 | 1280 默认右侧 360px；其余默认底部；导航、关闭/展开/返回和底部切换 | 已实现，420 抽屉 279px，无详情时可见 21 行 |
| D05 | Git 查询实际 ref 可达祖先；查找仅已加载记录、Enter/Shift+Enter、零结果不隐藏图 | 已实现，Git 集合自动对照及浏览器实测 |
| D06 | HEAD/ref 解析为 immutable SHA；两端点 A → B、交换/退出、父选择、复制 SHA | 已实现，浏览器验证真实 merge 父 2 和引用比较 |
| D07 | NUL 结构化清单；逐文件读取，staged/unstaged 分开；有界未跟踪预览、行号/符号、二进制/rename/submodule | 已实现；符号链接真实运行受 Windows EPERM 限制，见 A07 |
| D08 | 六种白名单动作及具体表单，正常 commit hooks，无自动 stage/push/stash/force | 已实现；真实 Git 测试与浏览器 stage→unstage→commit 完成 |
| D09 | unborn 直接可选；detached 历史、locked 原因、prunable/error、裸仓库无写入口 | 已实现并有真实 fixture 测试 |
| D10 | 已审阅 version、内容 SHA-256、HEAD/index/identity、队列、操作结果、幂等 ID、异步请求序号、刷新锚点 | 已实现；仅本进程协调，非跨进程事务；乱序/超时未故障注入 |
| D11 | 系统字体、12px 控件/代码、13px 详情；深浅/系统主题，克制边框与选中背景 | 已实现；八张实际截图；六组主要文字对比度已计算 |
| D12 | 无占位远程按钮、代理/会话/PR 状态；保持 MCP Apps + 回环浏览器双通道 | 已实现；原生固定入口仍未安装后验证 |

## A01–A15 验收证据

「部分验证」表示功能存在，但该验收行包含尚未实测的子场景。

| ID | 结果 | 实际证据与未覆盖项 |
| --- | --- | --- |
| A01 | 通过本轮布局检查 | CUA 的 iab viewport 直接设置 420/640/960/1280 × 720，深浅两主题各截图。页面均无横滚；28px 行高。420/640/960 历史滚动区高 313/332/332px，约 11/11/11 个完整行；1280 为 592px、约 21 行。关闭详情后 420 为 592px、21 行。420 导航抽屉、展开/返回详情已操作。1280 右详情宽 359px（含边框总 360px）。 |
| A02 | 部分验证 | 真实分叉/二父 merge/3 Worktree 与 detached 读取通过；父关系来自 `git log`，WIP 拓扑单测。octopus、多 WIP 同父、加载边界有布局单测，未创建真实 octopus Git fixture。 |
| A03 | 通过 | 独立 unborn fixture：未跟踪预览、暂存、取消暂存、首次 index 提交；根提交文件与 diff 验证。 |
| A04 | 通过已测状态 | 真实 detached、locked、裸 clone；移动 fixture 的 detached 目录形成失效 Worktree，snapshot 显示 prunable/error 且 status=null、详情拒绝；locked Worktree 实际暂存成功。 |
| A05 | 通过 | 引用 scope 集合逐项与 `git rev-list` 对照；浏览器 feature 范围从 47 条变为 2 条，零查找结果仍保留 2 行，Enter 与 Shift+Enter 导航 1/2、2/2，Esc 清除。2000 上限与 hasMore 通过测试。 |
| A06 | 部分验证 | 浏览器验证刷新后选择、提交页签、消息保留；提交后选择新 SHA。源码按稳定 id 恢复首可见行/偏移，detail/diff/refresh 独立序号拒绝迟到响应。未做网络乱序或读取失败的故障注入。 |
| A07 | 部分验证 | 真实 rename、Unicode/空格名、二进制、submodule gitlink、大 diff/未跟踪截断测试通过。NUL 换行名与冲突解析有单测；Windows 无法创建换行文件名。实际 symlink 创建返回 EPERM，未通过真实链接测试；代码使用 lstat/readlink、realpath 边界，不跟随链接预览目标内容。 |
| A08 | 通过 | 根提交空树、merge 两父、明确 A/B 查询；浏览器父 2 展示 theme.css；feature → main 及交换为 main → feature，标题保持树差异方向。 |
| A09 | 通过 | 真实 stage/unstage，unborn 的取消暂存保留内容；部分暂存文件只提交 index，未暂存内容仍在；重复 operationId 返回同结果；从 linked 入口重复调用也共用 common-dir 去重。浏览器完成 README stage→unstage，再仅提交预先暂存 rename，生成 `4f6f6d11aac74552b1236eb92489f3f690c461f3`，详情选中新提交，README 改动保留。 |
| A10 | 部分验证 | 脏切分支、其他 Worktree 占用、内容/作者改变、index.lock、hook 失败均有真实测试；hook 未绕过，index 保留，常见凭据输出脱敏。超时/连接失联结果未知及排队过期为实现与代码审查，未故障注入验证。 |
| A11 | 通过已测输入 | 真实 branch/switch/new Worktree；重复分支、存在目录、现有 Worktree 内目标、非法名和越界文件拒绝。合法目标 ref/HEAD/目录实际核对。路径穿越和元数据目录限制已实现；无自动删除/force。失败残留逐项返回，但未诱发创建中途失败。 |
| A12 | 通过本机样本 | fast-import 创建真实 2001 commits，20 Worktree，1000 未跟踪文件。最终一轮 snapshot300=486ms、snapshot2000=481ms、files1000=693ms。300/2000 返回限额与 hasMore 正确。浏览器提交消息刷新保留，无无限历史加载；DOM 最多受 2000 上限约束，未实施虚拟列表。耗时仅为此次 Windows 机器观测。 |
| A13 | 部分验证 | 实操查找键、Enter/Shift+Enter、Esc、历史 ArrowDown；所有核心动作使用原生按钮/表单。主要文字六组对比度 4.94–15.43。未实测读屏、200% 浏览器缩放；未宣称完整 WCAG 通过。 |
| A14 | 通过已测边界 | HTTP 无 token=401、敌对 Origin/Host=403、GET execute=405、POST snapshot=405；带凭据 POST prepare/execute 真建分支且重复操作去重；拒绝 shell 动作与恶意 SHA/path。MCP prepare/execute 真建分支、错误传播及写工具注解通过；打包 stdio 握手通过。body 上限/过期为代码检查，未逐一攻击覆盖。 |
| A15 | 部分验证 | 同一真实 fixture UI 在 Codex iab 实测；既有真实当前项目右侧浏览器入口由前阶段确认，本实现不操作其 Git。MCP in-memory 与打包 stdio 协议测试通过；固定原生入口、SSH/WSL 转发没有安装后验证。无假联动。 |

## 安全契约与实现决定

1. 工作区写入必须传已审阅 detail.version；prepare 不能静默接受点击前已变更的内容。version 包含状态、HEAD、branch、index 条目指纹、全部改动文件内容指纹、作者姓名邮箱、进行中操作。Git identity 中时间戳不参与指纹，避免每秒伪陈旧。文件内容流式计算 SHA-256；未跟踪预览只读取前 256 KiB。
2. prepare 有效两分钟，执行前和出队时重验；common Git dir 作为队列与 operationId 的键。去重记录保存在内存，重启、多进程不共享；没有宣称完全原子。外部进程仍可能在最后复核之后改动 Git/文件系统。
3. Git 参数数组、literal pathspec、完整引用或 SHA 解析、check-ref-format、动作与 payload 字段白名单。Worktree 检查真实 common dir；新目标父目录规范化，拒绝已有目录、路径穿越、现有 Worktree 与 Git 元数据目录内目标。不覆盖、不清理残留。
4. unborn 取消暂存使用 update-index --force-remove，只移除 index 条目，保留工作文件；有 HEAD 时使用限定路径的 reset HEAD。未提供 discard/reset 历史入口。
5. 正常 commit 保留 hooks/签名。结果包含 operationId、动作、目标、时间、成功/失败/未知和实际 SHA；hook 错误保留消息。常见 URL userinfo、GitHub token 和 token/password/authorization/secret 字段脱敏，不保证识别任意 hook 自定义秘密。
6. 窄屏文件列表改为 56px，仍满足「最多 112px」，换取 420/640 的 96/77px diff 区。diff 已有文件/基准标题，隐藏重复的 diff --git/index/---/+++ 文件头，保留 hunk、rename、mode、submodule 与内容行。选中文件始终滚入文件栏。此为浏览器视觉问题的修正。
7. 复杂图的图列内部可横滚，同一 offset 在所有行同步；不让每一行单独错位。边界父不保留虚假长期 lane；真实 shallow 文件标识节点并从 commit 对象读取真实父 ID，绘制终止虚线。
8. 新分支表单默认 codex/，默认不切换；Worktree 仅新分支+新目录。detached 的普通提交按规格禁止；未实现隐式创建/切换或自动 stash。
9. manifest 使用官方支持的 Read/Write，依据 [Package your plugin](https://developers.openai.com/plugins/build/plugins) 的 interface.capabilities 示例；不新增宿主枚举或聊天 API。

## 验证命令与结果

最终执行：`npm version 0.2.0 --no-git-tag-version`（只改包元数据，不生成 Git 提交/标签），`npm run build`、`npm run check`、`npm test`。build/check 成功；22 tests passed、0 failed，总耗时 46.5 秒。新增测试在 `test/actions.test.mjs`、`test/performance.test.mjs`，扩展 `test/transport.test.mjs`。

初次受限运行发生 loopback EACCES 与 clone 失败；正常权限重跑后通过，因此没有将受限环境误报为产品失败。初测还发现 MCP 新工具缺少 UI meta、identity 时间戳伪陈旧及两项旧断言与新写能力不符，均已修正后全量重跑。

浏览器使用 CUA 的 iab 和其 Playwright 接口；没有直接使用 Playwright CLI/MCP。四宽度由 viewport capability 真实设置，未用截图缩放冒充。核心流程包括 HEAD、WIP、ref 范围、查找、父选择、端点比较、暂存/取消暂存、提交和布局控制。最终浏览器 error/warn 日志为空。未实测的项目已在验收表列明。

## 截图与视觉复核

| 宽度 × 720 | 深色 | 浅色 |
| --- | --- | --- |
| 420 | [截图](assets/v2-420-dark.png) | [截图](assets/v2-420-light.png) |
| 640 | [截图](assets/v2-640-dark.png) | [截图](assets/v2-640-light.png) |
| 960 | [截图](assets/v2-960-dark.png) | [截图](assets/v2-960-light.png) |
| 1280 | [截图](assets/v2-1280-dark.png) | [截图](assets/v2-1280-light.png) |

其他证据：[真实提交结果](assets/v2-commit-completed.png)、[端点比较](assets/v2-compare.png)、[参考与实现合图](assets/v2-reference-comparison.png)、[连续行局部比较](assets/v2-row-comparison.png)、[视觉 QA](design-qa.md)。截图使用独立真实 fixture；最终四宽度截图已在提交后保留 README 与未跟踪文件两项修改的状态拍摄。

原线框的 file: 打开曾被浏览器安全策略拒绝，本轮没有绕过；未将其标为已验证。参考图是密度与工作方式来源，最终规格为 Astra 重设计，不追求 GitLens 品牌、minimap、代理状态或宿主外壳的逐像素复制。

## 运行状态与剩余限制

测试预览在独立 fixture `.test-output/repo-FlBHaA/studio 中文` 上保持运行，PID 26104，回环地址仅通过交接消息提供，不将随机令牌纳入文档。原用户预览未停止。浏览其他 Worktree 不改变 Codex 聊天或工作目录。

尚需后续环境验证：真实符号链接预览、非 Windows 文件名边界、真实 octopus fixture、网络乱序/超时故障注入、读屏与 200% 缩放、原生固定入口和远程转发。没有开放远程 Git 操作、历史重写、清理/删除、代理或 PR/CI 的占位入口。
