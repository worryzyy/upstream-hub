package captcha

import (
	"context"
	"errors"

	"github.com/worryzyy/upstream-hub/internal/storage"
)

func init() {
	Register(storage.CaptchaAntiCaptcha, func(c Config) Provider { return &antiCaptcha{cfg: c} })
}

type antiCaptcha struct{ cfg Config }

func (p *antiCaptcha) SolveTurnstile(_ context.Context, _, _ string) (string, error) {
	// TODO: POST https://api.anti-captcha.com/createTask + getTaskResult
	return "", errors.New("anticaptcha not implemented")
}
