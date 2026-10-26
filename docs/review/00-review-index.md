# Git Graph 评审与重设计索引（归档）

本目录保留历史调研、设计和验证记录。各报告的测试数量、截图和状态仅适用于对应阶段，不代表当前版本已通过相同验收。当前使用请从 [README](../../README.md) 开始；实现边界见[架构说明](../current-implementation.md)。

[2026-10-26 文档核对记录](11-documentation-check.md)保留文档重组前的验证范围与结果。

| 阶段 | 模型 | 范围 | 状态与文件 |
| --- | --- | --- | --- |
| 1. 行业调研 | GPT-6.1 Sol | 四个代表产品的官方功能、界面、限制；首版差距与设计问题 | 已完成：[行业调研](01-git-graph-research.md) |
| 2. 产品设计 | GPT-6 Astra | 适用于 Codex 与 vibe coding 的信息架构、功能分期、交互和验收要求 | 已完成：[设计决定](02-codex-product-design.md)、[实现规格](03-implementation-spec.md)、[独立布局线框](04-design-wireframe.html) |
| 3. 实现与验证 | GPT-6.1 Sol | 按设计实现，核实宿主能力，验证行为与视觉 | 已实现 P0/P1；22 项自动测试通过，四宽度×深浅主题实测；未测子场景单列：[实现报告](05-implementation-report.md)、[视觉 QA](design-qa.md) |

参考材料：[GitLens 用户参考](assets/reference-gitlens.png)、[Codex 入口意图](assets/reference-codex-panel.png)、[首版预览](assets/v1-demo.png)。

交付复核：[主代理独立复核](06-independent-review.md)，包含代码复核修正、实际浏览器检查及当前项目截图。

行业报告仅提供设计证据；不把竞品功能视为本项目或宿主已有能力。首版只读不是用户约束。

第二阶段实际流程截图：[空仓库首屏](assets/design-audit-01-empty.png)、[工作区详情](assets/design-audit-02-working.png)。设计线框为独立 HTML、包含 420/640/960/1280 宽度与空仓库/工作区/比较状态。浏览器安全策略拒绝 file: 协议，因此本阶段未完成该 HTML 的浏览器视觉验证；实现阶段需对实际产品按 A01 验证，不能把设计线框视为已通过的产品截图。


GitLens 偏好专项复核：[三轮 UI 对照审查](07-gitlens-ui-comparison.md)，包含本轮重新截图、同状态宽度与主题复核、视觉差异优先级和后续实施顺序；本轮未修改产品代码。

GitLens 视觉实施：v0.3.0 已按报告改造并完成三轮截图修正，见 [实现与验证](08-gitlens-ui-implementation.md)、[本轮 QA](../../design-qa.md)。历史报告和审查截图保留。

最新视觉反馈：[圆点与渐变行底色](09-row-color-refinement.md)。按用户要求移除节点作者缩写，作者保留在右侧列，并增加从左向右淡出的行底色。

后续功能实现：[VS Code Git Graph 功能对齐](10-git-graph-parity.md)，记录远程引用、历史和工作区操作、分页、文件查看与审阅进度的交付，以及该阶段的测试和剩余限制。仓库上下文解析和服务生命周期的后续实现见本页开头的当前文档。
