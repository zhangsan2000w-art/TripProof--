---
domain:
  - multi-modal
language:
  - zh
tags:
  - 旅行
  - 行程核查
  - Next.js
---

# TripProof · 私人试用

把旅行攻略整理成可校对行程，确认后由行程 Agent 查证开放、入场和预约规则。支持持久对话、补充要求、暂停回答、停止调查及修复预览；修改由用户应用。应用需要访问密码，报告链接也需解锁，公开报告不包含私人对话。

空间类型请选择 **Docker**。容器监听 `0.0.0.0:7860`，同时运行网页与调查 worker；数据库保存在 `/mnt/workspace/tripproof/tripproof.db`。免费 CPU 的额度和休眠政策以平台创建页为准。

当前建议使用电脑试用：2026-10-23 的窄屏检查发现，魔搭全屏运行页在 390px 视口仍把内层应用设为 1280px，导致内容被截断；直接应用链接也会转入该框架。本应用在本地 390px 的响应式布局已通过，但不能把它等同于魔搭手机端可用。该平台外层限制仍待解决。

部署步骤：

1. 登录魔搭，绑定已实名认证的阿里云账号，创建编程式创空间，SDK 选 Docker，资源选页面提供的免费 CPU 规格。
2. 在原项目运行 `pnpm deploy:modelscope:prepare`。把生成的 `tmp/modelscope/` **里面的文件和目录**上传到创空间仓库根目录，确保根目录能看到 Dockerfile；不要再套一层 modelscope 文件夹。也可以克隆平台提供的 Git 仓库，把这些文件提交到其 Master 分支。
3. 在“设置 → 环境变量”填写下表。密钥只填在运行时环境变量中，不写入仓库文件。新部署不要直接上传原项目目录。
4. 点击“上线”，查看构建及运行日志，等待网页就绪和 `investigation worker ready`。运行后取得 `https://空间标识.ms.show` 应用地址，将它填入 `APP_URL` 并重启。
5. 打开应用，平台可能自动转入魔搭全屏运行页。确认先显示密码页，解锁后再进行一次小行程调查。检查搜索、事件流和重启后的数据保留；这些检查需要真实部署环境。

准备脚本不会覆盖已有输出目录，更新时可运行 `pnpm deploy:modelscope:prepare --out=tmp/modelscope-next` 生成新目录。

## 从 GitHub 分支发版

完整源码位于 GitHub 的 `main`，[`modelscope` 分支](https://github.com/ld0574/TripProof/tree/modelscope) 是生成的魔搭部署目录，沿用创空间的发布历史。请在 `main` 修改代码并提交，再运行：

```sh
pnpm deploy:modelscope:branch
```

该命令在临时目录生成部署文件，提交并推送到 GitHub 的 `modelscope` 分支，当前工作区仍保持 `main`。源码有未提交修改时会停止；并发推送冲突时不会强制覆盖。`.modelscope-source.json` 记录对应的 `main` 提交。同步 GitHub 分支后，需要推送到魔搭才会更新创空间代码。

新电脑首次添加魔搭远端（通过 Git 凭据管理器或平台登录配置鉴权，远端地址中不要放令牌）：

```sh
git remote add modelscope https://www.modelscope.cn/studios/ld0574/1023isgood.git
```

每次发版，在 `main` 执行完同步命令后：

```sh
git push modelscope refs/remotes/origin/modelscope:refs/heads/master
```

随后在创空间点击“上线”，等待构建完成。访问应用的 `/api/health`，返回的 `sourceCommit` 应与部署分支 `.modelscope-source.json` 中的 `main` 提交一致。若魔搭远端已产生额外提交导致推送被拒绝，应先检查并合并发布历史；不要使用强制推送。

首页四个 demo 来自随代码发布的 `data/sample-reports.json` 精选报告包。启动时会将缺失报告补入持久卷数据库并恢复展示清单；已有行程不会被覆盖，也不会重新搜索。新导出的报告包会替换首页对应案例的展示链接，旧报告仍可通过原链接访问。示例保留原出行日期和实际核对时间。更新示例时，先在原项目运行 `pnpm samples:export`，再生成上传目录。此报告包仅包含明确选中的已完成报告及其附带的原攻略展示图文，不包含本地数据库、编辑凭据、上传的原始文件和其他行程。

请在创空间设置中填写以下**运行时环境变量**后上线，不要把 `.env.local` 或密钥上传到空间文件：

| 名称 | 值 |
| --- | --- |
| `ACCESS_REQUIRED` | `1`（镜像默认值，保持开启） |
| `ACCESS_PASSWORD` | 部署者选择的访问密码 |
| `ACCESS_SESSION_SECRET` | 随机生成的至少 32 字符密钥，与访问密码不同 |
| `APP_URL` | 实际独立应用的 HTTPS 地址，不是创空间介绍页地址 |
| `OPENAI_BASE_URL`、`OPENAI_API_KEY` | GPT 中转地址及密钥 |
| `LLM_EXTRACT_MODEL`、`LLM_FACT_MODEL`、`LLM_EXPLAIN_MODEL` | 当前配置使用的模型名 |
| `LLM_AGENT_MODEL` | 可选，默认沿用事实模型，选择下一步工具行动 |
| `WSA_AUTH_MODE` | `api-key` |
| `WSA_API_KEY` | 元宝搜索 API Key |
| `WSA_API_KEYS` | 可选，多 Key 用逗号分隔（或换行），最多 32 个；非空时优先于 `WSA_API_KEY`，请求依次轮询 |
| `WSA_TIER` | `standard` |
| `SESSION_DAILY_LIMIT` | 建议试用先设 `3` |
| `SESSION_MESSAGE_LIMIT` | 每浏览器每日对话上限，默认 `60` |
| `SEARCH_DAILY_LIMIT` | 建议试用先设 `200` |
| `SEARCH_TOTAL_LIMIT` | 按实际套餐余量设置 |

多 Key 同样只填在密文变量中。重复 Key 自动去重；失效或额度不足的 Key 暂停 15 分钟，限流按 `Retry-After` 暂停（默认 30 秒，最多 5 分钟），使用其他可用 Key 重试。每次实际请求均计入预算，搜索上限和并发不因 Key 数量增加；全部不可用时报告失败。轮询与冷却状态在进程重启后重置。

生成签名密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

未配置密码或签名密钥时，应用拒绝启动；不会因为漏配而开放内容。密码在服务端校验，使用 HttpOnly Cookie 记住 7 天；可点击“锁定访问”退出。更改密码或签名密钥并重启可使旧 Cookie 失效。连续 5 次错误需等待最多 15 分钟，整个实例同时有失败次数上限。健康检查只返回存活状态与公开源码提交，不包含凭据或用户数据。

魔搭镜像在构建和运行时设置 `APP_FRAME_MODE=modelscope`：仅允许 `www.modelscope.cn` 与 `modelscope.cn` 嵌入，入口和行程 Cookie 使用 HttpOnly、Secure、SameSite=None、Partitioned，支持平台全屏框架中的登录与编辑。普通 Node/VPS 构建保持禁止嵌入和 SameSite=Lax。更改构建模式需重新构建；第三方浏览器若禁用分区 Cookie，需允许该站点使用 Cookie。

入口密码保护运行内容；空间源码的可见性由魔搭设置决定，可选择“体验公开、源码隐藏”。此上传目录不包含本地攻略原始文件、报告数据库、账户配置或 API 凭据；示例报告的原攻略展示副本在精选报告包里。

免费的是托管资源，GPT 与元宝搜索仍可能计费。休眠后需等待平台唤醒；有检查点的失联调查会在心跳超时后重新入队，保留已完成步骤及剩余预算。等待用户回答时释放 worker，等待时间不计入八分钟活动上限。平台保留 `/mnt/workspace` 数据，但重命名或转移空间仍可能丢失，重要数据应单独备份。当前版本使用单实例、单 worker，不要开启多副本。

官方说明：[Docker 创空间](https://www.modelscope.cn/docs/studios/docker) · [资源规格](https://www.modelscope.cn/docs/studios/resource-selections)。当前项目已在免费 2 核 / 8GB 资源验证容器构建、持久卷权限、GPT 和 SearchPro、SSE 及重部署后的数据保留；长时间闲置休眠后的唤醒行为尚未实测。
