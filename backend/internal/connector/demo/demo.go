// Package demo provides simulated upstream connectors for public demo environments.
package demo

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"strings"
	"time"

	"github.com/worryzyy/upstream-hub/internal/connector"
)

func init() {
	connector.RegisterDemo(connector.TypeNewAPI, func() connector.Connector {
		return &Client{kind: connector.TypeNewAPI}
	})
	connector.RegisterDemo(connector.TypeSub2API, func() connector.Connector {
		return &Client{kind: connector.TypeSub2API}
	})
}

type Client struct {
	kind connector.ChannelType
}

type group struct {
	name string
	desc string
	base float64
}

var groups = []group{
	{name: "default", desc: "默认分组", base: 2.5},
	{name: "Claude Code", desc: "Claude Code 专用，仅在 Claude Code CLI 中使用", base: 1.0},
	{name: "Claude Max", desc: "倍率 2.1，效果最好，仅限 Claude Code CLI", base: 2.1},
	{name: "Codex-Pro", desc: "Pro 账号池，支持所有 codex 模型", base: 0.7},
	{name: "cc-aws", desc: "Claude Platform on AWS（透传）", base: 0.6},
	{name: "cc-azure", desc: "Azure 渠道，稳定性较好", base: 1.3},
	{name: "cc-max", desc: "高可用分组，倍率 2.0", base: 2.0},
	{name: "AWS-Kiro", desc: "Kiro 企业版，支持 opus", base: 0.5},
	{name: "GPT-image", desc: "图像生成专用分组", base: 1.0},
	{name: "gemini-pro", desc: "Gemini Pro 透传", base: 0.6},
}

func (c *Client) GetTurnstileSiteKey(ctx context.Context, ch *connector.Channel) (string, error) {
	if err := pause(ctx, ch, 120*time.Millisecond, 220*time.Millisecond); err != nil {
		return "", err
	}
	return "", nil
}

func (c *Client) Login(ctx context.Context, ch *connector.Channel) (*connector.AuthSession, error) {
	if err := pause(ctx, ch, 320*time.Millisecond, 720*time.Millisecond); err != nil {
		return nil, err
	}
	if strings.Contains(strings.ToLower(ch.Username), "fail") {
		return nil, errors.New("demo login rejected for fail user")
	}
	token := fmt.Sprintf("demo-%s-session-%d", c.kind, stableHash(ch.Name)%100000)
	return &connector.AuthSession{
		UserID:      fmt.Sprintf("%d", 1000+stableHash(ch.Name)%9000),
		AccessToken: token,
		Cookie:      "demo_session=" + token,
		CSRFToken:   "demo-csrf",
		ExpiresAt:   time.Now().Add(12 * time.Hour),
	}, nil
}

func (c *Client) CheckAuth(ctx context.Context, ch *connector.Channel, session *connector.AuthSession) error {
	if err := pause(ctx, ch, 120*time.Millisecond, 260*time.Millisecond); err != nil {
		return err
	}
	if session == nil {
		return errors.New("missing demo session")
	}
	return nil
}

func (c *Client) GetBalance(ctx context.Context, ch *connector.Channel, session *connector.AuthSession) (*connector.BalanceResult, error) {
	if err := pause(ctx, ch, 450*time.Millisecond, 900*time.Millisecond); err != nil {
		return nil, err
	}
	now := time.Now()
	return &connector.BalanceResult{
		Balance:   demoBalance(ch, now),
		SampledAt: now,
	}, nil
}

func (c *Client) GetRates(ctx context.Context, ch *connector.Channel, session *connector.AuthSession) ([]connector.RateResult, error) {
	if err := pause(ctx, ch, 500*time.Millisecond, 950*time.Millisecond); err != nil {
		return nil, err
	}

	h := stableHash(ch.Name)
	count := 5 + int(h%5)
	offset := int(h % uint64(len(groups)))
	now := time.Now()
	out := make([]connector.RateResult, 0, count)
	for i := 0; i < count; i++ {
		g := groups[(offset+i)%len(groups)]
		wave := math.Sin(float64(now.Unix()/7+int64(i*13)+int64(h%29))) * 0.045
		step := float64((now.Unix()/37+int64(i)+int64(h%5))%3-1) * 0.025
		ratio := round(g.base * (1 + wave + step))
		out = append(out, connector.RateResult{
			ModelName:       g.name,
			Description:     g.desc + "（demo 实时模拟）",
			Ratio:           ratio,
			CompletionRatio: ratio,
		})
	}
	return out, nil
}

func demoBalance(ch *connector.Channel, now time.Time) float64 {
	name := strings.ToLower(ch.Name)
	h := stableHash(ch.Name)
	base := 260 + float64(h%2600)
	switch {
	case strings.Contains(name, "main"):
		base = 840
	case strings.Contains(name, "backup"):
		base = 250
	case strings.Contains(name, "alpha"):
		base = 1280
	case strings.Contains(name, "beta"):
		base = 42
	case strings.Contains(name, "gamma"):
		base = 3050
	case strings.Contains(name, "delta"):
		base = 185
	}
	minuteBucket := float64((now.Unix()/60 + int64(h%31)) % 120)
	drift := minuteBucket * (0.02 + float64(h%7)*0.005)
	wave := math.Sin(float64(now.Unix()/11+int64(h%97))) * (1.5 + float64(h%5))
	return math.Max(0.1, round(base-drift+wave))
}

func pause(ctx context.Context, ch *connector.Channel, min, max time.Duration) error {
	if max <= min {
		max = min
	}
	jitter := time.Duration(stableHash(ch.Name) % uint64(max-min+1))
	timer := time.NewTimer(min + jitter)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func stableHash(s string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return h.Sum64()
}

func round(v float64) float64 {
	return math.Round(v*10000) / 10000
}
