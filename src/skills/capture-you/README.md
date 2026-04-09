# 知己 / Capture-You

> AI 增强型随手捕捉系统 — 你的第二大脑

## 产品定位

**知己** 是一款 AI 增强型的个人知识捕捉与管理系统。它能够帮助你：

- **随时随地捕捉** — 记录一闪而过的想法、待办事项、灵感碎片
- **自动解析分类** — AI 智能识别内容类型（待办、想法、项目、参考等）
- **定时提醒** — 自动同步到 Apple Reminders，不让任何重要事项遗漏
- **性格画像** — 分析你的行为模式，了解自己的思考习惯
- **双轨存储** — Markdown + SQLite，本地优先，永不丢失

---

## 产品亮点

| 亮点 | 说明 |
|------|------|
| **AI 智能解析** | 自动识别内容类型、提取关键词、生成标签 |
| **双存储架构** | Markdown 便于阅读，SQLite 便于查询，各取所长 |
| **Apple Reminders 集成** | 自动同步待办事项到系统提醒 app |
| **性格画像分析** | 基于捕捉记录分析你的思维模式和行为习惯 |
| **周报/月报生成** | 自动汇总一段时间内的记录，生成结构化报告 |
| **本地优先** | 所有数据存储在本地，尊重隐私 |

---

## 界面预览

![初始化引导](docs/images/demo-setup.png)
![记录统计](docs/images/demo-stat.png)

---

## 适合人群

- **知识工作者** — 需要频繁记录想法、整理信息的职场人士
- **项目经理** — 需要追踪待办、管理项目进展
- **学生/研究者** — 收集资料、整理笔记、规划学习
- **创作者** — 捕捉灵感、管理素材、追踪创作进度
- **任何希望提升个人效率的人** — 让你的"第二大脑"帮你记住一切

---

## 快速上手

在 Claude Code 中直接说话就能用：

```
/capture-you init        # 首次使用，初始化你的画像
/capture-you             # 开始捕捉，说出你的想法
/capture-you todos       # 查看所有待办
/capture-you review week  # 生成周报
/capture-you profile     # 查看性格画像
```

---

## 安装

### 方式一：Claude Code 用户（推荐）

```bash
# 1. 复制 skill 到你的 Claude Code 配置目录
cp -r src/skills/capture-you ~/.claude/skills/capture-you

# 2. 重启 Claude Code
# 3. 输入 /capture-you 开始使用
```

### 方式二：OpenClaw 用户

同上，将 skill 复制到对应的 skills 目录。

---

## 数据存储

- **本地优先** — 所有数据存储在你本地，不上云
- **双轨备份** — Markdown + SQLite，双重保障
- **隐私安全** — 你的数据只有你能访问

---

PRs welcome 💻

## License

© windknow
