# 输入与校对依据

本 Skill 的 `../scripts/tripproof.mjs`（源自项目 `bin/tripproof.mjs`）：`extract --file FILE [--image FILE ...] [--request-id UUID] [--wait]`；`extraction JOB_ID [--wait]`；`draft-trip --input FILE --date YYYY-MM-DD --city CITY [--title TITLE]`；`create --input FILE`。文件参数 `-` 可读 stdin。CLI 图片 jpeg/png/webp，每次最多 6 张，单张 <=4 MB；不做浏览器端的压缩、EXIF 去除或长图切片。服务端 `extractionInputSchema` 允许文字最长 40000 字符、图片 data URL；CLI 限制更窄。后台提取 `requestId` 支持同请求幂等，任务缓存约 30 分钟。

`lib/domain.ts` 中 `Draft`：`guideMeta{title,publishedAt}`、`days[{dayIndex,items}]`、`recommendations`、`ambiguities`。`draft-trip` 只把 `dependsOnPrevious` 转为 `dependsOn` 并生成 ID；不会替用户补时间，也不会提交。`TripInput` 的必需顶层字段：`title,startDate,originCity,destinationCity,arriveDay1,leaveLastDay,mode,guidePublishedAt,items`。`Item` 包含 `id,day,seq,start,end,placeName,city,kind,activity,sourceText,sourceImage,confidence,claimedRules,dependsOn`，可含 `profile`。`mode` 只支持 `transit/drive`。详细校验由 `lib/validate.ts` 与 `tripInputSchema` 执行，行程项 1–50 个。

网页在创建前允许改地点、类型、天数、到离时间、城市、活动说明，增删草稿项；`draft.ambiguities` 和 `confidence<0.7` 提醒人工对照。原攻略宣称的营业/预约规则只是待查主张，不等同官方事实。`guide` 可选：`{text,images:[{sourceIndex,data}]}`，最多 9 张展示图片；服务端会对文字脱敏，但分享页仍可读取附件。CLI 不会自动给 `create` 添加 `guide`，如需附上须经用户选择并在 JSON 中明确加入，注意敏感内容。

`POST /api/trips` 成功返回 201 `{trip}`；没有 create 幂等键。创建不会自动启动搜索；网页按钮会连续调创建与启动，但本 Skill 刻意把两个动作拆开供 Agent 分别确认。
