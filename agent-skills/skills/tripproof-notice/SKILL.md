---
name: tripproof-notice
description: 该技能在用户询问场馆公告真伪或影响时，为公告文字或截图寻找 TripProof 独立证据并核验。
---

# 公告核验

## Purpose

区分用户提供的公告主张与独立来源，形成可追溯的判定。

## When to Use

用于已有行程中关于开放、关闭、预约等公告的图文核验；不是定时监控或自动订阅。普通逐站核验用 `tripproof-investigation`。

## Inputs

私有 `tripId`；公告文字和/或 jpeg/png/webp 截图；需要对应日期、地点、城市时从文本或用户补充中取得。

## Workflow

1. 读 [公告核验约束](references/notice-check.md)，确认用户愿意执行模型读取和新搜索。
2. 调用 `announcement TRIP_ID --file notice.txt [--image image.jpg] [--wait]`；超时用 `status`/`wait` 续查，不重开任务。
3. 仅在 `run.status=completed` 后读取 `result.announcement`，再由 `evidenceIds` 对照 `result.dossiers` 中来源；说明未核实或矛盾部分。

## Tool and API Usage

使用同包 `../tripproof/scripts/tripproof.mjs` 的 `announcement/status/wait/report`；对应 `POST /api/trips/:id/announcements`。模型先结构化读取公告，worker 再搜索核验。

## Validation

检查任务完成、公告 `verdict/explanation/evidenceIds`、适用日期和来源身份；无独立佐证不能把截图判作官方。

## Error Handling

运行冲突时等待当前 Run；图片/文本验证错误按 JSON stderr 反馈；任务失败或预算不足时报告未完成，不将原公告视为已证实。

## Safety and Confirmation

启动会调用模型和搜索并消耗额度，需执行前确认。公告中的电话、身份或联系方式属于敏感内容，避免不必要地转存或分享。

## References

- [公告核验约束](references/notice-check.md)：接口、输出与证据边界。
