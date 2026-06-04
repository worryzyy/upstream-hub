// Package sub2api 实现 sub2api 风格上游站点的 connector，参考 docs/USER_BALANCE_GROUP_RATE_AUTH_API_CN-sub2api.md。
package sub2api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/go-resty/resty/v2"
	"github.com/worryzyy/upstream-hub/internal/connector"
)

func init() {
	connector.Register(connector.TypeSub2API, func() connector.Connector { return New() })
}

type Client struct {
	http *resty.Client
}

func New() *Client {
	c := resty.New().
		SetTimeout(30 * time.Second).
		SetHeader("User-Agent", "upstream-hub/0.1").
		SetHeader("Accept", "application/json")
	return &Client{http: c}
}

// sub2Resp sub2api 统一响应外壳：{ code, message, data }。code 0 = 成功。
type sub2Resp struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func (c *Client) GetTurnstileSiteKey(ctx context.Context, ch *connector.Channel) (string, error) {
	body, err := c.getJSON(ctx, strings.TrimRight(ch.SiteURL, "/")+"/api/v1/settings/public", nil)
	if err != nil {
		return "", fmt.Errorf("sub2api public settings: %w", err)
	}
	var settings struct {
		TurnstileEnabled bool   `json:"turnstile_enabled"`
		TurnstileSiteKey string `json:"turnstile_site_key"`
	}
	if err := json.Unmarshal(body, &settings); err != nil {
		return "", fmt.Errorf("sub2api public settings decode: %w", err)
	}
	if !settings.TurnstileEnabled {
		return "", nil
	}
	return settings.TurnstileSiteKey, nil
}

func (c *Client) Login(ctx context.Context, ch *connector.Channel) (*connector.AuthSession, error) {
	site := strings.TrimRight(ch.SiteURL, "/")
	body := map[string]string{
		"email":    ch.Username,
		"password": ch.Password,
	}
	if ch.TurnstileToken != "" {
		body["turnstile_token"] = ch.TurnstileToken
	}

	resp, err := c.http.R().
		SetContext(ctx).
		SetHeader("Content-Type", "application/json").
		SetBody(body).
		Post(site + "/api/v1/auth/login")
	if err != nil {
		return nil, fmt.Errorf("sub2api login http: %w", err)
	}
	if resp.IsError() {
		return nil, fmt.Errorf("sub2api login: %w", connector.HTTPStatusError(resp.StatusCode(), resp.Body()))
	}
	var wrapped sub2Resp
	if err := json.Unmarshal(resp.Body(), &wrapped); err != nil {
		return nil, fmt.Errorf("sub2api login decode: %w", err)
	}
	if wrapped.Code != 0 {
		return nil, fmt.Errorf("sub2api login: %s", wrapped.Message)
	}

	var data struct {
		Requires2FA bool   `json:"requires_2fa"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(wrapped.Data, &data); err != nil {
		return nil, fmt.Errorf("sub2api login data: %w", err)
	}
	if data.Requires2FA {
		return nil, errors.New("sub2api account requires 2FA; please disable it for monitoring accounts")
	}
	if data.AccessToken == "" {
		return nil, errors.New("sub2api login: empty access_token")
	}

	expires := time.Now().Add(time.Duration(data.ExpiresIn) * time.Second)
	if data.ExpiresIn <= 0 {
		expires = time.Now().Add(time.Hour)
	}
	return &connector.AuthSession{
		AccessToken: data.AccessToken,
		ExpiresAt:   expires,
	}, nil
}

func (c *Client) CheckAuth(ctx context.Context, ch *connector.Channel, session *connector.AuthSession) error {
	if session == nil || session.AccessToken == "" {
		return errors.New("missing sub2api access_token")
	}
	_, err := c.getJSON(ctx, strings.TrimRight(ch.SiteURL, "/")+"/api/v1/auth/me", session)
	return err
}

func (c *Client) GetBalance(ctx context.Context, ch *connector.Channel, session *connector.AuthSession) (*connector.BalanceResult, error) {
	body, err := c.getJSON(ctx, strings.TrimRight(ch.SiteURL, "/")+"/api/v1/auth/me", session)
	if err != nil {
		return nil, fmt.Errorf("sub2api me: %w", err)
	}
	var me struct {
		Balance float64 `json:"balance"`
	}
	if err := json.Unmarshal(body, &me); err != nil {
		return nil, fmt.Errorf("sub2api me decode: %w", err)
	}
	return &connector.BalanceResult{
		Balance:   me.Balance,
		SampledAt: time.Now(),
	}, nil
}

func (c *Client) GetRates(ctx context.Context, ch *connector.Channel, session *connector.AuthSession) ([]connector.RateResult, error) {
	site := strings.TrimRight(ch.SiteURL, "/")

	availBody, err := c.getJSON(ctx, site+"/api/v1/groups/available", session)
	if err != nil {
		return nil, fmt.Errorf("sub2api groups available: %w", err)
	}
	var groups []struct {
		ID             uint64  `json:"id"`
		Name           string  `json:"name"`
		Description    string  `json:"description"`
		RateMultiplier float64 `json:"rate_multiplier"`
	}
	if err := json.Unmarshal(availBody, &groups); err != nil {
		return nil, fmt.Errorf("sub2api groups available decode: %w", err)
	}

	overrides := map[string]float64{}
	if ratesBody, err := c.getJSON(ctx, site+"/api/v1/groups/rates", session); err == nil {
		_ = json.Unmarshal(ratesBody, &overrides)
	}

	out := make([]connector.RateResult, 0, len(groups))
	for _, g := range groups {
		rate := g.RateMultiplier
		if v, ok := overrides[strconv.FormatUint(g.ID, 10)]; ok {
			rate = v
		}
		out = append(out, connector.RateResult{
			ModelName:   g.Name,
			Description: g.Description,
			Ratio:       rate,
		})
	}
	return out, nil
}

func (c *Client) getJSON(ctx context.Context, url string, session *connector.AuthSession) ([]byte, error) {
	req := c.http.R().SetContext(ctx)
	if session != nil && session.AccessToken != "" {
		req.SetHeader("Authorization", "Bearer "+session.AccessToken)
	}
	resp, err := req.Get(url)
	if err != nil {
		return nil, err
	}
	if resp.IsError() {
		return nil, connector.HTTPStatusError(resp.StatusCode(), resp.Body())
	}
	var wrapped sub2Resp
	if err := json.Unmarshal(resp.Body(), &wrapped); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if wrapped.Code != 0 {
		return nil, errors.New(wrapped.Message)
	}
	return wrapped.Data, nil
}
