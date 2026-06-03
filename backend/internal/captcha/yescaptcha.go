package captcha

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/go-resty/resty/v2"
	"github.com/worryzyy/upstream-hub/internal/storage"
)

func init() {
	Register(storage.CaptchaYesCaptcha, func(c Config) Provider { return newYesCaptcha(c) })
}

// yesCaptcha 对接 https://yescaptcha.com 的 TurnstileTaskProxyless。
//
// 协议跟 2Captcha / AntiCaptcha 完全同源（同样 createTask + getTaskResult JSON API）：
//
//	POST /createTask     -> { errorId, taskId }
//	POST /getTaskResult  -> { status: "ready", solution: { token } } 或 status: "processing"
//
// 在拿到 ready 之前每 2 秒轮询一次，最多 ~120 秒。
type yesCaptcha struct {
	cfg  Config
	http *resty.Client
	base string
}

func newYesCaptcha(c Config) *yesCaptcha {
	base := c.Endpoint
	if base == "" {
		base = "https://api.yescaptcha.com"
	}
	return &yesCaptcha{
		cfg:  c,
		http: resty.New().SetTimeout(30 * time.Second),
		base: base,
	}
}

type yesCaptchaCreateResp struct {
	ErrorID          int    `json:"errorId"`
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	TaskID           any    `json:"taskId"` // 兼容 string / number
}

type yesCaptchaResultResp struct {
	ErrorID          int    `json:"errorId"`
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	Status           string `json:"status"` // "ready" | "processing"
	Solution         struct {
		Token string `json:"token"`
	} `json:"solution"`
}

func (p *yesCaptcha) SolveTurnstile(ctx context.Context, siteKey, pageURL string) (string, error) {
	if p.cfg.APIKey == "" {
		return "", errors.New("yescaptcha: api key is empty")
	}
	if siteKey == "" {
		return "", errors.New("yescaptcha: siteKey is empty")
	}

	taskID, err := p.createTask(ctx, siteKey, pageURL)
	if err != nil {
		return "", err
	}

	deadline := time.Now().Add(120 * time.Second)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-ticker.C:
			if time.Now().After(deadline) {
				return "", errors.New("yescaptcha: timed out waiting for solution")
			}
			token, ready, err := p.fetchResult(ctx, taskID)
			if err != nil {
				return "", err
			}
			if ready {
				return token, nil
			}
		}
	}
}

func (p *yesCaptcha) createTask(ctx context.Context, siteKey, pageURL string) (string, error) {
	body := map[string]any{
		"clientKey": p.cfg.APIKey,
		"task": map[string]any{
			"type":       "TurnstileTaskProxyless",
			"websiteURL": pageURL,
			"websiteKey": siteKey,
		},
	}
	resp, err := p.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(body).
		Post(p.base + "/createTask")
	if err != nil {
		return "", fmt.Errorf("yescaptcha createTask http: %w", err)
	}
	var r yesCaptchaCreateResp
	if err := json.Unmarshal(resp.Body(), &r); err != nil {
		return "", fmt.Errorf("yescaptcha createTask decode: %w", err)
	}
	if r.ErrorID != 0 || r.TaskID == nil {
		return "", fmt.Errorf("yescaptcha createTask: %s %s", r.ErrorCode, r.ErrorDescription)
	}
	switch v := r.TaskID.(type) {
	case string:
		if v == "" {
			return "", errors.New("yescaptcha createTask: empty taskId")
		}
		return v, nil
	case float64:
		return fmt.Sprintf("%.0f", v), nil
	default:
		return fmt.Sprint(v), nil
	}
}

func (p *yesCaptcha) fetchResult(ctx context.Context, taskID string) (string, bool, error) {
	resp, err := p.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(map[string]any{
			"clientKey": p.cfg.APIKey,
			"taskId":    taskID,
		}).
		Post(p.base + "/getTaskResult")
	if err != nil {
		return "", false, fmt.Errorf("yescaptcha getTaskResult http: %w", err)
	}
	var r yesCaptchaResultResp
	if err := json.Unmarshal(resp.Body(), &r); err != nil {
		return "", false, fmt.Errorf("yescaptcha getTaskResult decode: %w", err)
	}
	if r.ErrorID != 0 {
		return "", false, fmt.Errorf("yescaptcha getTaskResult: %s %s", r.ErrorCode, r.ErrorDescription)
	}
	if r.Status == "ready" {
		if r.Solution.Token == "" {
			return "", false, errors.New("yescaptcha: ready but empty token")
		}
		return r.Solution.Token, true, nil
	}
	return "", false, nil
}
