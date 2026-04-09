# 知己 / Capture-You

> AI 增强型随手捕捉系统 — 你的第二大脑

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-blue.svg)](https://www.apple.com/macos/)
[![GitHub Stars](https://img.shields.io/github/stars/songhlc/capture-you?style=flat-square)](https://github.com/songhlc/capture-you)

---

## 产品定位

**知己** 是一款 AI 增强型的个人习惯养成与复盘提升系统。它能够帮助你：

- **养成好习惯** — 记录每日工作/生活目标，持续追踪执行情况
- **定期复盘** — AI 智能分析一段时间内的行为模式，识别改进点
- **自我提升** — 基于复盘数据生成个性化建议，打造更好的自己
- **性格画像** — 分析你的行为模式，了解自己的思考与行动习惯
- **双轨存储** — Markdown + SQLite，本地优先，永不丢失

---

## 产品亮点

| 亮点 | 说明 |
|------|------|
| **AI 智能解析** | 自动识别内容类型、提取关键词、生成标签 |
| **习惯追踪** | 记录目标执行情况，量化习惯养成进度 |
| **复盘分析** | 自动分析一段时间内的行为模式，识别问题与机会 |
| **个性化建议** | 基于复盘数据生成具体可执行的改进建议 |
| **性格画像分析** | 基于捕捉记录分析你的思维模式和行为习惯 |
| **周报/月报生成** | 自动汇总一段时间内的记录，生成结构化复盘报告 |
| **本地优先** | 所有数据存储在本地，尊重隐私 |

---

## 界面预览

![初始化引导](docs/images/demo-setup.png)
![记录统计](docs/images/demo-stat.png)

---

## 适合人群

- **自我提升者** — 有明确成长目标，希望通过复盘持续进步
- **习惯养成者** — 想要培养运动、阅读早起等好习惯的人
- **职场人士** — 需要定期复盘工作、规划个人发展
- **学生/研究者** — 规划学习、追踪目标达成情况
- **任何希望更了解自己、持续成长的人**

---

## 快速上手

在 Claude Code 中直接说话就能用：

```
/capture-you init        # 首次使用，初始化你的画像
/capture-you             # 记录今日目标或想法
/capture-you habits      # 查看习惯追踪情况
/capture-you review week  # 生成周复盘
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

MIT © windknow
