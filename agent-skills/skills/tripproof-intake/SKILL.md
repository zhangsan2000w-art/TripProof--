---
name: tripproof-intake
description: 该技能在用户希望从攻略建立行程时，读取 TripProof 图文提取草稿并在校对后创建行程。
---

# 攻略读取与建行程

## Purpose

将用户攻略变成可审阅的 `TripInput`，经确认后保存行程；不直接启动调查。

## When to Use

用于图文攻略读取、歧义核对、行程项增删改和创建。已有 `tripId` 的逐站调查改用 `tripproof-investigation`；创建后的修改改用 `tripproof-repair`。

## Inputs

攻略文字和/或图片、首日日期、目的城市；可选标题、出发城市、抵离时间、公共交通/自驾、是否把原攻略附到分享报告。

## Workflow

1. 确认服务与独立会话，读取 [输入与校对](references/input-and-review.md)。按需预处理图片；执行 `extract ... --wait`，超时使用 job ID 续查。
2. 检查 `job.status`、`draft.ambiguities`、来源文字、低置信度和未排入行程的推荐。使用 `draft-trip --input ... --date ... --city ...` 生成**本地** JSON。
3. 对照原文展示地点、顺序、日期、到达/离开时间、交通方式、依赖与原攻略分享选择；未知时间保持 `null`。用户确认前只修改本地 JSON。
4. 用户确认具体行程后执行 `create --input ...`，保存 `trip.id/shareId/revision`。需要核验时再使用调查 Skill，避免把创建成功与调查成功混淆。

## Tool and API Usage

调用同包 `../tripproof/scripts/tripproof.mjs` 的 `extract`、`extraction`、`draft-trip`、`create`；对应 `POST/GET /api/extract` 和 `POST /api/trips`。不虚构离线提取功能。

## Validation

只在 `job.status=completed` 且有 `job.draft` 时使用提取结果；`create` 后检查服务返回的 `trip.id` 与用户校对的行程一致。

## Error Handling

失败/超时先读原 job；模型配置或图片格式错误如实报告。`create` 响应丢失时没有幂等键，不盲重试；先核查会话及已知返回信息，再请用户决定。

## Safety and Confirmation

提取调用模型会产生费用；明确说明并取得授权。创建行程是持久写入，须在用户确认具体行程后执行。附原攻略时，分享链接持有者可看文字和图片；不默认代用户公开或发送链接。

## References

- [输入与校对](references/input-and-review.md)：CLI 限制、实际 schema 与确认点。
