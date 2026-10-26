# GitLens UI 改造实现与验证

日期：2026-10-26。实现模型：GPT-6.1 Sol；主代理独立复核并收尾文档。版本：0.3.0。依据：[07 对照审查](07-gitlens-ui-comparison.md) 和用户提供的 [GitLens 原图](assets/reference-gitlens.png)。未修改 07 的历史结论，未创建 Git 提交。实现代理在代码、测试、截图和本报告主体完成后遇到模型容量错误，最终 QA 与记录核验由主代理接手。

## 结果与范围

提交历史成为默认主视图：导航折叠，详情按需打开，宽屏默认底部详情。24 px 行高、18 px 作者缩写节点、彩色引用和中性灰蓝选择背景替换原来的疏松灰绿表格。保留真实 Git、Worktree、WIP、查找、父比较、文件 diff、暂存、提交、分支和 Worktree 操作及原有检查契约。

源码主要变更为 `src/ui/app.js`、`src/ui/style.css`、`src/ui/icons.js`；构建脚本随插件分发 Codicons 许可；包、插件、MCP UI 与服务版本统一为 0.3.0。`src/actions.mjs` 与 `src/graph.mjs` 未改。本轮没有新增 Git 写入能力。

## 07 条目映射

| 07 条目 | 实现 | 边界与取舍 |
| --- | --- | --- |
| 1 历史区占比 | 首次载入仅选择操作工作区对应对象，不打开详情，不自动滚离最新历史；默认折叠导航、底部详情；导航/停靠位置记忆 | 详情开闭和当前选择不跨重载保存；首次 Enter / 顶部详情均会加载对象并定位选中行 |
| 2 作者节点 | 18 px lane 色边与淡色底，9 px 真实作者缩写；WIP 为 18 px 虚线环；merge 边缘加粗 | 不联网获取头像；中文作者取前两个字符。lane 间距同步改为 20 px，密集图未见圆相撞 |
| 3 引用 | 使用官方分支/cloud/tag 图标；宽屏最多展示 3 个引用，标签最长 230 px；本地分支与同提交的真实 upstream 复合显示，tracking 信息可见 | 同 SHA 但没有 upstream 的分支独立呈现。超额引用菜单保留；窄屏压为首引用与计数 |
| 4 密度 | 默认 24 px 行高；SVG 高度、节点中心、曲线边界、滚动锚点共用 ROW_HEIGHT；lane 间距共用 LANE_WIDTH | 未重写 frontier 图算法；原图线行为测试继续适用 |
| 5 选中 | 深色灰蓝 `#28343e`，浅色 `#e4ecf3`，细边；焦点仍有独立轮廓 | diff 增加行/文件状态保持绿色 success，避免被选择颜色带偏 |
| 6 行操作 | 固定 28 px 操作列，Codicons 省略号；宽屏 hover/selected/focus 显示，窄屏持续可见；摘要保留间隔 | 按钮仍参与键盘焦点；修复历史 Enter 冒泡拦截行内按钮的问题 |
| 7 WIP | 独立分支标签、斜体摘要、真实改动总数徽章，tooltip 展示 staged/unstaged/untracked/conflict；WT 徽章保留 | 点击 WIP 分支标签浏览对应工作区，不将 detached Worktree 的 HEAD 错解为服务工作区 HEAD |
| 8 工具栏/列 | 官方 Codicons 紧凑工具栏，搜索为主控件；命中按钮无查询时隐藏；作者/日期/SHA 列可配置并持久化；主题记忆 | 跟随系统保存 system 模式并监听系统变化。活动概览/minimap、宿主标签栏、健康横幅本轮不做；避免占用 420 px 空间和制造无后端占位按钮 |

配色在同一图布局内沿 lane 贯穿，引用继承所在提交 lane 色。当前算法按载入拓扑分配颜色，**未承诺跨不同 scope、历史增删后的全局固定分支颜色**；没有用随机引用颜色伪装跨范围稳定性。

## 独立真实 fixture

`scripts/v3-preview.mjs` 在 `.test-output/` 建立独立 Git 仓库，原有用户预览与真实项目没有被写入。该 fixture 含 71 条提交、6 位作者、长中文/英文摘要、5 次多父 merge、同提交 tag、真实 upstream、同 SHA 无关联分支、3 个 Worktree、staged/unstaged/untracked 状态。合成提交通过真实 `git commit-tree` 和引用生成，UI 数据仍来自真实 snapshot；不是注入浏览器的假响应。五 lane 视觉压力不等于已覆盖八 lane 以上视觉验收。

## 三轮截图与修正

所有产品截图均经 CUA 操作实际预览并保存，未用构建成功替代渲染验证。合图保留原像素、不缩放源文件；合图增加的说明栏已明确标注。参考图为 1265 × 1042 px，宿主 DPI 未知；实现为 1× CSS 像素。数据和宿主不同，不比较分支数量与提交内容。

| 轮次 | 实际观察 | 修正 | 后验证据 |
| --- | --- | --- | --- |
| 1 整体空间 | [首轮](assets/gitlens-v3-r1-before.png) 已紧凑，但初始自动打开 WIP 详情并滚到旧 HEAD，历史中心仍不成立 | 首载只设置选择与 detailInput，详情按需打开，保持历史顶端 | [全高历史](assets/gitlens-v3-r1-after.png)、[参考合图](assets/gitlens-v3-compare-r1.png) |
| 2 节点引用 | 7 px 缩写过小，空心节点辨识弱，中文作者尤其明显；同 SHA 未关联分支需与 upstream 区分 | 节点 18 px、文字 9 px、lane 淡色底；语义图标与 upstream 复合标签；WIP 标签绑定真实工作区；补行可访问名称 | [节点与引用](assets/gitlens-v3-r2-after.png)、[参考合图](assets/gitlens-v3-compare-r2.png) |
| 3 响应式与交互 | [420 修正前](assets/gitlens-v3-r3-before-420.png) 选择 merge 后，详情占高使选中行退出视野；640 的旧 44 px 元信息区把父选择控件压入滚动区 | 选择和首次打开详情后定位选中行，已有详情刷新保留锚点；640 元信息上限 76 px；修复首次 Enter 空详情及按钮 Enter 冒泡；记忆列/主题/导航/停靠 | [420 修正后](assets/gitlens-v3-r3-after-420.png)、[640 最终](assets/gitlens-v3-final-640-dark.png)、[960 浅色](assets/gitlens-v3-final-960-light.png)、[1280 WIP](assets/gitlens-v3-final-1280-wip.png) |

拒收记录：第二轮曾只更换 URL hash 而未 reload，读到旧 HTML；该截图不算节点修正证据，r2-after 已替换为 read-back 确认 9 px 文字的截图。两张 resize 紧接截图分别仍为 420/640 宽，已拒收并在稳定后重拍 640/960；主代理通过图片解码再次核对最终文件为 420×800、640×800、960×800、1280×800。CUA 原始截图字节实际为 JPEG，沿用的文件名后缀是 .png；保留原始字节未转码，读取应按实际格式识别。对照合图另为派生图片。

最终 [全景合图](assets/gitlens-v3-compare-final.png) 与 [原像素行细节合图](assets/gitlens-v3-compare-rows.png) 同时显示参考和实现。相比首轮，历史占比、作者节点、密度、彩色引用和选择色已接近参考的视觉层级。保留的作者姓名列、较克制的标签色、缺少活动概览属于已明确的产品取舍；不宣称像素级复刻。

## 验证

- `node --check` 覆盖服务、Git 模块和 UI；`node scripts/build.mjs` 成功，产物更新。
- 完整 `node --test --test-concurrency=1 test/*.test.mjs`：22/22 通过，日志 `.test-output/v3-tests.log`。受限环境首次 18/22，4 项失败分别为 MSYS 命名对象权限与环回 EACCES；在正常本机权限重跑全部通过，没有为环境失败改业务逻辑。
- 完整测试覆盖原有暂存、取消暂存、首次提交、index-only 提交、身份变更、hook 失败、锁、浅克隆、bare、Worktree、父比较、传输安全与构建插件启动。末尾的首次详情定位、按钮键盘冒泡和 640 元信息 CSS 修正在全套测试之后；之后完成 build/check 和实际 UI 回归，没有宣称再次跑全套。
- CUA 实测：HEAD 跳转、upstream 复合引用跳转、查找唯一 merge、切换第二父查看真实 theme.css diff、WIP README.md diff、历史 Enter 首次加载、菜单 Enter 打开及 Escape 返回原省略号焦点。
- CUA 实测：独立 fixture 中 README.md 暂存成功后取消暂存恢复；[操作完成证据](assets/gitlens-v3-write-stage.png)。本轮 UI 未重新执行提交/创建分支/创建 Worktree，这些写入由完整真实 Git 测试回归。
- CUA 实测：导航展开、详情侧边、隐藏作者列、深色主题后 reload，DOM 状态为导航展开/侧边/作者隐藏/深色；设置按钮正确反映 aria-pressed；随后 UI 恢复历史优先与作者列。系统主题监听已实现，但未切换操作系统主题作端到端实测。
- 主代理独立验证首次 Enter 后 WIP 选中行在历史可见边界内；省略号 Enter 打开正确菜单；列开关可操作。实现代理另验 Escape 返回焦点。主代理最终预览 error/warn 日志为空。

## 未测与剩余限制

- 未验证原生 Codex 固定入口、真实宿主嵌入、高 DPI、屏幕阅读器及完整对比度合规；没有新增假宿主接口。
- 参考只有深色，浅色仅验收产品内部一致性。没有 GitLens 实机，不能声称菜单、快捷键与竞品一致。
- 420/640 会省略长引用和摘要；完整文本仍可通过 title、详情与引用菜单查看。拖动窗口改变详情高度时保留滚动位置，不保证持续自动居中选中行；点击/首次打开详情会定位选择。
- 八 lane 以上只保留既有拓扑测试与横向图滚动，未做本轮实际截图；跨 scope 固定颜色、远程头像、minimap 另排期。

本轮最终测试服务 PID 45816 保留，连接信息仅存 `.test-output/v3-preview.json`，不把临时 token 写入评审文档。主代理已更新真实项目预览，PID 45544；真实项目仍无提交，展示 unborn WIP，未执行 Git 写操作。补充证据：[主代理最终样例](assets/gitlens-v3-root-final.png)、[当前项目](assets/gitlens-v3-current-repository.png)。
