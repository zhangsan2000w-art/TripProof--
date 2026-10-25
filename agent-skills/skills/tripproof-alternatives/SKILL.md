---
name: tripproof-alternatives
description: 该技能在用户希望替换已有行程项时，用 TripProof 搜索并独立核验可比较的同城候选场馆。
---

# 同城替代场馆

## Purpose

查找有独立证据的候选，不直接更改原行程。

## When to Use

用于已有 `tripId` 中具体地点不合适时寻找同城候选。已有候选的替换与应用使用 `tripproof-repair`；无行程 ID 的通用目的地推荐不属于此 Skill。

## Inputs

私有 `tripId`、目标行程项 `itemId`、用户期望的替代原因或偏好。

## Workflow

1. 读 [候选约束](references/alternatives.md)，调用 `status` 核对 itemId 与当前行程；说明将执行新搜索并取得同意。
2. 调用 `alternatives TRIP_ID ITEM_ID [--wait]`；必要时以 `status/wait` 续查现有 Run。
3. `completed` 后展示 `result.alternatives` 的候选、理由、逐项判断和来源；如果证据不足，明确保持未知。
4. 用户希望替换时，转 `tripproof-repair` 使用已存候选 ID 预览、确认后应用；不直接把候选写入行程。

## Tool and API Usage

调用同包 `../tripproof/scripts/tripproof.mjs` 的 `status/alternatives/wait/report`；对应 `POST /api/trips/:id/alternatives`。

## Validation

检查 `run.status=completed`，候选 `itemId` 与目标一致，并对 `dossier.evidence` 和 `judgments` 做适用性审阅。

## Error Handling

`ITEM_NOT_FOUND` 刷新行程项；`RUN_ACTIVE` 等待；预算不足、失败或空候选不补造地点；网络超时只续查。

## Safety and Confirmation

独立候选调查消耗搜索与模型额度，需执行前确认；替换属于另一项持久副作用，须再次预览与确认。

## References

- [候选约束](references/alternatives.md)：接口、结果与替换边界。
