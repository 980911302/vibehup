# R92 排版优化（第一刀）

保留原版纸白/藏青，不改 IA；只做排版与层级。

## 原则

- 页头统一：左侧「上下文 / 工作」标题 + 一句副标题，右侧分段 Tab；不再用全宽工具条 + 右侧长提示。
- 内容卡片化：项目记忆从全宽色带改成内容卡片，有边界/圆角/内边距。
- 空态收进内容区：随手记空态不再被推到页面最底部；空项目不显示空白记忆卡。
- 长提示可截断：不再让右侧说明越界/被裁切；窄屏直接隐藏。
- 留白与对齐：页头/卡片使用同一水平内边距；桌面 24–32px，移动 16px。

## 改动

- `ContextTabs` / `WorkTabs`：页头 + 右侧 Tab，删除右侧长提示。
- `ProjectMemoryCard`：内容卡片；无描述且 0 决策时不显示；有描述但 0 决策时不再重复空态。
- `NoteWall`：空态改为内容区内 `min-h-[240px]`，不再垂直居到底部。
- `WorkQueue`：仍为「我的队列 + 待验收」，与页头对齐。

## Before / After

- `before-context.png`：旧上下文页（全宽工具条 + 记忆色带 + 空态在底部）。
- `after-context-light.png` / `after-context-dark.png`：新上下文页。
- `after-work-light.png`：新工作页头/队列。
- `after-mobile-work-bugs.png` / `after-mobile-work-tasks.png`：390px 下看板改为纵向列表，不再横向拖列。
- `after-mobile-members.png`：成员表可在容器内横向滚动，不再撑破页面。
