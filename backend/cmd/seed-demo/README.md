# seed-demo

往本地 PostgreSQL 灌一份贴近真实形态的演示数据，方便 UI 截图、新功能调试、回归验证。

## 数据形态

- **6 个上游渠道**：2 个 NewAPI（`demo-newapi-main`、`demo-newapi-backup`）+ 4 个 Sub2API（`alpha / beta / gamma / delta`）
- **每渠道 5-10 个分组倍率**：分组名借鉴真实分组（Claude Code / Codex-Pro / cc-max / AWS-Kiro / GPT-image …），ratio 在 base 上加 ±5% 噪声以免一模一样
- **N 天的余额采样**：每 15 分钟一条，余额带噪声地慢慢下降，并有 5% 概率出现"较大消耗"（模拟刷量）
- **N 天的 monitor_logs**：每渠道每天 20 条左右，3% 概率失败带错误信息
- **5 条 rate_change_logs**：分布在最近 5 天，涨跌都有；对应的 `rate_snapshots.ratio` 同步更新到最新值
- **1 个 Telegram 通知渠道**（订阅留空 = 收所有事件）+ 5 条 notification_logs，含成功 / 失败两类
- **1 个 CapSolver 打码配置**

加密字段（密码、bot_token、API key）走真实 AES-GCM 路径，可被主程序解密；但塞的都是 `demo-...-not-real` 之类占位值，**不会真发出任何请求**。

## 用法

### 从源码跑

```bash
cd backend
APP_SECRET="$(openssl rand -hex 32)" \
  UPSTREAMHUB_DATABASE_HOST=localhost \
  UPSTREAMHUB_DATABASE_PORT=54329 \
  go run ./cmd/seed-demo --reset --days 7
```

`APP_SECRET` 必须跟主程序用的同一个，否则主程序解密会失败。

### 从已构建好的镜像跑

镜像里包含 `seed-demo` 二进制（Dockerfile 已配置），直接 exec 进容器：

```bash
docker compose exec app /app/seed-demo --reset --days 7
```

或者一次性容器：

```bash
docker compose run --rm app /app/seed-demo --reset --days 7
```

### Flags

| Flag | 默认 | 说明 |
| --- | --- | --- |
| `--config` | （空，自动找 `config.yaml` 或读 env） | 指定 config 路径 |
| `--days` | `7` | 余额 / 监控日志倒推天数 |
| `--reset` | `false` | **TRUNCATE 所有业务表**后再灌（含 channels、rate_snapshots、balance_snapshots、监控/通知日志、captcha；不动 schema） |

不带 `--reset` 时会先查 channels 表有没有 `demo-` 开头的记录，有就直接退出，避免重复灌。

## 跑完之后

启动主程序，访问 dashboard：

- 余额趋势图有 7 天数据
- "通知渠道" 卡片展示 Demo Telegram
- "告警动态" 卡片展示 5 条历史推送
- "倍率变化" 卡片展示 5 个涨跌事件
- 各渠道详情页能看到 5-10 个分组及其当前倍率

## 注意

- 不替代 `AutoMigrate` — 启动主程序仍是建表的正统路径
- `--reset` 是**破坏性**的：会清掉所有真实数据。生产环境千万别瞎跑
- 演示数据里的余额是固定的小数（不是真随机），每次 `--reset --days N` 出来的数据形态**确定**，方便对比
