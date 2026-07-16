# Upstream Hub

面向 NewAPI / Sub2API 站点的上游渠道监控面板，用来集中查看余额、模型倍率、倍率变化记录和通知状态。

## 预览

![Upstream Hub 预览 1](docs/images/demo1.png)

![Upstream Hub 预览 2](docs/images/demo2.png)

![Upstream Hub 预览 3](docs/images/demo3.png)

![Upstream Hub 预览 4](docs/images/demo4.png)

主要能力：

- 多上游渠道管理
- 余额汇总和低余额提醒
- 模型倍率监控和变化记录
- Cloudflare Turnstile 打码支持
- Telegram、Webhook、邮件、企业微信、钉钉、飞书、Bark 通知

## 启动方式

### Docker Compose

推荐用 Docker Compose 部署：

```bash
cp .env.example .env
```

编辑 `.env`，至少设置：

```env
APP_SECRET=请替换为 32 字节以上随机字符串
POSTGRES_PASSWORD=请替换为数据库密码
```

公网访问建议同时开启后台登录：

```env
AUTH_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为强密码
```

启动：

```bash
docker compose up -d
```

启动后访问：

```text
http://localhost:8080
```

默认使用 `worryzyy/upstream-hub:latest`（Docker Hub）镜像。需要固定版本时，在 `.env` 里设置：

```env
UPSTREAMHUB_IMAGE_TAG=0.1.0
```

> GHCR 同步镜像 `ghcr.io/worryzyy/upstream-hub` 作为备份/回滚，地址等价。

## 通知渠道配置

通知渠道的密钥、Webhook、SMTP 密码等敏感配置会加密保存。新增或编辑通知渠道时，按渠道类型填写对应字段即可。

### Telegram

```json
{
	"bot_token": "1234567890:AAEh...",
	"chat_id": "-1001234567890"
}
```

- `bot_token`：从 Telegram 的 `@BotFather` 创建机器人后获取。
- `chat_id`：接收消息的私聊、群组或频道 ID。

### Webhook

```json
{
	"url": "https://example.com/hook",
	"method": "POST",
	"headers": {
		"Authorization": "Bearer xxx"
	}
}
```

- `url` 必填。
- `method` 默认 `POST`，也可以填 `PUT` 或 `GET`。
- `headers` 可选，用于自定义请求头。

### Email

```json
{
	"host": "smtp.example.com",
	"port": 465,
	"use_tls": true,
	"username": "alert@example.com",
	"password": "smtp-password-or-app-password",
	"from": "alert@example.com",
	"to": ["ops@example.com"]
}
```

- `host`、`port`、`from`、`to` 必填。
- `username`、`password` 取决于 SMTP 服务商是否要求鉴权。
- 常见端口：`465` 通常配合 `use_tls=true`，`587` 通常配合 STARTTLS。

### 企业微信

```json
{
	"webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx"
}
```

填写群机器人的完整 Webhook URL。

### 钉钉

```json
{
	"webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=xxx",
	"secret": "SEC..."
}
```

- `webhook_url` 必填。
- `secret` 可选，启用机器人“加签”时填写。

### 飞书

```json
{
	"webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx",
	"secret": "..."
}
```

- `webhook_url` 必填。
- `secret` 可选，启用“签名校验”时填写。

### Bark

```json
{
	"url": "https://api.day.app/你的Key/"
}
```

- `url` 必填。复制 Bark App 提供的推送地址，删除末尾的示例推送内容后填写即可。

### 订阅规则

通知渠道可以限制只接收指定上游或指定倍率分组的事件。留空或 `[]` 表示接收全部事件。

```json
[
	{ "channel_id": 1, "mode": "all" },
	{ "channel_id": 2, "mode": "groups", "groups": ["cc-max", "codex"] }
]
```

- `channel_id`：上游渠道 ID。
- `mode=all`：接收该上游全部事件。
- `mode=groups`：倍率变化只接收 `groups` 中指定的模型或分组。

## License

MIT
