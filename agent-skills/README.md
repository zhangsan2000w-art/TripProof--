# TripProof Agent Skills

本目录按 `/Users/april/April/git-case/makeSkills.md` 将当前产品代码中的人机交互拆成可供其他 Agent 读取、调用的 Skill。**额外的统一入口是 [`skills/tripproof/SKILL.md`](skills/tripproof/SKILL.md)**；不知道专门 Skill 名称时直接使用它。统一入口附带现有 JSON CLI 的可移植副本，所有 Skill 仍需外部 TripProof HTTP 服务，**不是**离线核验器，也不会自行配置模型或搜索密钥。

## 产品能力与 Skill

TripProof 从图文攻略提取可编辑行程，经确认后由独立 worker 搜索和核验日期、开放/入场、预约、交通与区域风险，给出带证据的逐站报告；还支持 Agent 追问、修复预览、公告和替代场馆。没有预订、支付、账号协作或定时监控。代码盘点见 [产品能力图](product-capability-map.md)，页面到 API 的全量交互见 [交互清单](interaction-inventory.md)，拆分依据见 [Skill 设计](skill-design.md)。

| Skill | 覆盖任务 | 副作用 |
| --- | --- | --- |
| [`tripproof`](skills/tripproof/SKILL.md) | 统一入口，串联端到端流程并路由子任务 | 取决于所调用流程 |
| [`tripproof-intake`](skills/tripproof-intake/SKILL.md) | 提取图文、校对草稿、建行程 | 提取消耗模型额度；创建持久记录 |
| [`tripproof-investigation`](skills/tripproof-investigation/SKILL.md) | 调查、状态、追问、停止、证据报告 | 新调查消耗搜索/模型额度；消息和取消写状态 |
| [`tripproof-repair`](skills/tripproof-repair/SKILL.md) | 修改预览与确认后应用 | 应用持久修改行程；预览不搜索 |
| [`tripproof-notice`](skills/tripproof-notice/SKILL.md) | 公告图文独立佐证 | 模型/搜索额度 |
| [`tripproof-alternatives`](skills/tripproof-alternatives/SKILL.md) | 同城候选独立核验 | 模型/搜索额度；不自动替换 |

## 让其他 Agent 调用

可直接把绝对路径 `.../TripProof/agent-skills/skills/tripproof/SKILL.md` 交给可读取文件的 Agent，并要求其按该 Skill 执行。若 Agent 框架支持 Skill 目录扫描，将 `skills/` 内 6 个目录一起导入其 Skill 路径；不依赖特定 Agent 厂商。统一入口可单独复制（需保留其中 `scripts/` 与 `references/`），专门 Skill 依赖同包统一入口的 CLI。完整安装包及通用步骤见 [PACKAGE.md](PACKAGE.md)。

调用方另需 Node.js >=22.18。打包的 CLI 是项目现有 `bin/tripproof.mjs` 的副本，可用绝对路径：

```sh
export TRIPPROOF_URL='http://127.0.0.1:3000'
export TRIPPROOF_SESSION_PATH="$HOME/.config/tripproof/my-agent.json"
# 仅服务开启入口密码时设置 TRIPPROOF_PASSWORD；不要写在命令参数或 Skill 中
node /absolute/path/to/skills/tripproof/scripts/tripproof.mjs health
node /absolute/path/to/skills/tripproof/scripts/tripproof.mjs --help
```

`TRIPPROOF_URL` 为 HTTP(S) 根地址；默认本机 3000。服务端 `.env.local` 按项目根目录 `.env.example` 配置 `OPENAI_BASE_URL/OPENAI_API_KEY`、模型名、元宝或 DeepSeek 搜索凭据、`DATABASE_PATH` 等；**密钥只在服务端**。本地用 `pnpm dev` 同时启动网页和 worker，生产使用完整 `pnpm start` 或网页加独立 worker。`health` 只证明基本可达，不能替代真实上游配置检查。详见项目 `docs/CLI.md`；复制 Skill 到别处时，`SKILL.md` 的 `references/` 仍是自包含的执行说明。

CLI 成功 stdout 为 JSON，失败 stderr 为 JSON；异步调用要看 `run.status`。一名用户一个私有 session 文件，不能共用 Cookie 或提交会话文件、攻略、截图和报告快照。CLI 图片不执行网页端 EXIF 移除/切分，请调用方先处理。报告 URL 持有者可能看见创建时选择附带的原攻略。

## 确认、安全与维护

- 提取、调查、公告、候选调查会调用上游模型或搜索并产生费用；创建行程、发送消息、取消、应用修改会写入状态。执行前取得针对该动作的用户授权；`drop/replace`、批量修改、对外分享尤其要展示对象和影响。用户已清楚授权具体动作时不必机械重复问询。
- 任何行程修改必须先预览再应用；`STALE_*` 重新预览。`waiting_user` 追问用户，未知保持未知；`completed` 才是完整调查快照。分享报告不是实时库存或预订保证。
- 当前专门 Skill 不封装本机密钥管理、反馈或浏览器打印，因为现有 CLI 无相应命令，且其任务边界不同；产品能力图仍保留这些入口。`tripproof/scripts/` 只打包现有确定性 CLI，不新增 API 实现；空 `scripts/`/`assets/` 不创建。
- 源码接口或字段改变时同步检查 `bin/tripproof.mjs`、`lib/domain.ts`、相关 `app/api` 路由，更新本目录引用及示例。不要凭 UI 文案推断不存在的 API。

## 自检结果

- 6/6 个 Skill 含 `SKILL.md`、`name`、第三人称 `description`，名称均为 kebab-case；每个 Skill 有可按需读取的真实 `references/` 文件及明确边界。
- 文档未写入 Token/密码/生产地址；示例仅为占位 URL/绝对路径。未创造新接口、命令或数据字段；引用的项目文件与引用文件已核对。
- 提取、调查、公告、候选、创建、消息、修改和对外分享均标明费用/副作用与确认要求；删除行程、支付等不存在的能力明确排除。
- 长字段/状态/API 说明放在 `references/` 和能力图，`SKILL.md` 保持任务流程。统一入口含 CLI 副本；其他 Skill 未创建无必要的空目录。
- 已执行本地 frontmatter、目录名、相对链接、尾随空格和疑似密钥检查，均通过；`skill-creator` 自带 `quick_validate.py` 因当前 Python 缺少 `PyYAML` 无法启动，未把这项检查冒称为通过。
