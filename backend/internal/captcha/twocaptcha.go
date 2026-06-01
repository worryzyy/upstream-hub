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
	Register(storage.CaptchaTwoCaptcha, func(c Config) Provider { return newTwoCaptcha(c) })
}

// twoCaptcha 对接 https://2captcha.com 的新 JSON API（createTask / getTaskResult）。
//
// 流程：
//
//	POST /createTask     -> { errorId, taskId }
//	POST /getTaskResult  -> { status: "ready", solution: { token } } 或 status: "processing"
//
// 与 CapSolver 形状几乎一致，区别只在 task.type 取 "TurnstileTaskProxyless"。
type twoCaptcha struct {
	cfg  Config
	http *resty.Client
	base string
}

func newTwoCaptcha(c Config) *twoCaptcha {
	base := c.Endpoint
	if base == "" {
		base = "https://api.2captcha.com"
	}
	return &twoCaptcha{
		cfg:  c,
		http: resty.New().SetTimeout(30 * time.Second),
		base: base,
	}
}

type twoCaptchaCreateResp struct {
	ErrorID          int    `json:"errorId"`
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	TaskID           any    `json:"taskId"` // 文档同时见过 string / int，做兼容
}

type twoCaptchaResultResp struct {
	ErrorID          int    `json:"errorId"`
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	Status           string `json:"status"` // "ready" | "processing"
	Solution         struct {
		Token string `json:"token"`
	} `json:"solution"`
}

func (p *twoCaptcha) SolveTurnstile(ctx context.Context, siteKey, pageURL string) (string, error) {
	if p.cfg.APIKey == "" {
		return "", errors.New("2captcha: api key is empty")
	}
	if siteKey == "" {
		return "", errors.New("2captcha: siteKey is empty")
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
				return "", errors.New("2captcha: timed out waiting for solution")
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

func (p *twoCaptcha) createTask(ctx context.Context, siteKey, pageURL string) (string, error) {
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
		return "", fmt.Errorf("2captcha createTask http: %w", err)
	}
	var r twoCaptchaCreateResp
	if err := json.Unmarshal(resp.Body(), &r); err != nil {
		return "", fmt.Errorf("2captcha createTask decode: %w", err)
	}
	if r.ErrorID != 0 || r.TaskID == nil {
		return "", fmt.Errorf("2captcha createTask: %s %s", r.ErrorCode, r.ErrorDescription)
	}
	// taskId 兼容字符串 / 数字
	switch v := r.TaskID.(type) {
	case string:
		if v == "" {
			return "", errors.New("2captcha createTask: empty taskId")
		}
		return v, nil
	case float64:
		return fmt.Sprintf("%.0f", v), nil
	default:
		return fmt.Sprint(v), nil
	}
}

func (p *twoCaptcha) fetchResult(ctx context.Context, taskID string) (string, bool, error) {
	resp, err := p.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(map[string]any{
			"clientKey": p.cfg.APIKey,
			"taskId":    taskID,
		}).
		Post(p.base + "/getTaskResult")
	if err != nil {
		return "", false, fmt.Errorf("2captcha getTaskResult http: %w", err)
	}
	var r twoCaptchaResultResp
	if err := json.Unmarshal(resp.Body(), &r); err != nil {
		return "", false, fmt.Errorf("2captcha getTaskResult decode: %w", err)
	}
	if r.ErrorID != 0 {
		return "", false, fmt.Errorf("2captcha getTaskResult: %s %s", r.ErrorCode, r.ErrorDescription)
	}
	if r.Status == "ready" {
		if r.Solution.Token == "" {
			return "", false, errors.New("2captcha: ready but empty token")
		}
		return r.Solution.Token, true, nil
	}
	return "", false, nil
}
