# TripProof · 攻略压力测试

把文字、最多六张截图或图文攻略整理成可编辑行程，人工确认后，使用元宝 SearchPro 查找来源，由代码核对日期、开放时间、停止入场、预约规则和抵离边界。报告先给出整趟行程的结论和“出发前先看这几件事”，再按地点显示需调整、可前往、待补时间、待核实，每条规则标注来源强度（官方 / 权威来源 / 多源一致 / 仅供参考），展开后可查看各维度判定及原始证据。

本项目包含 P0、P1、公告截图核验和同城替代场馆。交通与天气按需搜索；没有高德接入、定时监控、账号、预订或支付功能。示例行程也使用真实 API，服务故障不会产生模拟结果。

## 本地运行

需要 Node.js 22.18+（推荐 Node.js 24 LTS）、pnpm 12。SQLite 文件会自动创建。本机 `.env.local` 已配置，保留即可。首次在其他机器安装时：

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
# 编辑 .env.local，填写服务端密钥
pnpm dev
```

打开 http://127.0.0.1:3000 。`pnpm dev` 同时启动网页和后台 worker；调查与事件写入 SQLite，刷新或 SSE 断线后可恢复。中断进程会保留已完成证据，并在失去心跳后标记可重试。

生产模式：

```sh
pnpm build
pnpm start
```

`pnpm start:web` 只启动网页，完整应用请使用 `pnpm start`，或单独运行 `pnpm worker`。不要把 SQLite 文件放在多机器共享的网络盘上；当前部署方式为单台主机、单个 worker。

## 配置

所有密钥仅由服务端读取。不要使用 `NEXT_PUBLIC_` 前缀存密钥；`.env.local`、`docs/key.md`、本地数据库、截图和构建产物均从部署上下文中排除。

| 配置项 | 说明 |
| --- | --- |
| `OPENAI_BASE_URL`、`OPENAI_API_KEY` | 现有 GPT 中转平台的地址和凭据；使用 Responses 接口 |
| `LLM_EXTRACT_MODEL` | 图文提取模型，当前为 `gpt-6.1-sol` |
| `LLM_FACT_MODEL` | 来源事实读取模型 |
| `LLM_EXPLAIN_MODEL` | 解释模型预留配置；当前解释全部使用确定性模板 |
| `LLM_TIMEOUT_MS` | 每次模型请求超时，默认 120000 毫秒；瞬态失败最多重试一次 |
| `WSA_AUTH_MODE` | `api-key` 或 `tencent` |
| `WSA_API_KEY` | 元宝 API Key 鉴权 |
| `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` | 腾讯云 AK/SK 鉴权；与 API Key 二选一 |
| `WSA_TIER` | `standard`、`lite`；留空时识别返回版本并处理不支持的参数 |
| `DATABASE_PATH` | 默认 `.data/tripproof.db`；网页与 worker 必须使用同一文件 |
| `APP_URL` | 完整应用地址，生产环境填写 HTTPS 域名 |
| `ACCESS_REQUIRED` | 公开试部署设为 `1`；漏配密码时保持锁定，魔搭镜像默认开启 |
| `ACCESS_PASSWORD` | 服务端入口密码；页面、报告和所有业务接口均需解锁 |
| `ACCESS_SESSION_SECRET` | 独立随机签名密钥，至少 32 字符；不要使用入口密码代替 |
| `SESSION_DAILY_LIMIT` | 每浏览器每日调查次数，默认 10 |
| `SEARCH_DAILY_LIMIT`、`SEARCH_TOTAL_LIMIT` | 服务端调用预算，默认 1000 / 6000 |
| `USER_AGENT` | 来源链接检查所用标识，部署时填写实际联系信息 |

搜索每场馆最多五次、每轮最多四十次、在途请求最多四个，重试也占预算。搜索结果、链接和场馆档案有缓存，日志区分真实请求与缓存，并保留原 RequestId、检索时间和参数。

读取攻略会先创建后台任务，再短请求查询进度；读取途中刷新页面可继续，不会重复调用模型。图片文件本身不会在浏览器刷新后恢复，需重新选择才能对照原图。上海原文专项回归可运行 `pnpm regression:shanghai`，记录见 [上海回归说明](docs/SHANGHAI-REGRESSION.md)。

## 使用流程

1. 粘贴攻略、上传截图，或填入杭州示例。浏览器移除图片 EXIF，压缩并切分长图后交给模型读取。
2. 核对路线顺序、城市、场馆、日期和计划时间。出发日期默认北京时间的明天，清空后也按明天处理；未写明的具体到达时间保持为空。营业时间保留为攻略规则。修改地点或删除无关建议后确认。
3. 先看整趟行程的结论和待办清单（闭馆冲突、天气与台风报道、需预约且已放票的场馆、待核实地点），再看每站的当天是否开放、营业时间、停止入场和预约要求。需调整、可前往、待补时间、待核实分别展示，全天开放的地点不填时间也算可前往，攻略信息过时单独提示。原文引文、完整来源和调用记录按需展开，同一引用来源合并展示。工作台可补充到达时间，预览后应用；重新调查期间，公开报告保留上一次完整结果。
4. 预览修复或换日期，再应用修改。这两项只使用已存事实，不会重新搜索；证据不覆盖新日期时保持未知。
5. 按需核验公告截图，或为选中的场馆搜索最多两个同城同类替代场馆。候选场馆独立调查，不能核实时会明确说明。
6. 分享公开只读报告，可按天及安排状态筛选。确认行程时默认勾选“报告附上原攻略图文”：截图另存一份不超过 960px 宽、重新编码去除元数据的展示副本，连同攻略文字（移除手机号、证件号和邮箱）显示在报告和工作台的“原攻略”卡片里，每站详情也能看到攻略原文并打开对应截图。分享链接能看到这些内容；取消勾选则只保存行程。打印按钮会先重查来源链接，默认导出带关键引文的简明报告，勾选“打印时附完整证据”后附上完整审计资料。查询卡片可在记录区下载为带来源链接的 Markdown。

操作权限绑定当前浏览器的 HttpOnly Cookie。公开报告链接可跨浏览器阅读，修改行程仍需原浏览器的 Cookie。

开启入口密码后，分享报告也需要先解锁。输入一次记住 7 天，点击页面顶部“锁定访问”退出；不会删除原浏览器的行程编辑权限。更改密码或签名密钥并重启，会使旧登录失效。每个来源连续五次错误会限速最多 15 分钟，另有实例总失败预算；记录写入数据库，不存明文 IP 或密码。此密码用于私人试用，不是独立用户账号。

## 可信性边界

- 引文必须能在检索摘要或已抓取原文中逐字找到，数字、时间及日期另行校验。错误分馆、坏链接和证据不足不产生确认。
- 官方站点需有所属机构的身份依据；`.org.cn` 或标题写“官网”本身不足以证明官方身份。政府与权威媒体报道可独立支持其明确陈述的规则。搜索结果把站点名标成场馆名的网站（如“南京博物院”）按场馆网站计为权威来源，但不称为官方。
- 没有官方或权威来源时，平台需至少两个、普通网页需至少三个互相独立的站点说法一致，且多于任何不同说法；平台页面的发布日期反映抓取或编辑时间，按多数取值而不是只信最新一篇，票数相同时标为来源矛盾。
- 临时关闭优先于营业时间：每座城市查近 7 天的景区关闭、交通停运公告和官方预警。官方或权威来源（或两个独立站点）证实的关闭、停运会把公告范围内的当天安排标为需调整，平台显示“营业中”不能推翻。海边、海岛、山地和涉水点位在台风黄色及以上、暴雨预警或防台应急响应期间默认不安全，不标可前往；露天点位与交通在这类预警期间标为待核实。只有一个转载来源的预警、以及只有天气预报时，不改变任何地点的结论。公告没有逐一点名景点时，按公告写明的地区和对象判断，并在报告中说明依据。末班车时刻不作为恶劣天气下的出行依据，以实时停运公告为准。
- 当天是否开放：明确的开放、闭馆和临时公告优先；写明“每日 / 周一至周日 / 全天开放”的开放时间，或同一来源列出了闭馆日而当天不在其中，也说明当天开放。只有开放时间、没写闭馆日的博物馆不推断开放。
- 临时开放时间不会覆盖独立闭馆事实；局部关闭不会变成全馆关闭。没有发布恢复日期的关闭报道会显示“恢复时间待确认”。未发现公告不证明没有变化。
- 天气按行程城市和日期去重查询，超过七天查询窗口保持未知；天气预报只作为每天的参考信息显示，不改变地点结论，也不进入行程结论和待办。预报表只写“24日(周六)”时，日和星期都对上且来源发布于此前十天内才采用。交通耗时只作有来源的公开参考，实际衔接、实时路况、排队和库存仍需确认。
- 节假日数据附国务院通知、RequestId 和核对时间；没有收录的年份不推测节假日例外。

## 验证命令与记录

```sh
pnpm test
pnpm typecheck
pnpm build
# 保持本地应用运行，以下命令会调用真实服务
pnpm golden
pnpm goldset
pnpm smoke
pnpm test:extensions
pnpm test:images
pnpm test:ux
pnpm test:access
```

- `pnpm golden`：杭州六图、临安文字及地图、南京四图、洞头图文；验证路线、时间、推荐隔离、真实搜索、证据、预算和公开报告。支持 `--case=dongtou`、`--extract-only` 和 `--reuse-extraction`。复用的是之前真实提取的缓存，记录中会注明。通过的报告写入数据库旁的 `sample-reports.json`，首页“真实报告”只展示这份清单里的链接。
- `pnpm samples:export`：将精选清单中的已完成报告导出到 `data/sample-reports.json`，供新部署恢复首页 demo。启动时自动补入缺失报告和清单，重复启动不会覆盖已有行程或再次调用搜索。报告包比当前清单新时，首页改为展示包里的报告，旧报告仍可通过原链接访问；本地之后新跑的 golden 不会被旧包换回。保留实际行程日期、核对时间、来源和 RequestId；包含报告附带的原攻略展示副本；不包含编辑凭据、调查输入、上传的原始文件、缓存或其他行程。报告是历史核对快照，不能当成新的出行结论。更新 golden 后需要重新导出再部署。
- `pnpm goldset`：六个真实场馆的十五项人工标准答案，重新检查来源并通过真实模型读取规则；准确率至少 80%，错误确认必须为零。`--reuse-facts` 可仅回归已存事实。
- `pnpm smoke`：Chrome/Chromium 中完成真实文字提取、人工修改、调查、SSE 续接、刷新恢复、换日期预览及应用、手机布局、分享、反馈和 PDF 导出。macOS 默认使用已安装的 Chrome；其他机器运行 `pnpm exec playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。
- `pnpm test:extensions`：在 smoke 保存的浏览器行程上，真实核验无佐证公告并独立调查最多两个替代场馆。
- `pnpm test:images`：把杭州六图合成长图并附带测试 EXIF，经浏览器上传、分片、去 EXIF 和真实模型读取后，检查原图对照、地点、空计划时间及人工修改；确认前不会搜索。
- `pnpm test:ux`：真实文字提取，检查默认明天及清空日期、补充时间的预览应用、不新增搜索、公开报告筛选、雷峰塔营业与入场时间、证据折叠及去重、手机布局、反馈和简明 PDF。结果保存在 `artifacts/ux/`。
- `pnpm test:access`：开启入口密码后，检查未解锁页面、报告、搜索与 SSE 接口、正确及错误密码、锁定和四份已存 golden 报告；此项不会调用外部搜索。其他流程脚本使用本地 `ACCESS_PASSWORD` 正常登录，不绕过保护。
- `artifacts/golden/`、`artifacts/goldset/`、`artifacts/browser/` 保存实际结果。完整指标与尚未满足的性能目标见 [验收记录](docs/ACCEPTANCE.md)。

核心规则测试与网络调用分开：单元测试使用构造的边界数据；四个 golden case、标准评测的事实提取和浏览器全流程调用真实服务。源码中没有产品模拟数据分支。

原始截图放在本地 `cases/`，实际调用产物在 `artifacts/`；两者均不提交到 Git。运行截图类验收前需自行准备 `data/golden-cases.ts` 引用的本地素材，普通单元测试不依赖这些图片。

## Docker 与 Caddy

魔搭免费 CPU 试部署请先运行 `pnpm deploy:modelscope:prepare`，只上传生成的 `tmp/modelscope/`，不要上传整个项目目录。创建 Docker 创空间、设置运行时环境变量后上线，详细说明见 [魔搭部署说明](deploy/modelscope/README.md)。镜像监听 7860，数据库使用平台持久卷，网页与 worker 同时启动。已在魔搭免费 2 核 / 8GB Docker 资源完成实际构建、容器启动、桌面密码登录和真实调查，重部署后数据保留；实际入口、验收记录和窄屏平台限制见 [本次部署记录](docs/MODELSCOPE-DEPLOYMENT.md)。

GitHub 的 [`modelscope` 分支](https://github.com/ld0574/TripProof/tree/modelscope) 保存魔搭专用部署目录，根目录 Dockerfile 使用 7860 端口和持久卷。日常在 `main` 开发并提交；运行 `pnpm deploy:modelscope:branch` 即可生成并推送部署分支，保留魔搭发布历史和四个 demo。每次同步的源码提交记录在该分支的 `.modelscope-source.json`。首次在新电脑上配置 `git remote add modelscope https://www.modelscope.cn/studios/ld0574/1023isgood.git`，之后用 `git push modelscope refs/remotes/origin/modelscope:refs/heads/master` 推送到魔搭，再在创空间点击“上线”。凭据通过 Git 凭据管理器或平台登录配置，密钥继续使用创空间的密文环境变量。

部署主机需要 Docker Engine 和 Compose，域名 DNS 指向该主机并开放 80/443 端口。将 `.env.local` 放到主机上，填写实际配置和 `APP_URL`，然后运行：

```sh
DOMAIN=trip.example.com ACME_EMAIL=you@example.com docker compose up -d --build
docker compose logs -f app
```

Caddy 自动申请 HTTPS 证书，SSE 关闭代理缓冲。应用以非 root 用户运行；`tripproof-data` 卷保存数据库，Caddy 数据卷保存证书。镜像构建不读取本地凭据、数据库或 cases 图片。当前开发机未安装 Docker；通用 Compose/Caddy 方案尚未在独立 VPS 实测，魔搭专用镜像已通过云端运行验收。

更新时运行同一条 Compose 命令。备份应使用 SQLite 的在线备份能力，例如在维护脚本中执行 `better-sqlite3` 的 `backup()`；不要只复制仍在写入的 `.db` 而遗漏 WAL。恢复前停止应用，将备份放回数据卷并恢复用户权限。

## 代码位置

`lib/llm.ts` 读取攻略；`lib/search/yuanbao.ts` 适配 SearchPro；`lib/evidence.ts` 检查链接与来源；`lib/facts.ts` 验证事实；`lib/judge.ts` 计算判定；`lib/impact.ts` 计算影响和修复；`lib/investigate.ts` 执行调查；`lib/store.ts` 持久化任务与 SSE 事件。`db/schema.ts` 定义 Drizzle 模型，建表和索引自动执行。

技术栈为 Next.js App Router、React、TypeScript、Tailwind、基于 Radix/CVA 的 shadcn 风格组件、SQLite、Drizzle、Zod 和 dayjs。所有行程日期使用 `Asia/Shanghai`。
