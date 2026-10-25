# 供其他 Agent 调用的接口

## 准备

需要 Node.js >=22.18、此 Skill 的 `../scripts/tripproof.mjs`、运行中的完整 TripProof HTTP 服务（网页 + worker）。服务端配置模型和至少一种搜索；随包 CLI 是普通 HTTP 客户端，不读取服务端密钥。复制本 Skill 到其他 Agent 环境时，保留 `scripts/` 和 `references/`，并提供服务地址。

设置 `TRIPPROOF_URL` 为 HTTP(S) 根地址；默认 `http://127.0.0.1:3000`。设置 `TRIPPROOF_SESSION_PATH` 为该用户独占、不可提交的文件；默认 `~/.config/tripproof/session.json`。仅入口密码开启时在环境变量中设置 `TRIPPROOF_PASSWORD`，不要写入命令行。CLI 正常登录，不绕过 `tp_access` 或 `tp_session`。不得在多个用户间共用 owner Cookie，也不要并发写同一个会话文件。

调用示例：`node /absolute/path/to/tripproof/scripts/tripproof.mjs health`。可用 `--url URL`、`--session FILE` 覆盖环境变量。除 `--help` 外，成功 stdout 是单个 JSON 对象；失败 stderr 是 `{error,code,status?,fields?}` 且退出码非零。`--wait` 轮询异步任务，默认 600 秒，可用 `--timeout 1..3600`；超时不取消服务端任务。

## 任务路由与关键字段

| 目标 | CLI | 检查 |
| --- | --- | --- |
| 攻略读取 | `extract --file guide.txt [--image image.jpg ...] --wait`；`extraction JOB_ID --wait` | `job.status=completed`、`job.draft`；`requestId` 可幂等重试 |
| 草稿转行程 | `draft-trip --input draft.json --date YYYY-MM-DD --city 城市` | 输出仍须人工核对，不会提交 |
| 建行程 | `create --input trip.json` | `trip.id/shareId/revision`；无幂等创建键 |
| 启动/等待调查 | `investigate TRIP_ID [--wait]`；`status TRIP_ID`；`wait TRIP_ID` | `run.status`；等待可能停在 `waiting_user` |
| 追问/对话 | `message TRIP_ID --text 文本 [--reply-to QUESTION_ID] [--request-id UUID]` | `messageId/runId`；重试同 UUID 同内容 |
| 修复 | `preview TRIP_ID --input ops.json` 或 `--date YYYY-MM-DD`；`apply TRIP_ID PROPOSAL_ID` | 先看 `proposalId/trip/result`，同意后应用 |
| 扩展调查 | `announcement TRIP_ID --file notice.txt [--image screenshot.jpg] [--wait]`；`alternatives TRIP_ID ITEM_ID [--wait]` | 新 Run，搜索可能计费 |
| 停止/报告 | `cancel RUN_ID`；`report TRIP_ID` | 报告含 `url/run/result`，分享前检查状态与原攻略内容 |

CLI 图片最多 6 张、单张不超过 4 MB，支持 jpeg/png/webp；不做网页端的 EXIF 移除、压缩和长图切片。`draft-trip` 不会自动补缺失的计划时间。`report` 的 `result` 在任务未完成时可能为空或更新中。

## 状态与安全

`Run.status`: `queued/running/waiting_user/completed/failed/cancelled`。`TripState` 含 `trip/run/runs/result/events/agent`；`agent.questions` 是待问用户的问题，`result.judgments` 的 `verdict` 为 `confirmed/conflict/unknown`。来源身份、适用日期、证据引文和 `limitations` 应随结论保留。分享页 `/r/:shareId` 不公开私人对话，但如果创建时附了 `guide`，会展示原攻略文字和图片。不要将分享页当作实时重新核验。

网络丢失时：提取用既有 `requestId` 或 job ID 续查；消息用同一 `requestId` 重试；调查用 `status` 查 run ID；创建若响应丢失，因为没有幂等键，先人工/环境核查是否成功，不能盲重试。`STALE_PROPOSAL` 需重新预览；`NOT_CONFIGURED` 不是 `health` 可排除的问题。
