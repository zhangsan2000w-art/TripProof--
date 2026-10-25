# TripProof CLI：供应用和智能体调用

CLI 是现有 TripProof HTTP 服务的客户端，不是离线核验器。启动完整服务（网页 **和 worker**）后使用；调查会真实调用已配置的模型和搜索，并消耗对应额度。要求 Node.js 22.18+。CLI 不依赖浏览器，也不读取服务端密钥。

```sh
pnpm install --frozen-lockfile
pnpm dev                         # 另一终端，或使用已部署的完整服务
node bin/tripproof.mjs --help
pnpm cli health
```

其他项目可通过 `node /绝对路径/TripProof/bin/tripproof.mjs ...` 调用，或者在 TripProof 目录执行 `npm link` 后使用 `tripproof ...`。服务地址用 `TRIPPROOF_URL=https://你的域名` 或全局选项 `--url URL` 设置；默认 `http://127.0.0.1:3000`。URL 必须是根地址。命令输出是单个 JSON 对象（一行），错误写到 stderr 的 JSON 并返回非零退出码；`--help` 除外。参数可写 `--name value` 或 `--name=value`。

## 鉴权和会话

现有服务通过 `tp_session` Cookie 区分行程的编辑 owner，开启入口密码时还需要 `tp_access` Cookie。CLI 走正常登录表单，**没有管理密钥或绕过权限的接口**。首次写入前会先取 owner Cookie，避免创建请求的响应丢失时无法再读自己的行程。Cookie 保存在 `~/.config/tripproof/session.json`（文件权限 0600）；可用 `TRIPPROOF_SESSION_PATH` 或 `--session FILE` 为不同人、应用、环境隔离。会话文件不保存入口密码；切换 URL 不会向新服务发送旧 Cookie，但同一路径会被新 URL 的会话覆盖。

```sh
export TRIPPROOF_URL=https://trip.example.com
export TRIPPROOF_PASSWORD='入口密码'   # 仅开启入口密码时需要；不要放在命令参数里
export TRIPPROOF_SESSION_PATH="$HOME/.config/tripproof/agent-a.json"
tripproof login                    # 可选；有密码时遇 401 也会自动登录一次
tripproof health
```

入口密码之外，模型与搜索 Key 仍只配置在服务端。不要提交会话文件、攻略原文、私有 `status` 输出或报告快照。多租户应用必须给每个用户独立会话文件；不能共用 CLI 的 owner Cookie。不要并发写同一会话文件。

## 标准流程（先核对草稿，再调查）

```sh
# 1. 从文字/图片读取攻略；可重复 --image，支持 jpeg/png/webp，每张不超过 4 MB。
tripproof extract --file guide.txt --image screenshot.jpg --wait > draft.json

# 2. 转成可编辑的建行程 JSON。请核对地点、顺序、日期、到达/离开时间、交通方式。
tripproof draft-trip --input draft.json --date 2026-10-27 --city 杭州 > trip.json
# 在编辑器中检查/修改 trip.json；此步绝不自动提交或启动搜索。

# 3. 显式创建，再启动调查。下面用 jq 读取 ID；也可由调用方解析 JSON。
tripproof create --input trip.json > created.json
TRIP_ID=$(jq -r '.trip.id' created.json)
tripproof investigate "$TRIP_ID" --wait > state.json
tripproof report "$TRIP_ID" > report.json
```

`extract` 支持只有文字或只有图片。默认立即返回 `{job}`，`--wait` 在完成或失败时返回 `{job}`，其中成功草稿为 `job.draft`。`extraction JOB_ID [--wait]` 可以跨进程续查；任务状态缓存约保留 30 分钟。可指定 `--request-id UUID` 幂等重试提取。图片按原图顺序编码上传；CLI 不做网页端的压缩、EXIF 移除和长图切片，调用方须先自行预处理。`draft-trip` 支持直接读取草稿、`{draft}` 或 `{job:{draft}}`，但生成的 JSON 仍需人工或上层应用明确确认后才调用 `create`。可在建行程 JSON 中设置 `guide` 字段以附上原攻略展示副本；注意分享报告将看到这些内容。字段格式由 `lib/domain.ts` 的 `tripInputSchema` / `guideSchema` 定义，服务端再次校验并脱敏。

`investigate` 返回 `{runId,run}`；`--wait` 返回完整私有 TripState。等待至 `completed`、`failed`、`cancelled` 或 `waiting_user` 就结束，不会擅自替用户回答。超时（默认 600 秒，`--timeout 1..3600`）只退出 CLI，**不会取消服务端任务**，之后用 `tripproof wait TRIP_ID` 或 `tripproof status TRIP_ID` 继续。未完成调查时 `report` 的 `result` 可能为空或仍在更新；不要把中间数据当最终结论。

## 对话、补充与修改

```sh
tripproof status "$TRIP_ID" > state.json             # 包含 trip.revision、run、agent、result、events
tripproof message "$TRIP_ID" --text '暂不补充，保留未知' --reply-to QUESTION_ID
tripproof wait "$TRIP_ID" --timeout 900 > state.json

# 预览不搜索、也不修改行程；apply 必须使用预览返回的 proposalId。
tripproof preview "$TRIP_ID" --date 2026-10-28 > preview.json
# 或 tripproof preview "$TRIP_ID" --input ops.json
PROPOSAL_ID=$(jq -r '.proposalId' preview.json)
tripproof apply "$TRIP_ID" "$PROPOSAL_ID" > applied.json

tripproof alternatives "$TRIP_ID" ITEM_ID --wait > alternatives.json
tripproof announcement "$TRIP_ID" --file notice.txt --wait > notice.json
tripproof cancel RUN_ID
```

`message` 在发送前读取当前 `trip.revision`，并生成 UUID；对超时重试请**自己传同一 `--request-id UUID` 和相同内容**，否则可能重复发送。`--reply-to` 应取自 `state.agent.questions` 中尚未回答的问题。`preview --input` 文件是操作数组，例如：

```json
[{"type":"shift","itemId":"行程项ID","start":"16:00","end":"17:00"}]
```

还支持 `swap`、`drop`、`replace`，具体 schema 见 `lib/domain.ts`。`apply` 会再次校验行程版本和证据指纹，过期时会报 `STALE_PROPOSAL`，必须重新预览。替换只能使用已独立核验并保存在当前结果中的候选 ID。

## 返回值与智能体调用约定

| 命令 | 主要 JSON 字段 | 用途 |
| --- | --- | --- |
| `health` | `ok`, `sourceCommit` | 检查服务就绪；不代表搜索/模型配置有效 |
| `extract`, `extraction` | `job.id`, `job.status`, `job.draft`, `job.code` | 异步攻略读取 |
| `create` | `trip.id`, `trip.shareId`, `trip.revision` | 明确确认后创建 |
| `investigate`, `alternatives`, `announcement` | `runId`（不等待时） | 启动后台工作 |
| `status`, `wait` | `trip`, `run`, `result`, `agent`, `events` | 私有状态与证据 |
| `message` | `requestId`, `messageId`, `runId` | 对话/回答追问 |
| `preview`, `apply` | `proposalId`, `trip`, `result`, `applied` | 先预览、再应用 |
| `report` | `url`, `run`, `result` | 分享地址与完整核验数据 |

智能体建议按固定状态机调用：`extract → 人工确认 → create → investigate → status/wait → 如有 waiting_user 则问用户 → message → wait → report`。不得自行把未知当确认；只把 `run.status=completed` 的报告当作完整调查快照。证据和时间适用性仍须看 `result.judgments` 与来源。用户要求调整行程时只能 `preview → 展示差异并获得同意 → apply`；用户要求停止则 `cancel`。CLI 不提供付款、预订或定时监控。

应用调用示例（Node.js）：

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const { stdout } = await execute('node', ['/absolute/path/TripProof/bin/tripproof.mjs', 'status', tripId], {
  env: { ...process.env, TRIPPROOF_URL: 'https://trip.example.com', TRIPPROOF_SESSION_PATH: '/secure/agent-a.json' },
  maxBuffer: 16 * 1024 * 1024,
});
const state = JSON.parse(stdout);
```

退出码为 0 时只表示 CLI 请求成功；后台任务仍可能 `failed`。非零时 stderr 是 `{error,code,status?,fields?}`。服务端错误码（如 `STALE_REVISION`、`RUN_ACTIVE`、`PREVIEW_REQUIRED`、`NOT_CONFIGURED`）原样传递。网络中断后，先用 `status` 或已知请求 UUID 查询/幂等重试，不要直接启动第二次有费用的调查。更多 HTTP 语义和预算说明见 [Agent API](AGENT-API.md)。
