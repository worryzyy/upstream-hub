// Package captcha 提供 Cloudflare Turnstile 打码统一接口与 CapSolver / 2Captcha / AntiCaptcha / Custom 几种实现。
//
// 后续若要拆为子包，仅需把每种实现迁出，通过 init() 调用 Register 即可。
package captcha

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/worryzyy/upstream-hub/internal/storage"
)

// Provider 打码平台抽象。所有实现都返回可作为 Turnstile token 的字符串。
//
// 字段含义与 CLAUDE.md 中给出的接口一致：
//
//	SolveTurnstile(siteKey, pageURL) (token, error)
type Provider interface {
	SolveTurnstile(ctx context.Context, siteKey, pageURL string) (string, error)
}

// Config 构造 Provider 所需的配置参数。APIKey 来自 storage.CaptchaConfig 解密后填入。
type Config struct {
	APIKey   string
	Endpoint string
	Extra    string // JSON
}

// Factory 用 Config 构造一个 Provider。
type Factory func(Config) Provider

var (
	mu       sync.RWMutex
	registry = map[storage.CaptchaProviderType]Factory{}
)

// Register 在 init() 中注册具体的打码 provider。
func Register(t storage.CaptchaProviderType, f Factory) {
	mu.Lock()
	defer mu.Unlock()
	registry[t] = f
}

// Build 根据 CaptchaConfig + 已解密的 APIKey 构造 Provider。
func Build(cfg *storage.CaptchaConfig, apiKey string) (Provider, error) {
	if cfg == nil {
		return nil, errors.New("captcha config is nil")
	}
	mu.RLock()
	defer mu.RUnlock()
	f, ok := registry[cfg.Type]
	if !ok {
		return nil, fmt.Errorf("unknown captcha provider: %s", cfg.Type)
	}
	return f(Config{APIKey: apiKey, Endpoint: cfg.Endpoint, Extra: cfg.Extra}), nil
}
