package notify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewBarkNormalizesPushURL(t *testing.T) {
	n, err := newBark(`{"url":"https://api.day.app/abc/这里改成你自己的推送内容"}`)
	if err != nil {
		t.Fatalf("newBark returned error: %v", err)
	}
	if n.cfg.URL != "https://api.day.app/abc" {
		t.Fatalf("URL = %q, want normalized push URL", n.cfg.URL)
	}
}

func TestNewBarkRequiresURL(t *testing.T) {
	if _, err := newBark(`{}`); err == nil {
		t.Fatal("newBark returned nil error, want url validation error")
	}
	if _, err := newBark(`{"url":"https://api.day.app"}`); err == nil {
		t.Fatal("newBark returned nil error, want device key path validation error")
	}
}

func TestBarkSendUsesConfiguredPushURL(t *testing.T) {
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s, want GET", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":200,"message":"success"}`))
	}))
	defer srv.Close()

	n, err := newBark(`{"url":"` + srv.URL + `/abc/"}`)
	if err != nil {
		t.Fatalf("newBark returned error: %v", err)
	}
	err = n.Send(context.Background(), Message{
		Subject: "低余额提醒",
		Body:    "余额低于阈值",
	})
	if err != nil {
		t.Fatalf("Send returned error: %v", err)
	}
	if path != "/abc/低余额提醒\n余额低于阈值" {
		t.Fatalf("path = %q, want notification content appended to configured URL", path)
	}
}

func TestBarkSendReturnsAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":400,"message":"bad device key"}`))
	}))
	defer srv.Close()

	n, err := newBark(`{"url":"` + srv.URL + `/abc"}`)
	if err != nil {
		t.Fatalf("newBark returned error: %v", err)
	}
	if err := n.Send(context.Background(), Message{Subject: "x", Body: "y"}); err == nil {
		t.Fatal("Send returned nil error, want Bark API error")
	}
}
