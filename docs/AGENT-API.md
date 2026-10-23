# Agent 对话与恢复接口

所有业务接口沿用入口密码与 owner Cookie。用户 UUID、行程版本、问题编号、工具参数和修改操作均由服务端校验；公开报告接口不返回私人对话与检查点。时间按北京时间计算。

## 对话

`GET /api/trips/:id/messages` 返回 `{ agent }`，包括消息、逐站证据缺口、已查范围、下一步、停止原因、待回答问题、行动摘要及预览编号。完整工具来源池只保留在服务端。

`POST /api/trips/:id/messages`：

```json
{
  "requestId": "668dbb52-b933-4fb8-a306-a463af6726b2",
  "revision": 1,
  "text": "雷峰塔改到16:00到达，17:00离开，请先预览",
  "replyTo": "可选，当前待回答问题的ID"
}
```

返回 HTTP 202 与 `{ "messageId": "…", "runId": "…" }`。相同请求 UUID、文字、版本及问题编号返回原响应；相同 UUID 改用另一组内容返回 `REQUEST_CONFLICT`。旧行程版本返回 `STALE_REVISION`，旧问题返回 `QUESTION_EXPIRED`。

任务进行中时追加消息，在当前工具步骤边界处理。`waiting_user` 时重新排队同一任务，保留搜索预算、已完成步骤与活动耗时。任务已结束时创建对话任务，继承现有事实；普通解释和修复仅使用存量证据，明确要求复查才允许搜索。若正在执行独立公告或替代场馆任务，则返回 `RUN_ACTIVE`。

## 取消

`POST /api/runs/:id/cancel` 将尚未结束的任务设为 `cancelled`，中止在途工作并保留已有证据。重复取消幂等，不能取消其他 owner 的任务。已预留并发生的上游调用仍计入预算；停止后的迟到结果不能将任务改回完成。

## 状态与事件

`GET /api/trips/:id` 在原有 `trip`、`run`、`result` 和 `events` 之外返回私有 `agent` 视图。

`GET /api/runs/:id/events?after=事件ID` 支持从最后已接收 ID 续接。Agent 增加 `plan`、`agent_step`、`agent_message`、`agent_question`、`agent_proposal`、`waiting_user`、`cancelled` 事件；原有搜索、判定、预算和完成事件继续保留。`waiting_user`、`cancelled`、完成或失败时结束连接。回答后应以当前最后事件 ID 建立新的连接，避免旧等待事件关闭新流。

`Run.status` 为 `queued`、`running`、`waiting_user`、`completed`、`failed` 或 `cancelled`。等待回答时 worker 可执行其他任务。有检查点的失联运行会在心跳超时后重新排队；成功步骤不会重跑。上游调用与本地提交无法组成跨服务事务，因此进程恰在请求中断时，可能出现已计预算但没有结果的调用，不能承诺上游只调用一次。

## 预览和应用

`POST /api/trips/:id/whatif`：先提交 `{ "revision": 1, "ops": [...], "apply": false }`，或 `{ "revision": 1, "startDate": "2026-10-27", "apply": false }`。返回服务端保存的 `proposalId`、修改后行程和代码重判结果。

Agent 已创建的预览可通过 `{ "revision": 1, "proposalId": "…", "apply": false }` 读取。应用时发送 `{ "revision": 1, "proposalId": "…", "apply": true }`。预览绑定行程版本和证据指纹，应用时再次重算；证据、行程或判定随时间改变时返回 `STALE_PROPOSAL`。调查仍在写入证据时返回 `RUN_ACTIVE`，未先保存预览则返回 `PREVIEW_REQUIRED`。

操作包括 `shift`、`swap`、`drop` 和 `replace`。`replace` 的 `alternativeId` 必须是当前结果已保存且属于目标项的候选场馆 `venueId`，不能从客户端传入任意新场馆。替换后保留原行程项 ID、依赖和对照，标记 `proposedBy: "agent"`。

所有预览和应用均不搜索。日期超出存量事实适用范围、实时库存及无法裁决的矛盾保持未知。

## 执行约束与缓存

每轮实际搜索最多 40 次、同场馆最多 5 次、搜索并发 4；最多 12 次行动决策，同一检查连续两轮没有新增有效证据即停止。活动执行上限 8 分钟，用户等待不计入；达到上限仍保留已完成结果并说明剩余未知。

网页抓取与模型分析使用独立队列。解析缓存包含场馆、完整网页内容哈希、模型和提取版本；命中后重新核验引文、数字、分馆、链接和适用性。常规规则可跨日期复用，动态公告、预警和天气仍执行本轮检索。`agent_progress` 事件记录 queue/search/page/model/repair 阶段耗时，缓存记录保留原时间。
