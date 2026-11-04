# R91 Work Item 合并：无损迁移方案

> 目标：把缺陷与任务收成一套「Work Item」体验（一个队列、一套详情、一套 API），
> 但不为了合并而合并数据库表；先统一读模型，再按收益决定是否迁表。

## 1. 判断

当前重复主要在三处：

1. 前端两套卡片、两套详情、两套筛选；
2. REST 两套列表/详情/更新入口；
3. 状态语义不同（缺陷 resolved/verified/closed，任务 review/done/cancelled）。

**不建议直接改表**：两张表字段差异大（缺陷有复现步骤/期望/实际/严重度/commit，任务有描述/取消），
强行合并会把大量字段变成 nullable，并为历史数据、MCP 工具、附件多态、统计口径引入高风险迁移，
但用户看到的收益有限。

**建议**：先做「读模型统一 + API 门面」，表保持不动；等读模型稳定、确实需要跨类型查询时，再做表合并。

## 2. 阶段 A：统一读模型（低风险，先做）

新增前端/服务端 DTO：

```ts
type WorkItemType = 'bug' | 'task';
interface WorkItem {
  type: WorkItemType;
  id: string;            // 保留 bug_/tsk_ 前缀，外部链接不变
  project_id: string;
  title: string;
  status: string;        // 保留各自状态机语义
  priority: string;
  assignee: { id: string; name: string } | null;
  evidence: DeliveryEvidence | null;
  updated_at: string;
  // 类型特有字段按需带，不强行摊平
}
```

- `GET /api/work-items?project_id=&scope=my|verify|active`：服务端聚合 bugs + tasks，按统一 DTO 返回。
- 写操作仍走现有 `/api/bugs/:id`、`/api/tasks/:id`；前端用 `type` 分流。**不改现有 API 行为**。
- 今日 `/api/today` 已接近此模型，可复用其 item 结构；Work 队列改用 `/api/work-items`，避免依赖“今日”语义。
- MCP 工具保持 30 个不变；`list_bugs`/`list_tasks` 兼容，新增 `list_work_items` 可选。

### 验收
- 队列、今日、工作详情对同一 item 的标题/状态/证据一致。
- 现有 E2E、MCP、REST 契约全绿；无数据库迁移。
- 旧 `/api/bugs`、`/api/tasks` 调用方不受影响。

## 3. 阶段 B：表合并（只有满足条件才做）

触发条件（任一）：
- 跨类型查询/统计成为高频需求，门面层出现明显 N+1 或分页困难；
- 两套详情/状态机维护成本持续高于迁移成本；
- 有明确产品需求要求“一个 Work Item 一套自定义字段/视图”。

迁移步骤（可回滚）：
1. 新增 `work_items` 表（字段并集，类型特有字段可空）+ 双写开关（默认关）。
2. 历史数据 backfill：bugs/tasks → work_items；保留原 ID 与 `legacy_type`。
3. 读切换：门面读 work_items；旧表只写不读（或双写）。
4. 观察一个迭代：统计、MCP、附件、评论、归档全部对账。
5. 下线旧表/旧写路径；保留只读快照一个版本。

**状态不强行统一**：`WorkItem.type` 决定状态机；只统一展示标签与队列排序，避免把 closed/cancelled 的语义揉成一个。

## 4. 不做

- 不为了“看起来统一”把复现步骤、关闭原因等字段塞进 JSON。
- 不一次性重写 MCP 工具面；30 个工具先保留，新增统一读工具。
- 不在阶段 A 动生产数据；阶段 B 必须可回滚。

## 5. 建议顺序

1. `WorkItem` DTO + `/api/work-items`（读）。
2. Work 队列改用统一读模型；今日/详情复用。
3. 观察 1–2 周；只有出现明确痛点才进入表合并。
