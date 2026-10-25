# 任务与证据

`investigate TRIP_ID [--wait]` 建立新 Run；不等待返回 `{runId,run}`，等待时返回私有 `TripState`。`status TRIP_ID` / `wait TRIP_ID` 返回 `trip,run,runs,result,events,agent`。`message TRIP_ID --text TEXT [--reply-to QUESTION_ID] [--request-id UUID]` 返回 `{requestId,messageId,runId}`；重试同一 UUID 与内容。`cancel RUN_ID` 返回 `{run}`。`report TRIP_ID` 返回 `tripId,shareId,url,run,result`；未完成时 `result` 可能为空或仍在更新。CLI `--wait` 默认 600 秒，超时不取消任务。

`Run.status`：`queued/running/waiting_user/completed/failed/cancelled`。`waiting_user` 会释放 worker 并保留检查点；回答后恢复同一预算。对话普通解释和修复可复用已有事实，明确要求复查才联网。`RunResult` 包含 `dossiers/judgments/ripples/suggestions/alternatives/announcement/limitations`。`Judgment` 的 `verdict` 为 `confirmed/conflict/unknown`，还有 `date/type/reasonCode/explanation/factIds/evidenceIds/searchedScope/notes/judgedAt`。不能将 `unknown`、空来源、旧快照或“未找到公告”解释为安全/有票。

单轮最多 40 次搜索、单场馆最多 5 次、在途最多 4 个；最多 12 次行动决策、活动时间上限约 8 分钟。上游模型/搜索预算另有配额。检索证据可能命中解析缓存，但会保留原检索时间；动态公告/预警/天气需本轮查询。工作台事件流可按最后事件 ID 续接；终态与 waiting_user 结束连接。报告页面 `/r/:shareId` 为只读完整快照，不公开私人 Agent 对话/检查点，但可能含提交时选择附带的原攻略文字/图片。浏览器 PDF 及 Markdown 查询卡片不由 CLI 生成。

证据归因依 `Dossier.evidence/facts/calls` 与 `Judgment.evidenceIds`；查看来源身份、分馆是否匹配、引文、发布日期、检索时间和有效日期。实时库存、实际排队/交通、未获可靠证据的信息可能仍须用户自行确认。健康接口仅检查服务与数据库，不证明搜索与模型配置。
