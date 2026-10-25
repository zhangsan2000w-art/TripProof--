# 候选调查约束

`alternatives TRIP_ID ITEM_ID [--wait]` 调用 `POST /api/trips/:id/alternatives`，输入 `{itemId}`，立即返回 `{runId}` 或等待返回完整私有 `TripState`。服务检查 itemId 属于当前行程，建立 `Run(kind='alternatives')`，worker 在 `lib/investigate.ts` 中独立核验候选场馆；现有实现候选上限为 2。接口无请求幂等键，超时后用 `status/wait` 而不是再启动一次。

`RunResult.alternatives[]` 每项为 `{itemId,name,reason,dossier,judgments}`。`dossier` 包含候选 `venue.id`、证据、事实和检索记录；`judgments` 可能有 unknown，不能因为是候选就宣称适合当天。服务替换规则见 `lib/agent.ts`/`app/api/trips/[id]/whatif/route.ts`：`replace.alternativeId` 只能是当前结果中目标项已保存候选的 `dossier.venue.id`；后续必须先预览再应用。UI 对应工作台“查找同城替代场馆”。
