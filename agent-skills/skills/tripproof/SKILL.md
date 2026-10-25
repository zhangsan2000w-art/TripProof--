---
name: tripproof
description: 该技能在用户泛称 TripProof 或任务跨多个阶段时，将旅行攻略整理、逐站核验、追问与修复串成可调用流程。
---

# TripProof 统一入口

## Purpose

将 TripProof 的现有 HTTP/CLI 能力作为一个可调用的 Agent 工作流，按用户目标调用专门 Skill 或直接执行对应 CLI 命令。

## When to Use

用于攻略图文读取、行程核验、证据报告、问答、公告核验、候选场馆和预览修复的组合任务。单一明确任务可转用同目录的 `tripproof-intake`、`tripproof-investigation`、`tripproof-repair`、`tripproof-notice` 或 `tripproof-alternatives`。不用于订票、付款、实时库存承诺、账号/权限管理或定时监控；产品没有这些能力。

## Inputs

- 服务根 URL、此 Skill 中的 `scripts/tripproof.mjs`、每名用户独立的私有会话文件；仅开启入口密码时需要 `TRIPPROOF_PASSWORD`。
- 新任务：攻略文字/截图、首日日期与目的城市、用户对校对结果和分享原文的选择。
- 既有任务：`tripId`、具体目标；修改时还需 `itemId`、目标操作和用户确认。

## Workflow

1. 读 [Agent 接口与边界](references/agent-interface.md)，确认完整服务和 worker 已启动；用 CLI `health` 检查基本可用性，但不把健康检查等同上游配置正常。
2. 按用户意图选择同包子 Skill。完整新行程走 `intake → investigation → （可选 notice/alternatives/repair）`；每一步维持相同服务 URL 与 owner 会话。子 Skill 在此目录的同级文件夹；若只安装本 Skill，则按其参考文档直接执行相应命令。
3. 在模型/搜索调用和持久写入前说明费用与副作用；在创建行程、对外分享、应用修改等动作前展示确切内容并取得同意。用户原指令如果已明确授权具体动作，不重复索取形式化同意。
4. 每次异步运行读取 `status`/`wait` 的实际 `run.status`；`waiting_user` 时只转述待回答问题，不自行填充。只有 `completed` 的报告可作为完整调查快照；逐项保留 `unknown` 和来源限制。
5. 网络超时后先查已有任务或用原 UUID 幂等续查；不要立即重提非幂等创建或新调查。

## Tool and API Usage

优先调用随 Skill 提供的 `node /absolute/path/to/tripproof/scripts/tripproof.mjs ...`，其 JSON stdout 与 JSON stderr 可供其他 Agent 解析。它是项目 `bin/tripproof.mjs` 的打包副本；项目内完整命令说明见 `docs/CLI.md`，HTTP 约定见 `docs/AGENT-API.md`。Skill 不提供 HTTP 服务或模型密钥。

## Validation

检查服务端返回的 `trip.id/revision`、`run.status`、`result.judgments`、证据与报告 URL；应用修改后重新读取 revision 和行程。不要用 CLI 退出码 0 代替后台任务完成。

## Error Handling

`ACCESS_REQUIRED` 走正常登录；`NOT_CONFIGURED` 交由服务管理员配置；`RUN_ACTIVE` 等待；`STALE_REVISION/STALE_PROPOSAL` 刷新并重新预览；`TIMEOUT` 续查而非重启。其余错误读 JSON stderr 的 `code/status/fields`，原样向用户说明未完成部分。

## Safety and Confirmation

按 owner 隔离会话文件，不记录或提交 Cookie、入口密码、私有状态、攻略图片。报告链接持有者可能看到原攻略副本；发送或发布链接前确认。任何最终结论都应区分已核实、冲突、未知。

## References

- [Agent 接口与边界](references/agent-interface.md)：运行、会话、命令、返回和重试。
