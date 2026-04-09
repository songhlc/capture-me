---
name: feedback-safety-rules
description: 安全规则 — 禁止删除用户数据目录
type: feedback
---

# 安全规则

## 禁止删除 memory/ 和 sqlite/ 目录

**Rule:** 在操作 capture-you skill 时，**绝对禁止删除** `memory/` 和 `sqlite/` 目录。

**Why:** 2026-04-10 因误删 memory/ 目录导致用户画像和记录丢失，SQLite 数据库差点也丢失。

**How to apply:**
- `~/.claude/skills/capture-you/memory/` — 用户数据（user-profile.md、capture-log.md、promises.md）
- `~/.claude/skills/capture-you/sqlite/` — SQLite 数据库（capture.db）
- 清理测试数据时，只删除文件内容，不删除目录本身
- rsync 同步时显式排除 memory/ 和 sqlite/
- 修改代码时，如果涉及文件删除操作，先确认路径
