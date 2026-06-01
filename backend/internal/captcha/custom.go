package captcha

import (
	"context"
	"errors"

	"github.com/worryzyy/upstream-hub/internal/storage"
)

func init() {
	Register(storage.CaptchaCustom, func(c Config) Provider { return &custom{cfg: c} })
}

// custom 通过用户配置的自定义 endpoint 调用打码服务。
// 约定 POST endpoint，body 形如 {"siteKey":"...", "pageUrl":"..."}，
// 返回 {"token":"..."} 或 {"errorMessage":"..."}。
type custom struct{ cfg Config }

func (p *custom) SolveTurnstile(_ context.Context, _, _ string) (string, error) {
	// TODO: POST cfg.Endpoint，按统一约定解析 JSON。
	return "", errors.New("custom captcha not implemented")
}
