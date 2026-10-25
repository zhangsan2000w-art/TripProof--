# TripProof Skill 拆分

原则：按可复用的用户目标拆分；`tripproof` 是**额外的统一入口 Skill**，使其他 Agent 不必先知道子能力名称。下表的 CLI 源于仓库现有 `bin/tripproof.mjs`，不是新造 API。运行前须有已部署的完整 HTTP 服务和 worker；Skill 本身不承载模型/搜索密钥，也不是离线实现。为跨 Agent 搬运，统一入口的 `scripts/tripproof.mjs` 是现有 CLI 的原样副本；不再写第二套请求逻辑。没有输出模板需求，故不建空 `assets/`。

| Skill | 何时触发 / 覆盖的交互与后端能力 | 输入、流程、引用 | 风险、确认、校验与排除 |
| --- | --- | --- | --- |
| `tripproof` | 泛指“用 TripProof 查攻略/核行程/看证据/改日期/查公告/找替代”的跨任务入口；协调下列五个专门 Skill 的完整路径 | 攻略或 tripId、日期/城市、目标与会话。先确认服务和身份，按任务路由；必要时 `extract → 人工校对 → create → investigate → wait/回答 → report`。`references/agent-interface.md` 保存 CLI 与会话约定 | 创建、调查、消息、修复应用、分享前分别确认；不得订票/付款、监控、越权访问。成功以具体状态及证据验证，不以退出码代替任务完成 |
| `tripproof-intake` | 图文攻略提取、草稿校对、建行程；首页读取/编辑/确认交互 | 文字/图片、首日日期、城市、行程详情、是否随分享报告附原攻略；`extract/extraction → draft-trip → 展示核对 → create`。`references/input-and-review.md` 给实际字段与限制 | 模型调用有费用；`create` 非幂等、需明确确认；不自动调查、不替用户填未知时间、不把截图等同证据 |
| `tripproof-investigation` | 启动/恢复/对话/停止调查，读私有证据及分享报告；工作台主流程 | tripId、调查目标、可选追问回答；`investigate → status/wait → message（必要时）→ report`。`references/runs-and-evidence.md` 给状态和判定规则 | 有搜索/模型费用；新运行需确认。`waiting_user` 要问用户；仅 completed 是完整快照。公开链接可能暴露所附攻略，不自动发送 |
| `tripproof-repair` | 调日期、时间、顺序、删站或以已核验候选替换；工作台预览与应用 | tripId、目标操作和 itemId；`status → preview → 展示差异 → apply`。`references/operations.md` 给操作 schema、版本与证据约束 | 应用会持久修改，须具体确认；`STALE_*` 重预览；不负责新搜候选或凭空推断日期适用性 |
| `tripproof-notice` | 对用户给的场馆/微信公告文本或截图寻找独立佐证 | tripId、文字/图片；`announcement → wait/status → 读 announcement 及 evidenceIds`。`references/notice-check.md` | 模型和搜索费用，需确认；截图来源身份不能直接证明官方；不做订阅监控 |
| `tripproof-alternatives` | 对问题行程项找同城替代场馆并核验 | tripId、itemId；`alternatives → wait/status → 读 alternatives`。`references/alternatives.md` | 搜索费用，需确认；候选不是行程修改；替换转 `tripproof-repair`，先预览并确认 |

共同边界：本机搜索 Key 管理、反馈、浏览器打印 PDF、入口密码管理员设置属于页面/环境操作，不纳入常规自动化 Skill；不过能力图和交互清单仍记录其代码入口。`product-capability-map.md` 记录 API 与数据模型，`interaction-inventory.md` 记录页面到 API 的映射。源码变化后应同步维护这些材料；无法确认的接口或语义应标注 `Needs verification`，不能补造。
