# 魔搭免费试部署记录

核验日期：2026-10-23，Asia/Shanghai。

- 应用入口：[TripProof 全屏运行页](https://www.modelscope.cn/studios/ld0574/1023isgood?mode=full)。
- 空间：[ld0574/1023isgood](https://www.modelscope.cn/studios/ld0574/1023isgood)。
- 运行地址：`https://ld0574-1023isgood.ms.show`，浏览器访问会自动转入平台运行框架；报告路径通过平台 `app_path` 保留。
- 资源：`platform/2v-cpu-8g-mem`，官方 API 标记为免费资源；SDK 为 Docker，单实例、单 worker。
- 运行镜像代码提交：`81862a6c724bb67956a9f8e1030fb00bccb16a2c`。

空间保持“体验公开、源码隐藏”。运行内容由服务端密码保护，报告链接和业务 API 也需要解锁。访问密码与随机签名密钥、GPT 中转地址及凭据、元宝凭据均存入平台密文变量，没有写入代码；本地 `.env.local`、`docs/key.md`、原始图片和原报告数据库没有上传。

运行监听 `0.0.0.0:7860`，数据库位于 `/mnt/workspace/tripproof/tripproof.db`。入口脚本初始化持久卷子目录后降权运行；网页和调查 worker 同时启动。平台框架需要分区 Cookie，因此专用镜像仅允许两个官方魔搭站点嵌入，Cookie 使用 HttpOnly、Secure、SameSite=None、Partitioned。普通本地/VPS 构建继续禁止嵌入。

已通过的实际检查：

- 本地 131 项测试、类型检查、生产构建；最新凭据扫描无泄漏。
- 云端 Docker 构建、容器启动、网页与 worker 运行、健康检查。
- 桌面密码页、错误提示、登录、报告、复制分享链接、锁定访问。
- 一次真实 GPT 提取与 SearchPro 调查，未使用原本地缓存或模拟结果：雷峰塔 09:00—10:30，默认日期 2026-10-24；提取 9.970 秒，调查 200.012 秒，SearchPro 5 次成功、26 条事实。调查耗时未达到 90 秒目标。
- 重部署后同一行程、已存 run、事实、来源与 66 条事件保留；SSE 重连和刷新恢复正常；未解锁报告/API 受保护。
- 签名密钥轮换后旧 Cookie 失效，分区 Cookie 退出和跨站提交拒绝正常。

记录在 [`artifacts/deployment/`](../artifacts/deployment/)，核心结果为 [`cloud-smoke.json`](../artifacts/deployment/cloud-smoke.json) 和 [`postdeploy.json`](../artifacts/deployment/postdeploy.json)。本次没有重新运行四个完整 golden case；四份本地已有 golden 报告重新验证了锁定/解锁。

当前限制：

- **建议先用电脑试用。** 魔搭全屏运行页在 390px 视口下把 iframe 撑到 1280px，内容会被截断。直接打开平台给出的 iframe 地址仍跳回该框架，未找到可用的独立浏览入口。应用自身在本地 390px 响应式测试已通过，但魔搭的窄屏外层适配尚未通过。
- 长时间闲置后可能休眠，唤醒行为尚未实测；不承诺具体休眠时长。
- 免费的是当前托管资源，GPT 与元宝搜索仍可能计费。试用配额设置为每会话每日 3 次调查、实例每日最多 200 次实际搜索，总搜索上限沿用本地配置。
- 通用 VPS 的 Compose/Caddy 方案还需要独立主机验收。

后续更新先运行 `pnpm deploy:modelscope:prepare --out=tmp/modelscope-update`，只提交该输出目录内的文件；不要把原项目目录整体上传。平台运行密钥无需提交或重新写入文件。更新代码后重新上线，并复查密码、业务接口和数据保留。
