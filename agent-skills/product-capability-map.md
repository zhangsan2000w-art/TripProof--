# TripProof 产品能力图（基于当前代码）

## 运行边界

| 层 | 实际实现 | 代码依据 |
| --- | --- | --- |
| 前端 | Next.js 16 App Router、React 19 客户端组件、原生 `fetch`/`EventSource`、组件局部状态；无全局状态库 | `package.json`、`app/`、`components/home-form.tsx`、`components/workspace.tsx`、`lib/client.ts` |
| 服务端 | Next Route Handlers；调查由独立 Node worker 从 SQLite 队列领取；提取任务由 `after()` 异步执行 | `app/api/`、`scripts/worker.ts`、`lib/extractions.ts`、`lib/store.ts` |
| 存储 | SQLite + Drizzle；行程、任务、证据、判定、事件、Agent 检查点/消息/预览、反馈、配额与缓存 | `db/index.ts`、`db/schema.ts` |
| Agent 接口 | 现成 JSON CLI 是 HTTP 客户端，不是离线核验器；`bin/tripproof.mjs` 和 `docs/CLI.md` | `bin/tripproof.mjs` |
| 鉴权 | 可选入口密码 `tp_access`；行程编辑权靠 `tp_session` owner Cookie；分享 ID 只读报告 | `proxy.ts`、`lib/access.ts`、`lib/http.ts`、`lib/store.ts` |
| 上游 | OpenAI 兼容模型、元宝 SearchPro；可选 DeepSeek Search；网页抓取与来源核验 | `lib/llm.ts`、`lib/search/`、`lib/evidence.ts` |
| 配置 | 服务端环境变量；仅本机条件满足时有搜索 Key 设置页面；无对外管理 API | `.env.example`、`lib/search/settings.ts`、`app/settings/page.tsx` |

网页路由：`/` 输入与样例；`/trips/:id` 私有工作台；`/r/:shareId` 公开只读报告；`/access` 入口密码；`/settings` 仅本机搜索配置。`proxy.ts` 在开启入口密码时保护页面、报告、API 和事件流；`/api/health` 例外。

## 面向业务的能力

以下“确认”指其他 Agent 应在执行前取得用户针对具体内容的同意；不是服务端额外的确认端点。所有写接口均按 owner Cookie 或当前会话执行，未指定的请求字段以源码 schema 为准。

| 能力 / 用户意图 | 入口、输入与响应 | 模型 / 副作用 / 幂等性 | Agent 安全边界 |
| --- | --- | --- | --- |
| 读取图文攻略 | `POST /api/extract`：`text, images, background, requestId?` → `{job}`（异步）或 `{draft}`；`GET /api/extract/:id` → `{job}`；CLI `extract`/`extraction` | `Draft` 含天、地点、来源、置信度、歧义；调用模型、计额度。后台 `requestId` 可幂等续查；任务缓存约 30 分钟 | 可按用户请求读取；图片与文本可能敏感。CLI 每次最多 6 张、单张 4 MB，且不替网页做 EXIF/长图处理 |
| 校对并保存行程 | `POST /api/trips`：`TripInput` + 可选 `guide` → `{trip}`；CLI `draft-trip` 本地转换、`create` 保存 | `Trip`、`Item`、`Guide`；创建持久记录与可分享 ID；无创建幂等键 | 必须展示并确认地点、顺序、日期、时间和附原攻略选择后才 `create`；超时后先核查状态，避免重复创建 |
| 启动逐站调查 | `POST /api/trips/:id/runs` → `{runId,run}`；CLI `investigate` | 建立 `Run`，worker 调模型、搜索、抓页并产生 `Dossier/Judgment`；非幂等新任务；每日配额 | 有费用；启动/重新调查前确认。`NOT_CONFIGURED` 时需服务端配置；`RUN_ACTIVE` 时不叠加任务 |
| 观察状态与证据 | `GET /api/trips/:id` → `TripState`；`GET /api/runs/:id/events?after=N` → SSE；CLI `status`/`wait`/`report` | 只读；`Run.status` 可为 queued/running/waiting_user/completed/failed/cancelled | 只把 completed 的结果称为完整快照；按 `Judgment` 的 verdict、来源与适用日期解释未知/冲突，不把缓存或缺证据说成确认 |
| 对话与回答追问 | `GET/POST /api/trips/:id/messages`：`requestId,revision,text,replyTo?` → `{messageId,runId}`；CLI `message` | 保存 `AgentMessage`，可恢复等待任务或创建对话任务；同 UUID 同内容幂等；新消息可能触发 Agent 工作 | 回答 `replyTo` 要取当前未回答问题；不能自行编造用户信息；网络重试必须沿用 UUID 和内容 |
| 取消调查 | `POST /api/runs/:id/cancel` → `{run}`；CLI `cancel` | 停止未结束任务、保留证据；重复取消幂等；在途调用仍可能计费 | 用户要求停止时调用；不要称作删除行程或退款 |
| 修复预览与应用 | `POST /api/trips/:id/whatif`：`revision, ops/startDate/proposalId, apply` → `{proposalId,trip,result,searched:false,applied}`；CLI `preview`/`apply` | 预览只用已存事实；应用更新行程 revision；`shift/swap/drop/replace`。候选替换必须已存且独立核验；提案绑定版本及证据指纹 | 应用前展示差异并再次确认；`STALE_REVISION/STALE_PROPOSAL` 时重新预览，绝不强行应用 |
| 公告真伪核验 | `POST /api/trips/:id/announcements`：攻略式 `text/images` → `{runId}`；CLI `announcement` | 模型先读公告，再异步搜索佐证，更新 `RunResult.announcement`；单次配额和上游调用 | 截图本身不是官方身份；有费用，启动前确认；完成前不下结论 |
| 同城替代场馆 | `POST /api/trips/:id/alternatives`：`itemId` → `{runId}`；CLI `alternatives` | 独立调查候选开放、时间、预约；结果写入 `RunResult.alternatives`；有费用 | 提供候选不等于自动替换；真正替换走预览与确认 |
| 分享与审阅报告 | `/r/:shareId`，`GET /api/reports/:shareId/guide`、`/guide/:index`；CLI `report` 返回 URL 和报告数据 | 分享 ID 可访问报告及选择附带的原攻略；报告无私人对话和检查点 | 分享前告知 URL 持有者可见内容；历史报告是快照，不是实时可行承诺 |
| 打印与链接复查 | `POST /api/reports/:shareId/links` → `{result,searched:false}`；浏览器打印 PDF、下载单条 Markdown 查询卡片 | 复查链接可联网且按会话小时配额；PDF/Markdown 由前端浏览器生成，没有后端文件导出接口 | CLI 不提供 PDF 或 Markdown 导出命令；不可伪称有下载 API |
| 判定反馈 | `POST /api/feedback`：`judgmentId,vote,tripId?/shareId?` → `{ok:true}` | `feedback` 表按会话覆盖赞/踩；无审核状态流转 | 仅在用户明确要求反馈时提交；CLI 暂无该命令 |
| 本机搜索配置 | `GET/POST /api/local-settings`、`POST /api/local-settings/check` | 搜索 Key 覆盖保存到数据库旁配置文件；连接验证会真实搜索 | 仅本机可用且无 CLI 命令；密钥修改需明确同意，不由 TripProof 任务 Skill 自动执行 |
| 统计 / 健康 | `GET /api/stats`、`GET /api/health` | 只读；health 仅代表服务/数据库可用，不证明搜索与模型配置 | 不把 health `ok` 等同完整调查能力 |

## 数据、权限与非能力

- `TripInput` 必需：标题、出发日期、出发/目的城市、首日抵达与末日离开（可为 `null`）、交通模式、攻略发布日期（可为 `null`）、1–50 个行程项。`Item` 含 `id/day/seq/placeName/city/kind/start/end/activity/sourceText/sourceImage/confidence/claimedRules/dependsOn`；详细 schema 在 `lib/domain.ts`，创建前由 `lib/validate.ts` 二次校验。
- `RunResult` 包含 `dossiers`、`judgments`、`ripples`、`suggestions`、`alternatives`、`announcement`、`limitations`。`Judgment.verdict` 为 `confirmed/conflict/unknown`；`Dossier` 保存来源、事实、检索调用与限制。
- `db/schema.ts` 中的 `agent_checkpoints`、`agent_messages`、`agent_proposals` 支持恢复与预览；`usage`、`cache`、`feedback` 支持预算/缓存/反馈。worker 使用同一 `DATABASE_PATH`，需要与网页同时运行。
- 同一行程不支持多个 owner 协作编辑；无账户、行程列表、行程删除、预订/付款、定时监控、实时库存确认或高德导航能力。前端删除的是**创建前的草稿项**，或者经预览应用后的行程项，不是删除整个行程。
- 服务器搜索预算、上游费用、链接可靠性和内容时效均受限；未搜到不等于不存在。详情见项目 `docs/AGENT-API.md` 与 `README.md`，这些项目文档仅在有仓库副本时可读。
