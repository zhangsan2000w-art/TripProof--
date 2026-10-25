# 人与 TripProof 的交互清单

记号：`C`=创建/写入前需向用户确认具体内容；`$`=可能调用付费模型/搜索；`R`=只读；`B`=浏览器本地行为。除 `/r/:shareId` 的只读报告、健康与入口登录外，私有行程 API 需 owner Cookie；开启入口密码后全站业务还需 `tp_access`。前端错误经 `lib/client.ts` 的 `ApiError` 展示；非零 CLI 错误为 JSON stderr。表中的 Skill 是归属建议，不表示每个按钮都独立成 Skill。

| 页面 / 交互与入口 | 意图、输入、前置条件、步骤和结果 | 前端 → API / 模型；失败或权限 | 归属 |
| --- | --- | --- | --- |
| `/` 首页导航、流程说明、示例报告卡片、统计 | 浏览介绍或既有历史报告；点样例进 `/r/:shareId`。输入无；结果只读 | `app/page.tsx`、`components/brand.tsx` → `sampleReports()`/`statistics()`；样例可能为空；报告快照非实时。R | 不封装；`tripproof` 的背景资料 |
| `/` 文字/截图模式切换、粘贴、示例填入 | 准备攻略文字或图；前端限制文字 4 万字、JPG/PNG/WebP、最多 9 张，图片上传时预处理。结果为浏览器草稿 | `components/home-form.tsx`、`lib/images-client.ts`；无服务端调用；格式、数量错误在界面显示。B | `tripproof-intake` |
| `/` 读取攻略与断点续查 | 输入非空文字或图片；提交后台提取并轮询，刷新可用 sessionStorage 中任务 ID 续查；返回 `Draft` 与歧义，不开始搜索核验 | `components/home-form.tsx`、`lib/extraction-client.ts` → `GET/POST /api/extract`、`GET /api/extract/:id`；模型/配额/超时/图像失败。$；owner Cookie | `tripproof-intake` |
| `/` 校对读取结果 | 设置日期、目的/出发城市、抵离时间、出行方式；编辑地点、类型、天数、到离时间、城市、说明，删除/新增草稿项，查看原图与歧义，选择是否附原攻略 | `components/home-form.tsx`；本地 `Draft/Item/TripInput/Guide`；未提交前可撤回。B | `tripproof-intake` |
| `/` 确认行程开始核对 | 校对完成且有目的城市/行程项；保存行程，随后启动调查并跳工作台；创建成功但启动失败可在工作台重试 | `components/home-form.tsx` → `POST /api/trips`、`POST /api/trips/:id/runs`；无创建幂等键，模型/搜索未配置可报错。C+$ | `tripproof-intake` → `tripproof-investigation` |
| `/trips/:id` 工作台打开、刷新/SSE | 读取私有 TripState、结果、事件，按事件增量展示；下钻证据与调用记录 | `components/workspace.tsx` → `GET /api/trips/:id?after=`、`GET /api/runs/:id/events?after=`；断线回退拉取；跨 owner 404。R | `tripproof-investigation` |
| 工作台“开始检查/重新检查” | 当前无运行任务；启动一轮真实调查/复查；结果经 worker 写入 | `components/workspace.tsx` → `POST /api/trips/:id/runs`；`Run`，配置/配额/并发错误。C+$ | `tripproof-investigation` |
| 工作台 Agent 对话、回答/暂不补充 | 发送请求 UUID、当前 revision、文字及可选待回答问题 ID；等待同一任务续跑或开启对话任务；可声明保留未知 | `components/agent-chat.tsx` → `POST /api/trips/:id/messages`；`AgentMessage/Checkpoint`；`STALE_REVISION/QUESTION_EXPIRED/REQUEST_CONFLICT/RUN_ACTIVE`。C（消息内容） | `tripproof-investigation` |
| 工作台“停止调查” | 用户要求停止时取消运行中的或等待中的 Run；保留已有证据与费用 | `components/agent-chat.tsx` → `POST /api/runs/:id/cancel`；跨 owner 拒绝。C | `tripproof-investigation` |
| 工作台行程、按天/证据/记录标签，选中站点 | 查日期、逐站判定、来源、限制、搜索 RequestId；不变更数据 | `components/workspace.tsx`、`components/evidence-panel.tsx`、`components/call-log.tsx`；使用 `TripState`、`Judgment/Dossier/SearchCall`。R/B | `tripproof-investigation` |
| 工作台补计划时间 | 对指定 `itemId` 提交 `shift`，先预览到达/离开时间影响 | `components/workspace.tsx` → `POST /api/trips/:id/whatif`，`apply:false`；缺已存事实/版本变化会失败。R/C | `tripproof-repair` |
| 工作台换日期 | 输入第 1 天新日期，预览重新判定；没有新搜索 | `components/workspace.tsx` → 同上，`startDate`；超出事实时效保持 unknown。R/C | `tripproof-repair` |
| 工作台建议修复、Agent 提案预览 | 点击建议操作或已保存 `proposalId`；查看变更前后、结果与待核实项 | `components/workspace.tsx` → `POST /api/trips/:id/whatif`，`apply:false`；`Operation/AgentProposal`。R | `tripproof-repair` |
| 工作台“应用修改/保留原行程” | 对已预览方案明确同意后应用；保留则不调用。应用提升 revision 并重新计算 | `components/workspace.tsx` → `POST /api/trips/:id/whatif`，`apply:true`；`STALE_PROPOSAL/RUN_ACTIVE/PREVIEW_REQUIRED`。C | `tripproof-repair` |
| 工作台核验公告 | 输入文字/截图，先读公告再另行搜索佐证；结果进入 `announcement` | `components/workspace.tsx` → `POST /api/trips/:id/announcements`；格式/配额/运行冲突。C+$ | `tripproof-notice` |
| 工作台找同城替代场馆 | 选定 `itemId`，查至多两个候选并独立核验；展示候选依据，不自动替换 | `components/evidence-panel.tsx`、`components/workspace.tsx` → `POST /api/trips/:id/alternatives`；`ITEM_NOT_FOUND`、配额/任务冲突。C+$ | `tripproof-alternatives` |
| 工作台复制分享链接/查看报告 | 复制或打开 `/r/:shareId`；URL 持有者可见结果及选择附带的原攻略 | `components/workspace.tsx`、`app/r/[shareId]/page.tsx`；剪贴板可能失败；入口密码模式仍需解锁。C（对外分享）/B | `tripproof-investigation` |
| `/r/:shareId` 逐站报告、筛选/展开、证据、原攻略查看 | 查看完整快照与待办、来源、图片；按天和结论筛选，展开详情 | `components/report-view.tsx`、`guide-view.tsx` → `GET /api/reports/:shareId/guide[/index]`；报告不存在 404；未完成时为空/旧快照。R/B | `tripproof-investigation` |
| 报告“核查链接并打印 PDF”及下载查询卡片 | 可选全证据，先复查来源链接，再浏览器打印 PDF；单条卡片本地生成 Markdown | `components/report-view.tsx` → `POST /api/reports/:shareId/links`；浏览器 `window.print`/Blob；复查有网络与配额，CLI 无导出命令。C（复查联网）/B | 不封装独立 Skill；报告参考说明 |
| 报告/工作台判定赞踩 | 对具体判定反馈有帮助/无帮助；写入按会话覆盖的反馈 | `components/evidence-panel.tsx` → `POST /api/feedback`；`Judgment` ID 必须存在。C | 不封装；低频反馈操作 |
| `/access` 密码登录/锁定 | 输入入口密码，成功写 `tp_access`，锁定清除该 Cookie，保留 owner | `app/access/page.tsx`、`app/api/access/login/route.ts`、`logout/route.ts`、`lib/access.ts`；错误密码限流；非 owner 无法编辑。C | `tripproof` 的鉴权准备 |
| `/settings` 保存/移除/启停搜索 Key 与验证 | 仅本机且启用入口；管理 DeepSeek/元宝配置，验证发一次真实搜索 | `components/local-settings.tsx` → `GET/POST /api/local-settings`、`POST /check`；`lib/search/settings.ts` 本机限制、服务端文件副作用。C+$ | 不封装；管理员操作与常规行程任务分离 |

### 无前端主入口或非 Agent 任务

- `GET /api/health`、`GET /api/stats` 可由 CLI/首页调用；健康不等于上游凭据可用。
- `GET /api/trips/:id/messages` 提供 Agent 视图；工作台主要从 `GET /api/trips/:id` 获得同类数据。`GET /api/runs/:id/events` 是前端 SSE，也可由自建客户端续接。
- 没有“删除行程”“导入/导出行程文件”“付款/订票”“权限成员管理”“定时监控”入口及对应后端能力，不应据此生成 Skill。
