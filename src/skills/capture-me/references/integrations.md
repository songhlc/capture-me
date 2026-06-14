# Integrations

外部系统集成：Apple Reminders、通知通道等。

## Apple Reminders 集成

使用 macOS `reminders` CLI：

```bash
# 创建提醒
reminders add "给某总发邮件确认合同" --list "提醒" --date "2026-04-13 09:00"

# 列出所有提醒
reminders list

# 完成提醒
reminders complete "给某总发邮件确认合同"
```

默认 list 名称：`提醒`（可在 config.yaml 修改）

---
