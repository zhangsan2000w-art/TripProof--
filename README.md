---
license: Apache License 2.0
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

把旅行攻略整理成可校对行程，再核对开放、入场和预约规则。应用需要访问密码，报告链接也需解锁。

空间类型请选择 **Docker**。容器监听 `0.0.0.0:7860`，同时运行网页与调查 worker；数据库保存在 `/mnt/workspace/tripproof/tripproof.db`。免费 CPU 的额度和休眠政策以平台创建页为准。

部署步骤：

1. 登录魔搭，绑定已实名认证的阿里云账号，创建编程式创空间，SDK 选 Docker，资源选页面提供的免费 CPU 规格。
2. 在原项目运行 `pnpm deploy:modelscope:prepare`。把生成的 `tmp/modelscope/` **里面的文件和目录**上传到创空间仓库根目录，确保根目录能看到 Dockerfile；不要再套一层 modelscope 文件夹。也可以克隆平台提供的 Git 仓库，把这些文件提交到其 Master 分支。
3. 在“设置 → 环境变量”填写下表。密钥只填在运行时环境变量中，不写入仓库文件。新部署不要直接上传原项目目录。
4. 点击“上线”，查看构建及运行日志，等待网页就绪和 `investigation worker ready`。运行后取得 `https://空间标识.ms.show` 应用地址，将它填入 `APP_URL` 并重启。
5. 打开应用，平台可能自动转入魔搭全屏运行页。确认先显示密码页，解锁后再进行一次小行程调查。检查搜索、事件流和重启后的数据保留；这些检查需要真实部署环境。

准备脚本不会覆盖已有输出目录，更新时可运行 `pnpm deploy:modelscope:prepare --out=tmp/modelscope-next` 生成新目录。

请在创空间设置中填写以下**运行时环境变量**后上线，不要把 `.env.local` 或密钥上传到空间文件：

| 名称 | 值 |
| --- | --- |
| `ACCESS_REQUIRED` | `1`（镜像默认值，保持开启） |
| `ACCESS_PASSWORD` | 部署者选择的访问密码 |
| `ACCESS_SESSION_SECRET` | 随机生成的至少 32 字符密钥，与访问密码不同 |
| `APP_URL` | 实际独立应用的 HTTPS 地址，不是创空间介绍页地址 |
| `OPENAI_BASE_URL`、`OPENAI_API_KEY` | GPT 中转地址及密钥 |
| `LLM_EXTRACT_MODEL`、`LLM_FACT_MODEL`、`LLM_EXPLAIN_MODEL` | 当前配置使用的模型名 |
| `WSA_AUTH_MODE` | `api-key` |
| `WSA_API_KEY` | 元宝搜索 API Key |
| `WSA_TIER` | `standard` |
| `SESSION_DAILY_LIMIT` | 建议试用先设 `3` |
| `SEARCH_DAILY_LIMIT` | 建议试用先设 `200` |
| `SEARCH_TOTAL_LIMIT` | 按实际套餐余量设置 |

生成签名密钥：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

未配置密码或签名密钥时，应用拒绝启动；不会因为漏配而开放内容。密码在服务端校验，使用 HttpOnly Cookie 记住 7 天；可点击“锁定访问”退出。更改密码或签名密钥并重启可使旧 Cookie 失效。连续 5 次错误需等待最多 15 分钟，整个实例同时有失败次数上限。健康检查仅返回存活状态。

魔搭镜像在构建和运行时设置 `APP_FRAME_MODE=modelscope`：仅允许 `www.modelscope.cn` 与 `modelscope.cn` 嵌入，入口和行程 Cookie 使用 HttpOnly、Secure、SameSite=None、Partitioned，支持平台全屏框架中的登录与编辑。普通 Node/VPS 构建保持禁止嵌入和 SameSite=Lax。更改构建模式需重新构建；第三方浏览器若禁用分区 Cookie，需允许该站点使用 Cookie。

入口密码保护运行内容；空间源码的可见性由魔搭设置决定，可选择“体验公开、源码隐藏”。此上传目录不包含本地攻略图片、报告数据库、账户配置或 API 凭据。

免费的是托管资源，GPT 与元宝搜索仍可能计费。休眠后需等待平台唤醒；运行中被中断的调查会保留已完成证据，并提示重试。平台保留 `/mnt/workspace` 数据，但重命名或转移空间仍可能丢失，重要数据应单独备份。当前版本使用单实例、单 worker，不要开启多副本。

官方说明：[Docker 创空间](https://www.modelscope.cn/docs/studios/docker) · [资源规格](https://www.modelscope.cn/docs/studios/resource-selections)。容器构建、持久卷权限、外网 API、SSE 和休眠唤醒仍需在实际空间中验收。
