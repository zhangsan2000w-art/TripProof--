# 操作、版本与结果

`preview TRIP_ID --input ops.json` 的文件是 `Operation[]`，最多 10 个；或者 `preview TRIP_ID --date YYYY-MM-DD`。CLI 自动读取当前 `trip.revision` 并向 `/api/trips/:id/whatif` 发送 `apply:false`。`apply TRIP_ID PROPOSAL_ID` 发送 `revision/proposalId/apply:true`。服务返回 `{proposalId,trip,result,searched:false,applied}`。

`lib/domain.ts` 的操作类型：

```json
[{"type":"shift","itemId":"行程项ID","start":"16:00","end":"17:00"}]
```

- `shift`: `itemId,start,end`，`end` 可为 `null`，时间 `HH:mm`。
- `swap`: `itemId,otherItemId`。
- `drop`: `itemId`。
- `replace`: `itemId,alternativeId`；候选必须来自当前 `result.alternatives` 中属于此项、已独立核验并保存的 `dossier.venue.id`。

只改首日日期用 `startDate`，不是每站分别改日期。服务端预览绑定行程 revision 与结果指纹；应用会重新计算，证据/行程/判定变化会报 `STALE_PROPOSAL`。调查正在写证据时 `RUN_ACTIVE`。预览和应用均不新搜；新日期超出已存事实适用范围时相关判断仍为 `unknown`，实时名额也不会因此得到确认。应用保存重算结果并提升 revision，不是创建全新行程；若旧任务正 `waiting_user`，应用会结束它。
