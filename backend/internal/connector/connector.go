// Package connector 定义上游渠道连接器接口与公共类型，由 newapi / sub2api 等子包注册具体实现。
//
// 使用方法：
//
//	import _ "github.com/worryzyy/upstream-hub/internal/connector/newapi"
//	import _ "github.com/worryzyy/upstream-hub/internal/connector/sub2api"
//
//	c, err := connector.For("newapi")
//	session, err := c.Login(ctx, channel)
package connector

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ChannelType 渠道类型枚举，与 storage.ChannelType 同步。
type ChannelType string

const (
	TypeNewAPI  ChannelType = "newapi"
	TypeSub2API ChannelType = "sub2api"
)

// Channel 已解密的渠道连接信息，由 channel 层负责构造。
type Channel struct {
	ID               uint
	Name             string
	Type             ChannelType
	SiteURL          string
	Username         string
	Password         string
	TurnstileEnabled bool
	// TurnstileToken 由调用方在 Login 前预先求解打码后填入；为空则直接发起登录。
	TurnstileToken string
}

// AuthSession 登录后产生的会话凭据。明文，由 channel 层负责加密落库。
type AuthSession struct {
	// UserID 上游账号 ID 字符串。NewAPI 必须在后续请求头里附带 `New-Api-User: <id>`。
	// 不是机密信息，channel 层按明文存。
	UserID      string
	AccessToken string
	Cookie      string
	CSRFToken   string
	ExpiresAt   time.Time
}

// BalanceResult 一次余额采集结果。Balance 已经换算成显示单位（一般是 USD 等值）。
type BalanceResult struct {
	Balance   float64
	SampledAt time.Time
}

// RateResult 一条倍率记录。ModelName 在两个上游分别是"分组名"，Description 是该分组的描述（来自上游接口）。
type RateResult struct {
	ModelName       string
	Description     string
	Ratio           float64
	CompletionRatio float64
}

// Connector 上游连接器统一接口。
//
//   - GetTurnstileSiteKey  从上游公开接口读取 Turnstile site key（无需鉴权）
//   - Login                登录获取 session
//   - CheckAuth            使用现有 session 做一次轻量校验，确认未过期
//   - GetBalance           拉取当前余额
//   - GetRates             拉取当前所有可见的倍率
type Connector interface {
	// GetTurnstileSiteKey 返回上游当前的 Turnstile site key。
	// 站点没有开启 Turnstile 时返回 ""（不视作错误）。
	GetTurnstileSiteKey(ctx context.Context, channel *Channel) (string, error)

	Login(ctx context.Context, channel *Channel) (*AuthSession, error)
	CheckAuth(ctx context.Context, channel *Channel, session *AuthSession) error
	GetBalance(ctx context.Context, channel *Channel, session *AuthSession) (*BalanceResult, error)
	GetRates(ctx context.Context, channel *Channel, session *AuthSession) ([]RateResult, error)
}

// Factory 构造一个全新的 Connector 实例。
type Factory func() Connector

var (
	mu       sync.RWMutex
	registry = map[ChannelType]Factory{}
)

// Register 由子包在 init() 中调用，注册其类型对应的 Connector 构造器。
func Register(t ChannelType, f Factory) {
	mu.Lock()
	defer mu.Unlock()
	registry[t] = f
}

// For 按 ChannelType 取一个新的 Connector。未注册返回错误。
func For(t ChannelType) (Connector, error) {
	mu.RLock()
	defer mu.RUnlock()
	f, ok := registry[t]
	if !ok {
		return nil, fmt.Errorf("connector %q is not registered (did you forget the blank import?)", t)
	}
	return f(), nil
}
