# GitLens UI implementation design QA

后续更新：用户要求恢复圆点并增加渐变行底色，已完成；最新截图与本次检查范围见 [09调整记录](docs/review/09-row-color-refinement.md)。下文保留此前三轮改造的历史验收，不将作者缩写节点描述视为当前最终状态。

Source visual truth: `docs/review/assets/reference-gitlens.png` (1265×1042 original pixels; host DPI unknown).
Implementation: real local Git fixture, CUA browser rendering. Product CSS viewports: 420×800, 640×800, 960×800, 1280×800; saved image dimensions verified independently by decoding. Original CUA captures contain JPEG bytes despite their retained .png filenames; originals were not re-encoded. Implementation density: 1×. No claim of exact DPI equivalence to reference.

Full-view evidence: [final comparison](docs/review/assets/gitlens-v3-compare-final.png). Both original images are in one input, unscaled with labels. Focused evidence: [row comparison](docs/review/assets/gitlens-v3-compare-rows.png), native pixel crops with coordinates and no scaling. Separate original screenshots retained. Data, window height and host differ; content quantity is not scored as visual drift.

## Findings and comparison history

1. P1 history space: initial WIP detail still consumed the first view. Fixed initial load to select without opening detail or scrolling away from newest history. Before/after: `gitlens-v3-r1-before.png`, `gitlens-v3-r1-after.png`; reference comparison `gitlens-v3-compare-r1.png`.
2. P2 author nodes: initial 7px initials were too small and hollow circles weak. Fixed to 18px circles, 9px text, lane-tinted fill, 20px lane pitch. Correct post-fix evidence: `gitlens-v3-r2-after.png`, `gitlens-v3-compare-r2.png`. An old-HTML capture after hash-only navigation was rejected and replaced after reload and DOM read-back.
3. P2 narrow detail/selection: opening detail could move the selection outside the viewport, first Enter could expose unloaded content, and parent controls were initially hidden in the 640px metadata scroll area. Fixed selection positioning on first open, actual Enter loading, row-button event propagation, and 76px metadata cap at 560–799px. Before/after: `gitlens-v3-r3-before-420.png`, `gitlens-v3-r3-after-420.png`; final 640/960/1280 evidence in implementation report. Resize-transition captures with stale PNG widths were rejected and replaced.

No actionable P0/P1/P2 findings remain within the agreed visual scope. P3/follow-up: existing author name column differs from reference avatar column; no activity minimap; labels intentionally less saturated; long strings truncate at narrow widths. Window resizing retains scroll rather than continually recentering selection. None is represented as exact GitLens parity.

## Required fidelity surfaces

- Typography: Segoe UI/Microsoft YaHei 12px UI text retained; 9px author initials fit 18px nodes; long Chinese/English summaries ellipsize. No reduced main text size to fake density.
- Spacing/layout: 24px rows and graph geometry share one constant, 20px lanes, compact toolbar, fixed 28px action column. Four viewport captures checked; 640 parent selector is initially visible after fix.
- Colors: neutral blue-gray selection in dark/light; lane colors continue across edges and badges; green diff additions separated from selection token. Global cross-scope branch color persistence is not claimed.
- Assets: official Microsoft Codicons copied from the package, with CC BY 4.0 license included in plugin distribution. Author initials and Git topology are real data visualizations, not generated portraits. No remote avatar dependency.
- Copy: real repository state, truthful tracking association, real WIP count and detail state; no fake host chrome, health banner, or inactive placeholder controls.

## Interaction and verification

CUA checked search, HEAD/ref jumps, merge parent switching with actual diff, WIP files, stage/unstage in independent fixture, initial Enter, row-menu Enter/Escape focus restoration, and reload persistence for navigation/dock/theme/columns. Build/check passed. Full 22-test suite passed before final UI-only positioning/keyboard/640 refinements; final changes received build/check plus browser regression.

## 主代理最终复核

主代理实际打开最终全景合图、行细节合图、420/640深色与960浅色截图。解码确认最终文件为对应宽度×800；沿用的.png扩展名不代表截图字节是PNG，不以PNG头偏移推断尺寸。主代理另存 [1280×720完整历史](docs/review/assets/gitlens-v3-root-final.png) 和 [当前项目](docs/review/assets/gitlens-v3-current-repository.png)。

独立浏览器检查：首次Enter加载3个工作区文件，选中行407–431px位于历史区90–431.4px；省略号Enter打开正确提交菜单；列开关可切换并恢复作者列。最终样例预览的error/warn日志为空。真实项目预览已更新且仅浏览，无Git写入。

子代理在代码、测试与截图完成后的收尾阶段遇到模型容量错误；主代理核对完整22项测试日志、许可分发、报告链接和截图后完成文档，未更换实现模型或改动产品代码。没有遗留本轮范围内的阻塞问题；原生固定入口、高DPI、200%缩放、完整读屏/对比度验收仍未验证。

See [implementation and iteration record](docs/review/08-gitlens-ui-implementation.md) for scope mapping, evidence, test boundaries and untested host/accessibility/high-DPI cases.

final result: passed
