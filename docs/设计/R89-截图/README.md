# R89 产品重做截图证据

- **基线（Before）**：`9d9b37f`（main，R88 后），截图取自 2026-11-03 的当前应用，视口 1512×982 @2x，暗色 Midnight；登录页恒定 Daylight。
- **改后（After）**：R89 分支 `agent/product-rebuild-854a10d716cf`，同一视口 1512×982 @2x；移动端 390×844 @2x。
- **同一场景**：`before-board-dark.png` 与 `after-work-bugs-dark.png` 都是「工作 · 缺陷看板」暗色；`before-login.png` 与 `after-login.png` 都是未登录的登录页。其余为新增页面或新状态，补充展示。

| 文件 | 说明 |
| --- | --- |
| `before-board-dark.png` | 旧壳：侧边栏 + 六列看板 + 蓝色品牌 |
| `after-work-queue.png` | 工作默认「我的队列 + 待验收」；六列看板降为二级 Tab |
| `after-work-bugs-dark.png` | 工作 · 缺陷：四区顶栏 + 默认隐藏已完成列；配色恢复原版 |
| `after-work-archived-dark.png` | 工作 · 已归档：完成的缺陷/任务不占看板 |
| `after-quick-capture.png` | 任意页按 C 的全局快速录单 |
| `after-evidence-gate.png` | R90：验证中但无交付证据，今日只给「补证据」 |
| `after-evidence-panel.png` | R90：详情页「交付证据」补 commit/PR/测试/说明 |
| `after-notifications.png` | R90：顶栏通知抽屉（待验收/交接/打回，可全部已读） |
| `after-project-memory.png` | R90：上下文顶部「项目记忆」= 项目一句话 + 置顶决策 |
| `before-login.png` | 旧登录页：网格背景 + 玻璃卡 |
| `after-login.png` | 登录页恢复原版纸白/藏青+金色细节（仅把默认跳转改为今日） |
| `after-today-dark.png` | 今日工作台（暗色）；待验收可直接通过/打回 |
| `after-today-daylight.png` | 今日工作台（纸白） |
| `after-today-mobile.png` | 今日工作台 390px |
| `after-mobile-menu.png` | 移动端全屏导航 |
| `after-settings-dark.png` | 新设置页（我的 / 团队，暗色） |
| `after-settings-daylight.png` | 设置页纸白主题；「管理我的密钥」按钮对比度修复 |
| `after-keys-dark.png` | 密钥自助页；创建不选权限，自动继承角色 |
| `after-context-notes-dark.png` | 上下文 · 随手记 |

演示数据仅存在于本地开发库，截图后未进入任何提交。
