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
	Register(storage.CaptchaCapSolver, func(c Config) Provider { return newCapSolver(c) })
}

// capSolver 对接 https://capsolver.com 的 AntiTurnstileTaskProxyLess。
//
// 流程：
//
//	POST /createTask     -> { errorId, taskId }
//	POST /getTaskResult  -> { status: "ready", solution: { token } } 或 status: "processing"
//
// 在拿到 ready 之前每 2 秒轮询一次，最多 ~120 秒。
type capSolver struct {
	cfg  Config
	http *resty.Client
	base string
}

func newCapSolver(c Config) *capSolver {
	base := c.Endpoint
	if base == "" {
		base = "https://api.capsolver.com"
	}
	return &capSolver{
		cfg:  c,
		http: resty.New().SetTimeout(30 * time.Second),
		base: base,
	}
}

type capSolverCreateResp struct {
	ErrorID          int    `json:"errorId"`
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	TaskID           string `json:"taskId"`
}

type capSolverResultResp struct {
	ErrorID          int    `json:"errorId"`
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	Status           string `json:"status"` // "ready" | "processing"
	Solution         struct {
		Token string `json:"token"`
	} `json:"solution"`
}

func (p *capSolver) SolveTurnstile(ctx context.Context, siteKey, pageURL string) (string, error) {
	if p.cfg.APIKey == "" {
		return "", errors.New("capsolver: api key is empty")
	}
	if siteKey == "" {
		return "", errors.New("capsolver: siteKey is empty")
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
				return "", errors.New("capsolver: timed out waiting for solution")
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

func (p *capSolver) createTask(ctx context.Context, siteKey, pageURL string) (string, error) {
	body := map[string]any{
		"clientKey": p.cfg.APIKey,
		"task": map[string]any{
			"type":       "AntiTurnstileTaskProxyLess",
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
		return "", fmt.Errorf("capsolver createTask http: %w", err)
	}
	var r capSolverCreateResp
	if err := json.Unmarshal(resp.Body(), &r); err != nil {
		return "", fmt.Errorf("capsolver createTask decode: %w", err)
	}
	if r.ErrorID != 0 || r.TaskID == "" {
		return "", fmt.Errorf("capsolver createTask: %s %s", r.ErrorCode, r.ErrorDescription)
	}
	return r.TaskID, nil
}

func (p *capSolver) fetchResult(ctx context.Context, taskID string) (string, bool, error) {
	resp, err := p.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(map[string]any{
			"clientKey": p.cfg.APIKey,
			"taskId":    taskID,
		}).
		Post(p.base + "/getTaskResult")
	if err != nil {
		return "", false, fmt.Errorf("capsolver getTaskResult http: %w", err)
	}
	var r capSolverResultResp
	if err := json.Unmarshal(resp.Body(), &r); err != nil {
		return "", false, fmt.Errorf("capsolver getTaskResult decode: %w", err)
	}
	if r.ErrorID != 0 {
		return "", false, fmt.Errorf("capsolver getTaskResult: %s %s", r.ErrorCode, r.ErrorDescription)
	}
	if r.Status == "ready" {
		if r.Solution.Token == "" {
			return "", false, errors.New("capsolver: ready but empty token")
		}
		return r.Solution.Token, true, nil
	}
	// "processing" 或其它 → 继续轮询
	return "", false, nil
}
