---
name: tripproof-repair
description: 该技能在用户想调整已有行程时，用 TripProof 已存证据预览日期、时间、顺序、删站或候选替换并在确认后应用。
---

# 行程修复

## Purpose

只用已存事实计算修改影响，先预览、后应用，不暗中改行程。

## When to Use

用于已有 `tripId` 的日期/时间调整、交换、移除或已核验候选替换。需要新查证据时转 `tripproof-investigation`；需要先查候选转 `tripproof-alternatives`。

## Inputs

私有 `tripId`、用户目标、当前 `trip.revision`、目标 `itemId`；候选替换需当前结果中对应 `alternativeId`。

## Workflow

1. 读 [操作与预览](references/operations.md)；调用 `status` 获取最新行程与结果。没有已存事实时先调查。
2. 构造合法操作数组文件，用 `preview TRIP_ID --input ops.json`；仅换首日日期用 `preview TRIP_ID --date YYYY-MM-DD`。
3. 展示预览返回的前后行程、`result.judgments`、仍未知项以及是否无新增搜索；取得用户对具体变更的同意。
4. 调用 `apply TRIP_ID PROPOSAL_ID`；应用后重新 `status`，检查 `trip.revision` 和修改内容。若过期，停止应用并重预览。

## Tool and API Usage

调用同包 `../tripproof/scripts/tripproof.mjs` 的 `status/preview/apply`；对应 `POST /api/trips/:id/whatif`。脚本不直接调用内部 `saveRecalculation`。

## Validation

预览返回 `proposalId`、`trip/result`、`searched:false`；应用返回 `applied:true`；重新获取持久行程核对 revision、地点与日期。预览不能证明新日期存在新证据。

## Error Handling

`NO_FACTS` 先调查；`RUN_ACTIVE` 等现有任务结束；`PREVIEW_REQUIRED` 生成预览；`STALE_REVISION/STALE_PROPOSAL` 刷新状态并请用户看新预览；无已验证候选不可伪造 ID。

## Safety and Confirmation

应用是持久修改，涉及 `drop/replace` 尤需逐项明确确认。预览本身不搜、也不修改；不要把预览当作自动授权。用户只要求“看看能否调整”时停在预览。

## References

- [操作与预览](references/operations.md)：`Operation` schema、版本/证据约束。
