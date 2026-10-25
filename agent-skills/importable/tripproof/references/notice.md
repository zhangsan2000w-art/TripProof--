# 公告核验约束

`announcement TRIP_ID --file FILE [--image FILE ...] [--wait]` 读取文字与图片，CLI 图片最多 6 张、单张不超过 4 MB，不做 EXIF 移除或长图切片。至少提供文字或图片。CLI 发送到 `POST /api/trips/:id/announcements`；服务先用 `lib/investigate.ts` 的 `readAnnouncement` 读取标题、场馆、城市和最多 8 条主张，然后创建 `Run(kind='announcement')`。`--wait` 返回完整私有状态；不等待返回 `{runId}`。无请求幂等键，网络不明时先查询 `status`。

结果位于 `RunResult.announcement`：`title,claims,verdict,explanation,evidenceIds`。`verdict` 仍为 `confirmed/conflict/unknown`；来源详情在 `dossiers`。公告截图只作为待核主张输入，不提供官方认证；需要独立佐证且核对场馆分馆、发布日期和适用日期。`result` 可能在任务未完成时仍是上次快照。UI 对应 `components/workspace.tsx` 的“核验公告”。
