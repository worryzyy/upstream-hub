// seed-demo 往 PostgreSQL 写一份"看起来真实"的演示数据：
//
//   - 6 个上游渠道（2 个 NewAPI + 4 个 Sub2API），名字、URL、阈值贴近真实 NewAPI / Sub2API 站
//   - 每渠道 6-12 个分组倍率，分组名借鉴真实分组（Claude Code / Codex-Pro / cc-max / AWS-Kiro 等）
//   - 最近 N 天的余额采样（每 15 分钟一条，余额带噪声地慢慢下降）
//   - 每渠道 N 天的 monitor_logs（多数成功，零星失败）
//   - 5 条 rate_change_logs 分布在最近几天，用来在 UI 上展示"倍率变化"卡片
//   - 1 个示例 Telegram 通知渠道 + 几条 notification_logs
//   - 1 个示例 CapSolver 打码配置
//
// 用法：
//
//	./seed-demo                # 在已有数据上追加，名字冲突会跳过
//	./seed-demo --reset        # 先清空所有业务表再灌
//	./seed-demo --days 14      # 余额 / 监控日志按 14 天生成（默认 7）
//
// 注意：seed-demo 不替代 AutoMigrate，启动主程序会自动建表；这里仅写数据。
// 加密字段（密码、Telegram bot_token）走真实的 AES-GCM，可被主程序正常解密。
package main

import (
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"time"

	"gorm.io/gorm"

	"github.com/worryzyy/upstream-hub/internal/config"
	"github.com/worryzyy/upstream-hub/internal/crypto"
	"github.com/worryzyy/upstream-hub/internal/storage"
)

func main() {
	var (
		configPath = flag.String("config", "", "path to config.yaml (optional; env vars also work)")
		days       = flag.Int("days", 7, "days of balance / monitor history to generate")
		reset      = flag.Bool("reset", false, "TRUNCATE all business tables before seeding (destructive)")
	)
	flag.Parse()

	cfg, err := config.Load(*configPath)
	exitOn(err, "load config")

	cipher, err := crypto.NewCipher(cfg.Security.AppSecret)
	exitOn(err, "init cipher (set APP_SECRET)")

	db, err := storage.Open(cfg.Database.ToStorageConfig())
	exitOn(err, "open database")
	exitOn(storage.AutoMigrate(db), "auto migrate")

	if *reset {
		log.Println("--reset given, wiping business tables…")
		wipeAll(db)
	}

	// 固定随机种子让"基本形态"可重现；具体时间戳还是用 time.Now 计算的。
	rng := rand.New(rand.NewSource(20260601))

	channels := seedChannels(db, cipher)
	if len(channels) == 0 {
		log.Println("channels 表已有数据，跳过；用 --reset 可以清空重灌")
		return
	}

	seedRateSnapshots(db, channels, rng)
	seedBalanceHistory(db, channels, *days, rng)
	seedMonitorLogs(db, channels, *days, rng)
	seedRateChanges(db, channels, rng)
	seedNotifications(db, cipher, channels)
	seedCaptcha(db, cipher)

	log.Println("seed-demo done")
}

func exitOn(err error, msg string) {
	if err != nil {
		log.Printf("%s: %v", msg, err)
		os.Exit(1)
	}
}

// wipeAll TRUNCATE 所有业务表。channels 用 CASCADE 顺手清掉 auth_sessions / rate_snapshots 等。
// notification_cooldowns 在新 schema 才有，旧库可能缺，错误忽略。
func wipeAll(db *gorm.DB) {
	tables := []string{
		"notification_logs",
		"notification_cooldowns",
		"notification_channels",
		"monitor_logs",
		"rate_change_logs",
		"rate_snapshots",
		"balance_snapshots",
		"auth_sessions",
		"channels",
		"captcha_configs",
	}
	for _, t := range tables {
		if err := db.Exec(fmt.Sprintf("TRUNCATE TABLE %s RESTART IDENTITY CASCADE", t)).Error; err != nil {
			log.Printf("truncate %s (ignored): %v", t, err)
		}
	}
}

// ========================= channels =========================

type demoChannel struct {
	Name             string
	Type             storage.ChannelType
	SiteURL          string
	Username         string
	BalanceThreshold float64
	StartingBalance  float64 // 用来生成余额历史的起点
	Groups           []demoGroup
}

type demoGroup struct {
	Name        string
	Description string
	Ratio       float64
}

func demoCatalog() []demoChannel {
	// 真实分组名 / 描述借鉴：Claude Code 专用、Codex-Pro 池、cc-max 高可用、AWS 透传等等。
	commonGroups := []demoGroup{
		{Name: "default", Description: "默认分组", Ratio: 2.5},
		{Name: "Claude Code", Description: "Claude Code 专用，仅在 Claude Code CLI 中使用", Ratio: 1.0},
		{Name: "Claude Max", Description: "倍率 2.1，效果最好，仅限 Claude Code CLI", Ratio: 2.1},
		{Name: "Codex-Pro", Description: "Pro 账号池，支持所有 codex 模型", Ratio: 0.7},
		{Name: "cc-aws", Description: "Claude Platform on AWS（透传）", Ratio: 0.6},
		{Name: "cc-azure", Description: "Azure 渠道，稳定性较好", Ratio: 1.3},
		{Name: "cc-max", Description: "高可用分组，倍率 2.0", Ratio: 2.0},
		{Name: "AWS-Kiro", Description: "Kiro 企业版，支持 opus", Ratio: 0.5},
		{Name: "GPT-image", Description: "图像生成专用分组", Ratio: 1.0},
		{Name: "gemini-pro", Description: "Gemini Pro 透传", Ratio: 0.6},
	}

	return []demoChannel{
		{
			Name:             "demo-newapi-main",
			Type:             storage.ChannelTypeNewAPI,
			SiteURL:          "https://demo-newapi.example.com",
			Username:         "demo@example.com",
			BalanceThreshold: 100,
			StartingBalance:  843.21,
			Groups:           pickGroups(commonGroups, 7, 0),
		},
		{
			Name:             "demo-newapi-backup",
			Type:             storage.ChannelTypeNewAPI,
			SiteURL:          "https://backup.demo-newapi.example.com",
			Username:         "demo-backup@example.com",
			BalanceThreshold: 50,
			StartingBalance:  256.78,
			Groups:           pickGroups(commonGroups, 5, 1),
		},
		{
			Name:             "demo-sub2api-alpha",
			Type:             storage.ChannelTypeSub2API,
			SiteURL:          "https://alpha.demo-sub2api.example.com",
			Username:         "alpha@example.com",
			BalanceThreshold: 200,
			StartingBalance:  1284.55,
			Groups:           pickGroups(commonGroups, 8, 2),
		},
		{
			Name:             "demo-sub2api-beta",
			Type:             storage.ChannelTypeSub2API,
			SiteURL:          "https://beta.demo-sub2api.example.com",
			Username:         "beta@example.com",
			BalanceThreshold: 30,
			StartingBalance:  41.20, // 故意接近阈值，UI 上会显示"余额偏低"
			Groups:           pickGroups(commonGroups, 6, 3),
		},
		{
			Name:             "demo-sub2api-gamma",
			Type:             storage.ChannelTypeSub2API,
			SiteURL:          "https://gamma.demo-sub2api.example.com",
			Username:         "gamma@example.com",
			BalanceThreshold: 100,
			StartingBalance:  3056.40,
			Groups:           pickGroups(commonGroups, 10, 4),
		},
		{
			Name:             "demo-sub2api-delta",
			Type:             storage.ChannelTypeSub2API,
			SiteURL:          "https://delta.demo-sub2api.example.com",
			Username:         "delta@example.com",
			BalanceThreshold: 50,
			StartingBalance:  187.93,
			Groups:           pickGroups(commonGroups, 4, 5),
		},
	}
}

// pickGroups 用 offset 让每个渠道挑出不同子集，避免所有渠道分组完全一样。
func pickGroups(all []demoGroup, n, offset int) []demoGroup {
	if n >= len(all) {
		return all
	}
	out := make([]demoGroup, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, all[(offset+i)%len(all)])
	}
	return out
}

// seedChannels 创建 demo 渠道；如果 channels 表已经有同名记录则全部跳过，避免重复灌。
// 返回创建出来的渠道列表，下游函数据此挂 rate / balance 等。
func seedChannels(db *gorm.DB, cipher *crypto.Cipher) []storage.Channel {
	var existing int64
	db.Model(&storage.Channel{}).Where("name LIKE ?", "demo-%").Count(&existing)
	if existing > 0 {
		return nil
	}

	catalog := demoCatalog()
	out := make([]storage.Channel, 0, len(catalog))
	now := time.Now()
	for _, dc := range catalog {
		// 用真实加密路径写一个"假密码"，方便后续如果有人想测试登录会立刻看到失败。
		cipherText, err := cipher.Encrypt(fmt.Sprintf("demo-password-for-%s", dc.Name))
		exitOn(err, "encrypt demo password")

		ch := storage.Channel{
			Name:             dc.Name,
			Type:             dc.Type,
			SiteURL:          dc.SiteURL,
			Username:         dc.Username,
			PasswordCipher:   cipherText,
			CredentialMode:   storage.CredentialModePassword,
			BalanceThreshold: dc.BalanceThreshold,
			MonitorEnabled:   true,
			LastBalance:      ptrFloat(dc.StartingBalance),
			LastBalanceAt:    &now,
		}
		exitOn(db.Create(&ch).Error, "create channel "+dc.Name)
		out = append(out, ch)
	}
	log.Printf("seeded %d channels", len(out))
	return out
}

// ========================= rate snapshots =========================

func seedRateSnapshots(db *gorm.DB, channels []storage.Channel, rng *rand.Rand) {
	cat := demoCatalog()
	catByName := map[string]demoChannel{}
	for _, c := range cat {
		catByName[c.Name] = c
	}

	now := time.Now()
	var batch []storage.RateSnapshot
	for _, ch := range channels {
		groups := catByName[ch.Name].Groups
		for _, g := range groups {
			// 在 base ratio 上加 ±5% 噪声，避免所有渠道同一分组数值一模一样。
			noise := 1 + (rng.Float64()-0.5)*0.1
			ratio := round2(g.Ratio * noise)
			batch = append(batch, storage.RateSnapshot{
				ChannelID:       ch.ID,
				ModelName:       g.Name,
				Description:     g.Description,
				Ratio:           ratio,
				CompletionRatio: 0,
				FirstSeenAt:     now.Add(-time.Duration(rng.Intn(7*24)) * time.Hour),
				LastSeenAt:      now,
			})
		}
	}
	exitOn(db.CreateInBatches(batch, 100).Error, "insert rate_snapshots")
	log.Printf("seeded %d rate snapshots", len(batch))
}

// ========================= balance history =========================

// seedBalanceHistory 每 15 分钟一条采样，余额"慢慢下降 + 小幅噪声"。
// 一周 6 渠道 ≈ 4000 行；按 100 一批 CreateInBatches 拆开写避免单 SQL 过大。
func seedBalanceHistory(db *gorm.DB, channels []storage.Channel, days int, rng *rand.Rand) {
	const interval = 15 * time.Minute
	end := time.Now()
	start := end.Add(-time.Duration(days) * 24 * time.Hour)
	steps := int(end.Sub(start) / interval)

	var batch []storage.BalanceSnapshot
	for _, ch := range channels {
		current := *ch.LastBalance
		// 反推：从当前余额倒推到 N 天前的"起始余额"（让今天的余额 = LastBalance）
		// 平均每条减 0.02~0.05% 的小幅消耗 + 偶尔大跳变。
		samples := make([]float64, steps+1)
		samples[steps] = current
		for i := steps - 1; i >= 0; i-- {
			drop := samples[i+1] * (0.0002 + rng.Float64()*0.0005)
			// 5% 概率有一次"较大消耗"——模拟刷量
			if rng.Float64() < 0.05 {
				drop = samples[i+1] * (0.001 + rng.Float64()*0.005)
			}
			samples[i] = round4(samples[i+1] + drop)
		}
		for i, b := range samples {
			t := start.Add(time.Duration(i) * interval)
			batch = append(batch, storage.BalanceSnapshot{
				ChannelID: ch.ID,
				Balance:   b,
				SampledAt: t,
			})
		}
	}
	exitOn(db.CreateInBatches(batch, 500).Error, "insert balance_snapshots")
	log.Printf("seeded %d balance snapshots (%d days)", len(batch), days)
}

// ========================= monitor logs =========================

// seedMonitorLogs 每渠道每天约 20 次混合 balance / rates 任务，3% 概率失败。
func seedMonitorLogs(db *gorm.DB, channels []storage.Channel, days int, rng *rand.Rand) {
	failures := []string{
		"login failed: invalid credentials",
		"context deadline exceeded",
		"site returned 502 bad gateway",
		"captcha solver timeout",
		"unmarshal user info: unexpected EOF",
	}
	end := time.Now()
	var batch []storage.MonitorLog
	for _, ch := range channels {
		for d := 0; d < days; d++ {
			day := end.Add(-time.Duration(d) * 24 * time.Hour)
			for i := 0; i < 20; i++ {
				started := day.Add(-time.Duration(rng.Intn(24*60)) * time.Minute)
				dur := time.Duration(200+rng.Intn(2500)) * time.Millisecond
				finished := started.Add(dur)
				success := rng.Float64() > 0.03
				job := storage.MonitorJobBalance
				if i%3 == 0 {
					job = storage.MonitorJobRates
				}
				row := storage.MonitorLog{
					ChannelID:  ch.ID,
					Job:        job,
					Success:    success,
					DurationMS: dur.Milliseconds(),
					StartedAt:  started,
					FinishedAt: finished,
				}
				if !success {
					row.ErrorMessage = failures[rng.Intn(len(failures))]
				}
				batch = append(batch, row)
			}
		}
	}
	exitOn(db.CreateInBatches(batch, 500).Error, "insert monitor_logs")
	log.Printf("seeded %d monitor logs", len(batch))
}

// ========================= rate changes =========================

// seedRateChanges 写 5 条 rate_change_logs：分布在最近 5 天里，模拟"上游调价"事件。
// 同时把对应分组在 rate_snapshots 里的当前值也对齐，让 UI 上"当前倍率"跟"最后一次变化"一致。
func seedRateChanges(db *gorm.DB, channels []storage.Channel, rng *rand.Rand) {
	type change struct {
		channelIdx int
		group      string
		oldR, newR float64
		daysAgo    int
	}
	plan := []change{
		{1, "cc-max", 1.5, 2.0, 1},      // newapi-backup 涨
		{2, "Codex-Pro", 0.7, 0.5, 2},   // sub2api-alpha 下调
		{3, "AWS-Kiro", 0.5, 0.3, 3},    // beta 限时降价
		{4, "Claude Max", 2.1, 2.3, 4},  // gamma 微调
		{5, "Codex-Pro", 0.7, 1.0, 5},   // delta 涨
	}
	now := time.Now()
	for _, p := range plan {
		if p.channelIdx >= len(channels) {
			continue
		}
		ch := channels[p.channelIdx]
		changedAt := now.Add(-time.Duration(p.daysAgo*24+rng.Intn(6)) * time.Hour)

		oldR := p.oldR
		oldComp := 0.0
		row := storage.RateChangeLog{
			ChannelID:          ch.ID,
			ModelName:          p.group,
			OldRatio:           &oldR,
			NewRatio:           p.newR,
			OldCompletionRatio: &oldComp,
			NewCompletionRatio: 0,
			ChangedAt:          changedAt,
		}
		exitOn(db.Create(&row).Error, "insert rate_change_logs")

		// 把当前快照也对齐到 newR
		db.Model(&storage.RateSnapshot{}).
			Where("channel_id = ? AND model_name = ?", ch.ID, p.group).
			Updates(map[string]any{"ratio": p.newR, "last_seen_at": now})
	}
	log.Printf("seeded %d rate change events", len(plan))
}

// ========================= notification channel + logs =========================

func seedNotifications(db *gorm.DB, cipher *crypto.Cipher, channels []storage.Channel) {
	cfgJSON := `{"bot_token":"123456789:demo-not-real-token","chat_id":"-1001234567890"}`
	enc, err := cipher.Encrypt(cfgJSON)
	exitOn(err, "encrypt notify config")

	nc := storage.NotificationChannel{
		Name:          "Demo Telegram",
		Type:          storage.NotifyTelegram,
		ConfigCipher:  enc,
		Subscriptions: "[]", // 订阅全部
		Enabled:       true,
	}
	exitOn(db.Create(&nc).Error, "create notification channel")

	// 几条历史发送记录（成功 + 个别失败）
	now := time.Now()
	logs := []storage.NotificationLog{
		{ChannelID: nc.ID, Event: storage.EventRateChanged,
			Subject: fmt.Sprintf("【倍率变化提醒】%s · cc-max", channels[1].Name),
			Body: "由 1.5 上涨至 2.0", Success: true, SentAt: now.Add(-22 * time.Hour)},
		{ChannelID: nc.ID, Event: storage.EventRateChanged,
			Subject: fmt.Sprintf("【倍率变化提醒】%s · Codex-Pro", channels[2].Name),
			Body: "由 0.7 下调至 0.5", Success: true, SentAt: now.Add(-46 * time.Hour)},
		{ChannelID: nc.ID, Event: storage.EventBalanceLow,
			Subject: fmt.Sprintf("[upstream-hub] %s 余额低于阈值", channels[3].Name),
			Body: "当前 41.2, 阈值 30", Success: true, SentAt: now.Add(-3 * time.Hour)},
		{ChannelID: nc.ID, Event: storage.EventMonitorFailed,
			Subject: fmt.Sprintf("[upstream-hub] %s 余额采集失败", channels[4].Name),
			Body: "context deadline exceeded", Success: false, ErrorMessage: "telegram returned 429",
			SentAt: now.Add(-1 * time.Hour)},
		{ChannelID: nc.ID, Event: storage.EventLoginFailed,
			Subject: fmt.Sprintf("[upstream-hub] %s 登录失败", channels[5].Name),
			Body: "invalid credentials", Success: true, SentAt: now.Add(-30 * time.Minute)},
	}
	exitOn(db.CreateInBatches(logs, 50).Error, "insert notification_logs")
	log.Printf("seeded notification channel + %d notification logs", len(logs))
}

// ========================= captcha config =========================

func seedCaptcha(db *gorm.DB, cipher *crypto.Cipher) {
	apiKey, err := cipher.Encrypt("CAP-demo-key-not-real")
	exitOn(err, "encrypt captcha key")
	cc := storage.CaptchaConfig{
		Name:         "Demo CapSolver",
		Type:         storage.CaptchaCapSolver,
		APIKeyCipher: apiKey,
		Endpoint:     "https://api.capsolver.com",
		Enabled:      true,
	}
	exitOn(db.Create(&cc).Error, "create captcha config")
	log.Println("seeded 1 captcha config (CapSolver)")
}

// ========================= utils =========================

func ptrFloat(v float64) *float64 { return &v }

func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }
func round4(v float64) float64 { return float64(int(v*10000+0.5)) / 10000 }
