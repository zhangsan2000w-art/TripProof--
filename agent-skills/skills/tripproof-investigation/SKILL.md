---
name: tripproof-investigation
description: 该技能在用户要检查已有行程可行性或查看调查进度时，启动或恢复 TripProof 逐站核验并解读证据报告。
---

# 行程调查与证据报告

## Purpose

用真实搜索和模型读取来源，由代码输出可追溯的逐站判定。

## When to Use

用于已有 `tripId` 的调查、复查、状态恢复、对话、取消、报告解读。新攻略尚未建行程时先用 `tripproof-intake`；修改行程走 `tripproof-repair`。

## Inputs

私有 `tripId`、同一 owner 会话、用户要核查的问题；追问时需要当前未回答的 `question.id` 与用户给出的文字。

## Workflow

1. 读取 [任务与证据](references/runs-and-evidence.md)，调用 `status` 判断已有任务。只在用户授权且没有活动任务时调用 `investigate`；重新检查也属于新付费运行。
2. 用 `wait` 或 `status` 跟踪 `run.status`。`waiting_user` 时展示 `agent.questions`，等待用户回答；若用户明确选择暂不补充，可发送“保留未知”而不是编造事实。
3. 需要对话时使用 `message`，指定当前 `reply-to` 和可复用 `request-id`；回答后继续等待。用户要停止时调用 `cancel RUN_ID`。
4. `completed` 后执行 `report`，逐站读取 `judgments`、来源、适用日期、`limitations` 和剩余未知。提供报告 URL 前说明可能附带原攻略；不主动向第三方发送。

## Tool and API Usage

使用同包 `../tripproof/scripts/tripproof.mjs` 的 `investigate/status/wait/message/cancel/report`。HTTP 为 `POST /api/trips/:id/runs`、`GET /api/trips/:id`、`GET/POST /api/trips/:id/messages`、`POST /api/runs/:id/cancel`；SSE 可用 `GET /api/runs/:id/events?after=` 续接。

## Validation

CLI 请求成功并不代表 worker 完成。检查 `run.status=completed`、`run.error`、`result.judgments`；引用结论时保留 `verdict`、来源链接与时间限制。等待状态或失败状态只能报告进度/已有证据，不能称为完整核验。

## Error Handling

`NOT_CONFIGURED` 交服务端管理员；`RUN_ACTIVE` 先等现有任务；`TIMEOUT` 续查同一 tripId；`STALE_REVISION/QUESTION_EXPIRED` 刷新问题。未知事实保持 unknown。网络丢失后先 `status`，不要直接再开新运行。

## Safety and Confirmation

调查消耗模型和搜索额度；启动或复查前确认。对话内容会保存，发送前确认用户文字。取消保留已有证据和实际费用。私有状态不可作为公开附件；公开报告链接的原攻略展示需另行告知。

## References

- [任务与证据](references/runs-and-evidence.md)：状态机、预算、判定与分享边界。
