# TripProof Skill 安装包

用于截图所示“导入技能”界面的包是 [`dist/tripproof-agent-skill-1.0.0.zip`](dist/tripproof-agent-skill-1.0.0.zip)。**ZIP 根目录直接包含 `SKILL.md`**，其 YAML 前置元数据含 `name: tripproof` 和 `description`；不是把 `SKILL.md` 藏在多层 `skills/` 目录中。可直接上传该 ZIP，也可上传未压缩文件夹 [`importable/tripproof/`](importable/tripproof/)。

## 包内文件

```text
SKILL.md
LICENSE
references/
  agent-interface.md
  intake.md
  investigation.md
  repair.md
  notice.md
  alternatives.md
scripts/
  tripproof.mjs
```

这是**单个通用 TripProof Skill**：一个入口覆盖攻略提取、行程创建、调查与报告、修复预览、公告和候选场馆。`references/` 按任务读取；`scripts/tripproof.mjs` 是原项目 `bin/tripproof.mjs` 的原样副本，仅使用 Node.js 内置模块。原先的六 Skill 分包保留在 `skills/`，旧的多技能包保留为 `dist/tripproof-agent-skills-bundle-1.0.0.zip`，但截图所示导入器应上传**单技能包**。

## 安装后运行条件

目标 Agent 需要能执行命令，并且机器有 Node.js **22.18+**。不需要 `npm install`。包仅是客户端，**不包含 TripProof HTTP 服务、worker、数据库、模型和搜索密钥**；须另行运行/部署完整服务。

```sh
export TRIPPROOF_URL='https://your-tripproof.example'  # 目标 Agent 可访问的 HTTP(S) 根地址
export TRIPPROOF_SESSION_PATH='/安全目录/该用户专用-session.json'
# 仅服务开启入口密码时，通过环境变量设置 TRIPPROOF_PASSWORD
node /安装路径/tripproof/scripts/tripproof.mjs --help
node /安装路径/tripproof/scripts/tripproof.mjs health
```

目标平台可能给 Skill 目录另起名称，实际 CLI 路径以导入后该平台保存的位置为准。若 Agent 不在服务同机，`127.0.0.1` 不指向服务主机；需配置可达 URL。会话文件按用户隔离，不共享或提交。`health` 只表示基本可达，不保证模型/搜索配置正常；异步调用还须检查 `run.status`。

CLI 成功 stdout 为单行 JSON，失败 stderr 为 JSON。调用提取/调查/公告/候选可能产生模型和搜索费用；创建、消息、取消和修复应用会写状态，按 Skill 的确认规则执行。报告链接可能展示创建时选择附带的原攻略。

## 验证与升级

打包后检查 ZIP 根目录的 `SKILL.md`、相对引用文件、`node --check scripts/tripproof.mjs`、`--help`、ZIP 完整性及 SHA-256。源码 CLI 变化后应同步更新 `importable/tripproof/scripts/tripproof.mjs` 和参考文档，再重新打包，避免命令与服务端接口漂移。
