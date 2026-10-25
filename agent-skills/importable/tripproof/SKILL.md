---
name: tripproof
description: 该技能在用户希望用 TripProof 将旅行攻略整理成行程、核验逐站证据、查看报告或调整行程时使用，也处理公告与同城替代场馆调查。
---

# TripProof 行程核验

## Purpose

通过随包 JSON CLI 调用已有 TripProof 服务，把图文攻略读取、行程校对、证据调查和修复预览组成可供 Agent 执行的任务流程。本 Skill 是 HTTP 客户端，不是离线核验器。

## When to Use

用于用户明确提出 TripProof 攻略提取、逐站核验、来源报告、Agent 追问、日期/时间调整、公告核验或同城替代场馆。不要用于订票、支付、实时库存保证、账号/权限管理或定时监控；服务无这些能力。

## Inputs

- 可访问的 TripProof 服务根地址；每位用户独立的会话文件；若开启入口密码，还需仅通过环境变量提供 `TRIPPROOF_PASSWORD`。
- 新行程：攻略文字和/或截图、出发日期、目的城市、用户校对后的逐站安排，以及是否将原攻略附到分享报告。
- 已有行程：私有 `tripId` 和具体目标；修改需当前 `itemId`、操作或新日期。

## Workflow

1. 先读 [CLI、会话与错误](references/agent-interface.md)，确认服务及 worker 已启动。使用 `node <本目录>/scripts/tripproof.mjs health` 测试基本连通；`health` 不证明模型/搜索配置可用。
2. 按任务只读所需参考：新攻略读 [提取与建行程](references/intake.md)；调查/追问/报告读 [调查与证据](references/investigation.md)；修改读 [修复预览](references/repair.md)；公告读 [公告核验](references/notice.md)；候选读 [替代场馆](references/alternatives.md)。
3. 完整新行程按 `extract → 校对草稿 → create → investigate → status/wait → 必要时回答追问 → report` 执行。创建、调查和分享是不同动作；不要把提取草稿直接当作已确认行程。
4. 在产生上游费用或持久副作用前说明动作和影响；创建、发送消息、取消、应用修改、对外分享应针对具体内容取得授权。用户原指令已明确授权具体动作时不机械重复询问。
5. 异步任务读取实际 `run.status`；`waiting_user` 时转述问题并等待用户答案，未知保持未知。只有 `completed` 可称为完整调查快照；判定要保留来源、适用日期和 `limitations`。
6. 网络超时后先续查同一任务或用原请求 UUID 重试幂等操作；不得盲目重新创建行程或启动另一轮调查。

## Tool and API Usage

调用本目录 `scripts/tripproof.mjs`，要求 Node.js >=22.18；设置 `TRIPPROOF_URL` 为 HTTP(S) 根地址、`TRIPPROOF_SESSION_PATH` 为用户独占路径。CLI 成功 stdout 输出 JSON，失败 stderr 输出 JSON；`--help` 列出实际命令。模型和搜索密钥只在服务端配置，不写入 Skill。

## Validation

新行程核对返回的 `trip.id/revision`；调查核对 `run.status`、逐站 `result.judgments`、证据及报告 URL；修改应用后重新读取行程 revision 和内容。CLI 退出码为 0 不代表后台任务完成。

## Error Handling

`ACCESS_REQUIRED` 走正常入口登录；`NOT_CONFIGURED` 请服务管理员配置；`RUN_ACTIVE` 等待；`STALE_REVISION/STALE_PROPOSAL` 刷新并重做预览；`TIMEOUT` 续查而非重启。其余错误检查 stderr 的 `code/status/fields` 并报告未完成部分。

## Safety and Confirmation

不共享或提交 Cookie、入口密码、私有状态、攻略原文和截图。报告链接持有者可能看到创建时选择附上的攻略副本。删除站点或替换场馆只能先预览、展示差异并经同意后应用。无法核实的库存、临时变化和缺失证据保持 `unknown`。

## References

- [CLI、会话与错误](references/agent-interface.md)：所有模式先读。
- [提取与建行程](references/intake.md)：图文输入、草稿校对、创建。
- [调查与证据](references/investigation.md)：任务状态、追问、报告。
- [修复预览](references/repair.md)：操作 schema、版本与应用。
- [公告核验](references/notice.md)：公告独立佐证。
- [替代场馆](references/alternatives.md)：候选调查与替换边界。
