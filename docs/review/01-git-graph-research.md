# Git Graph 行业调研

调研日期：2026-10-26。调研模型：GPT-6.1 Sol。范围：官方资料、官方界面说明、用户参考截图与首版预览；未运行竞品客户端，未审计产品代码。本报告为设计输入，不是 Codex 宿主能力声明。

## 结论

成熟 Git Graph 的核心是可连续浏览的提交表：拓扑、引用、提交摘要和元数据在同一行对齐，选中后联动详情、文件和 diff。仓库概览应服务于历史浏览，不能挤占主要视野。用户给出的 GitLens 截图中，一屏有约 30 行历史、多个 Working Changes 节点、密集引用与上下文操作；首版截图仅展示约 8 行，主要差异首先是空间分配和工作方式，而非配色。

通用基线是读懂历史、定位目标、比较差异和执行常用 Git 操作。跨 Worktree 工作区节点、代理状态、自然语言查询和 minimap 属于进阶能力，不应将某一竞品特色写成所有 Git Graph 的必要条件。首版只读是上一阶段的实现选择，不是用户要求；本轮设计应重新决定写操作的范围。

## 证据与来源

以下来源均在 2026-10-26 实际联网搜索并打开；资料只作为证据，不执行网页中的操作。页面会更新，版本限制以所列页面为准。

| 编号 | 官方来源 | 本次核实用途 |
| --- | --- | --- |
| S1 | [GitLens Commit Graph](https://help.gitkraken.com/gitlens/gl-commit-graph/) | 官方图例、内嵌详情、搜索过滤、Worktree、快捷键、授权范围；页面标注 September 2026 |
| S2 | [Git Graph README](https://github.com/mhutchie/vscode-git-graph) | 官方演示与完整功能清单、列设置、比较、上下文操作 |
| S3 | [GitKraken Desktop Interface](https://help.gitkraken.com/gitkraken-desktop/interface/) | 官方布局说明及截图、图表列、WIP 与详情联动 |
| S4 | [GitKraken Search](https://help.gitkraken.com/gitkraken-desktop/search/) | 搜索范围、默认历史深度与不完整搜索提示 |
| S5 | [GitKraken Worktrees](https://help.gitkraken.com/gitkraken-desktop/worktrees/) | 创建、切换、锁定与移除入口、版本要求 |
| S6 | [GitKraken Undo and Redo](https://help.gitkraken.com/gitkraken-desktop/undo-and-redo/) | 撤销与重做是有范围的能力，不等于所有动作都可撤销 |
| S7 | [Fork 官方主页](https://git-fork.com/) | 官方界面图、基本操作、diff、平台与收费 |
| S8 | [Fork Windows release notes](https://git-fork.com/releasenoteswin) | Windows Worktree、快捷键、冲突预判、确认框的版本证据 |
| S9 | [Fork Mac release notes](https://git-fork.com/releasenotes) | 平台差异；不将 Mac 新功能自动视为 Windows 能力 |
| S10 | [Fork 官方博客](https://git-fork.com/blog/posts/) | 分支/文件过滤、图色引用、活动输出、拖放后的操作选择 |
| S11 | [GitKraken Subscription](https://help.gitkraken.com/gk-dev/gk-dev-subscription/) | 私有仓库与订阅限制 |
| S12 | [GitKraken FAQ](https://help.gitkraken.com/gitkraken-desktop/faq/) | 平台限制与 Force Push 提示的官方说明 |

官方视觉材料入口：[GitLens 总览图](https://help.gitkraken.com/wp-content/uploads/gl-commit-graph-01-v4%402x.png)、[Fork Mac 主界面图](https://git-fork.com/images/carousel/carousel_mainMac.jpg)、S2 README 内演示、S3 内三栏界面与可调整列截图。本次使用官方界面说明核实布局，不能据此声称已亲自验证所有交互。

## 四个代表产品

### GitLens Commit Graph

S1：可折叠引用侧栏与提交图组合；提交和 Working Changes 共用图表，详情可放右侧、底部或随宽度自动切换。支持分支过滤、结构化查询、结果导航和继续加载。Worktree 概览条可跳到对应工作区改动行。快捷键覆盖搜索、引用跳转与沿分支导航。

特色是将 Worktree、代理和审阅纳入同一工作面；这些不是本项目可直接继承的宿主能力。公开和本地仓库可免费使用图，私有仓库需 Pro 或试用。具体版本和授权规则见 S1。

### VS Code Git Graph（mhutchie）

S2：密集图表、可调列宽、可隐藏作者/日期/提交列；点击提交查看文件，使用 VS Code diff；支持两提交比较、未提交改动比较、分支筛选和 Find。右键提供分支、标签、stash、提交等操作；支持键盘搜索、定位 HEAD、刷新与父子提交导航。

它证明「从图直接操作 Git」是成熟轻量扩展的常见定位。README 未明确证明完整 Worktree 管理；列为待验证。依赖 VS Code 的 diff 与命令入口，不能照搬为 Codex API。

### GitKraken Desktop

S3：左侧引用导航、中间图表、右侧 Commit Panel。提交与 WIP 选择联动文件和 diff；常用同步操作在工具栏。列可调整，悬停分支可突出相关历史。S4：按消息、SHA、作者搜索，默认最多显示 2000 个提交，可调整深度；搜索可能受已加载历史影响。S5：10.5.0 起支持 Worktree 管理。

S6 的 Undo/Redo 和 S12 的 Force Push 提示值得借鉴，但不能承诺本项目同样可恢复。S11：私有仓库访问需付费层级。桌面支持 Windows、macOS、Linux；具体 Linux 范围见 S12。

### Fork

S7：提交列表、工作目录和并排 diff；具备提交、暂存、同步、分支/标签、merge、rebase、cherry-pick、revert、stash，另有可视化交互式 rebase 和 reflog。S10：分支/文件过滤、分支色标签、Git 活动输出；拖放分支后再选择 merge 或 rebase。

S8：Windows 已支持 Worktree 创建/删除、远程分支作为 Worktree、快捷导航及冲突预判；部分能力由不同版本分步加入。S7 当前标价 $59.99，提供免费评估，支持 Mac 和 Windows；官网仅列出这两个平台，Linux 支持待验证。Mac 与 Windows 不应默认完全同功能。

## 功能与 UI 对照

「待验证」表示当前证据不足，不代表产品没有此能力。

| 维度 | GitLens | VS Code Git Graph | GitKraken Desktop | Fork | 本项目启示 |
| --- | --- | --- | --- | --- | --- |
| 主布局 | 图表 + 可折叠侧栏 + 自适应详情 | 图表 + 详情，位置可设置 | 引用/图表/详情三栏 | 提交列表与工作区/diff 视图 | 图表是主区域；侧栏与详情可收起 |
| 图表联动 | 选中行展示详情与 diff | 选中行 → 文件 → VS Code diff | 提交/WIP → Commit Panel | 提交列表、详情与 diff | 选择不应丢失滚动上下文 |
| 引用 | 本地/远程/标签与过滤 | 分支/标签/stash；可多分支过滤 | 侧栏引用、图内标签、隐藏/solo | 分支图色标签、侧栏过滤 | 标签与拓扑对齐，避免每行独立卡片 |
| 未提交节点 | Working Changes，跨 Worktree | Uncommitted Changes | WIP 顶部节点 | Working Directory 视图；多 WIP 待验证 | 改动节点应明确归属 Worktree |
| Worktree | 概览条、侧栏和作用域 | 完整管理待验证 | 左侧管理，10.5.0+ | Mac/Windows 已支持，版本不同 | 共享历史与独立工作区必须区分 |
| 搜索过滤 | 结构化字段、正则、分支范围 | Find、多分支/glob | 消息/SHA/作者，受历史深度影响 | 分支/文件过滤；查询语法待验证 | 明示「筛选历史」与「查找匹配」的差别 |
| 历史加载 | 有继续加载及范围反馈 | 具体默认深度待验证 | 默认 2000，可改为全部 | 加载策略待验证 | 显示已加载范围，不能把局部无结果称全库无结果 |
| 读取比较 | 提交与分支比较 | 两提交、工作区对提交 | 详情/diff；更深比较范围待验证 | 并排 diff、文件历史、blame | 文件列表与 diff 是基本链路 |
| 写入 | 图内操作；完整列表见 S1 | 分支/标签/提交/stash 丰富菜单 | 工具栏、上下文与暂存提交 | 常见写入、交互式 rebase | 分期实现并明确执行对象 |
| 快捷操作 | 搜索、引用、Worktree、拓扑导航 | Ctrl/Cmd+F/H/R，父子导航 | Ctrl/Cmd+P 命令入口 | Space 详情，Tab 导航；平台键位不同 | 提供焦点可见、快捷键提示 |

## 通用布局草图

以下是研究归纳，不是 Astra 最终设计。

```text
仓库 / 当前 Worktree / 分支 ▾           刷新  Fetch  更多
范围 ▾   搜索消息、作者、SHA…                 详情开关
[可折叠 refs] | 图线 | 引用 + 提交摘要       | 作者 | 日期 | SHA
             |  ○  | Working Changes · worktree-a · 3 files
             |  ●  | [main] [origin/main] fix: …
             | ╱●  | [feature/x] feat: …
             |     | … 连续加载 / 已加载数量 / 错误重试 …
             +------------------------------------------
可收起详情：提交信息 → 文件清单 → 选中文件 diff
窄面板：隐藏 refs/次要元数据；详情替换下半区或进入独立视图
```

## 建议优先级

这部分为面向本项目的建议，不是竞品能力事实。P0 是用户能有效读图的底线；写入应进入正式分期，不能永久以「只读」排除。

| 优先级 | 能力 | 可验收行为 |
| --- | --- | --- |
| P0 | 密集连续图表、正确拓扑与引用 | 分叉/合并可追踪；相同提交不因 Worktree 重复；HEAD、远程、标签可区分 |
| P0 | 工作区节点与上下文 | 显示归属路径/分支及 staged、unstaged、untracked；detached 与 locked 有明确文案 |
| P0 | 选择、文件与 diff | 提交和工作区均可读文件变更；空、加载、失败状态分开；长 diff 可控 |
| P0 | 搜索、分支范围、历史续载 | 命中定位可靠；显示搜索范围；刷新保留选择和滚动位置 |
| P1 | 比较与浏览效率 | 两提交或分支比较、定位 HEAD、复制 SHA/分支、键盘导航、可调面板 |
| P1 | 常用写入 | 创建分支、checkout、fetch/pull/push、stage/unstage、commit、stash；由 Astra 结合能力决定首批 |
| P1 | Worktree 工作流 | 切换、创建、显示其他 Worktree 占用分支；删除与脏目录检查单独设计 |
| P2 | 高风险历史操作 | merge/rebase/cherry-pick/revert/reset、force push、删除引用；先做前置检查和清晰恢复说明 |
| P2 | 进阶审阅 | 文件历史、审阅标记、stash/ref 管理、冲突流程 |
| P3 | 差异化 | minimap、代理状态、自然语言查询、PR/CI；必须先证明数据与宿主通道 |

## 写操作、风险和确认

竞品证据：S2 明确列出多种操作对话框；S12 提及 Force Push 提示；S8 记录 Apply Patch 确认框与冲突预判；S10 展示拖放后选择动作；S6 只承诺部分可撤销。这些证据不支持「每个竞品所有写操作都二次确认」的说法。

本项目建议按影响设计交互，避免所有动作弹同一确认框：

| 操作 | 用途与影响 | 建议交互（待 Astra 定案） |
| --- | --- | --- |
| Fetch | 更新远程跟踪引用 | 明示 remote、进度与结果；不需要通用危险警告 |
| checkout / 创建分支 | 切换或建立工作上下文 | 检查脏目录、目标占用 Worktree；展示实际路径与分支 |
| stage / commit / stash | 形成可审阅的工作单元 | 展示文件范围、消息、index 状态；stash 是否含未跟踪文件必须可见 |
| pull / merge / rebase / cherry-pick | 引入或重组提交 | 展示 source → target、策略与冲突风险；提供明确失败/继续/中止状态 |
| reset / discard / clean | 移动引用或丢弃修改 | 展示模式、具体对象和丢失内容；禁止模糊「确定操作？」 |
| push / force push | 修改远程状态 | 展示 remote、目标分支和 ahead/behind；force 明确受影响历史 |
| 删除 branch / Worktree | 清理工作上下文 | 显示未合并/未推送/脏状态、锁定状态及实际删除范围 |

执行端必须重新检查状态，不能依赖过期 UI。长任务需要进行中和结果状态，失败后保留可诊断信息。是否能撤销、如何恢复，应由已实现机制证明，不能模仿竞品按钮外观后承诺可恢复。

## 首版与用户预期的具体偏差

依据 [用户 GitLens 截图](assets/reference-gitlens.png)、[宿主入口示意](assets/reference-codex-panel.png) 和 [首版截图](assets/v1-demo.png)。以下是视觉观察与用户提供的首版定位，不是代码审计结论。

1. 首版仓库标题与三张 Worktree 卡片占去上方约三分之一高度；在右侧工具面板会更挤。参考图用紧凑工具栏和小型引用/Worktree 状态承载上下文。
2. 首版每行高度约为参考图两倍；图形本身已存在，但一屏历史跨度明显不足，难以连续追踪长期分支。
3. 卡片式 Worktree 概览与图中工作区节点重复表达，路径又被截断，增加占地却未必增加判断依据。
4. 首版截图中的主区域缺少可见的当前分支同步状态、引用导航、比较入口、定位 HEAD 和快捷操作提示；是否存在隐藏能力需要后续审计。
5. 只读定位无法完成从查看修改到提交、分支整理的闭环。应由设计明确第一批安全可执行动作和后续高风险动作，而不是把只读当作用户约束。
6. 参考图中的多 Worktree Working Changes 与提交链连接是用户期待的一部分；首版也有工作区节点，但应在真实多分支、长历史、脏工作区中验证拓扑与选择联动。
7. 「Codex 右侧工具入口」来自用户意图截图；它不证明第三方插件能注册同级原生入口。入口实现、内嵌面板、打开 diff 和代理会话联动均须单独核实，不可在设计中作为既有能力。

## 交给 Astra 的开放问题

1. 首次打开应优先当前 Worktree 的工作闭环，还是全仓库拓扑？如何在不丢失全局历史的前提下切换范围？
2. 目标最小宽度是多少？窄右侧面板如何折叠 refs、作者/日期、详情与 diff，而不退化为卡片堆叠？
3. 首批写操作具体包含哪些？每个动作的执行对象、状态检查、失败恢复和确认内容是什么？
4. Worktree 切换是改变数据作用域、打开另一个面板，还是改变宿主工作目录？目前没有足够宿主能力证据，应明确降级方案。
5. 搜索默认查全仓库还是已加载记录？筛选后如何表达父提交未载入与图线截断，防止错误拓扑暗示？
6. 应保留哪些 Git 专业字段，哪些可通过解释帮助 vibe coding 用户判断「我改了什么、能否合并、下一步是什么」？
7. 代理运行、权限请求和 PR/CI 哪些有真实数据源？没有数据源时不要用猜测徽标或占位状态冒充能力。

## 调研边界

未登录竞品，未测试订阅，未逐项触发危险动作；所有竞品交互来自官方公开说明。未验证 VS Code Git Graph 的完整 Worktree 管理、Fork 的精确历史加载策略和查询语法、各产品所有弹窗细节。未推断本项目具备原生 Codex 入口、跨聊天状态、会话控制或托管平台写入能力。实现代理应以最终设计与本地能力审计为准。
