package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/go-resty/resty/v2"
	"github.com/worryzyy/upstream-hub/internal/storage"
)

func init() {
	Register(storage.NotifyBark, func(raw string) (Notifier, error) { return newBark(raw) })
}

type barkConfig struct {
	URL string `json:"url"`
}

type bark struct {
	cfg  barkConfig
	http *resty.Client
}

type barkResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func newBark(raw string) (*bark, error) {
	var cfg barkConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, err
	}
	cfg.URL = strings.TrimRight(strings.TrimSpace(cfg.URL), "/")
	cfg.URL = strings.TrimSuffix(cfg.URL, "/这里改成你自己的推送内容")
	if cfg.URL == "" {
		return nil, errors.New("bark url is required")
	}
	parsed, err := url.ParseRequestURI(cfg.URL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		strings.Trim(parsed.Path, "/") == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("bark url must be a valid http or https URL")
	}
	return &bark{cfg: cfg, http: resty.New()}, nil
}

func (b *bark) Type() storage.NotificationChannelType { return storage.NotifyBark }

func (b *bark) Send(ctx context.Context, msg Message) error {
	content := strings.TrimSpace(msg.Subject)
	if msg.Body != "" {
		if content != "" {
			content += "\n"
		}
		content += msg.Body
	}
	target := b.cfg.URL + "/" + url.PathEscape(content)
	resp, err := b.http.R().
		SetContext(ctx).
		Get(target)
	if err != nil {
		return err
	}
	if resp.IsError() {
		return errors.New("bark returned " + resp.Status())
	}
	var out barkResponse
	if err := json.Unmarshal(resp.Body(), &out); err == nil && out.Code != 0 && out.Code != 200 {
		if out.Message != "" {
			return fmt.Errorf("bark returned code %d: %s", out.Code, out.Message)
		}
		return fmt.Errorf("bark returned code %d", out.Code)
	}
	return nil
}
