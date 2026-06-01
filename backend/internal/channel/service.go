// Package channel 提供渠道领域服务：把存储层的加密字段解开成 connector.Channel，
// 处理登录会话的复用与刷新、手动测试登录、手动刷新余额 / 倍率等。
package channel

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/worryzyy/upstream-hub/internal/captcha"
	"github.com/worryzyy/upstream-hub/internal/connector"
	"github.com/worryzyy/upstream-hub/internal/crypto"
	"github.com/worryzyy/upstream-hub/internal/progress"
	"github.com/worryzyy/upstream-hub/internal/storage"
)

// SessionRefreshThreshold 距离过期还有多久就提前刷新登录。
const SessionRefreshThreshold = 5 * time.Minute

// Service 渠道领域服务。
type Service struct {
	Channels     *storage.Channels
	AuthSessions *storage.AuthSessions
	Captchas     *storage.Captchas
	MonitorLogs  *storage.MonitorLogs
	Cipher       *crypto.Cipher
}

func NewService(
	channels *storage.Channels,
	authSessions *storage.AuthSessions,
	captchas *storage.Captchas,
	monitorLogs *storage.MonitorLogs,
	cipher *crypto.Cipher,
) *Service {
	return &Service{
		Channels:     channels,
		AuthSessions: authSessions,
		Captchas:     captchas,
		MonitorLogs:  monitorLogs,
		Cipher:       cipher,
	}
}

// CreateInput 新建渠道使用的明文输入。
type CreateInput struct {
	Name             string
	Type             storage.ChannelType
	SiteURL          string
	Username         string
	Password         string
	TurnstileEnabled bool
	CaptchaConfigID  *uint
	BalanceThreshold float64
	MonitorEnabled   bool
}

func (s *Service) Create(in CreateInput) (*storage.Channel, error) {
	pwd, err := s.Cipher.Encrypt(in.Password)
	if err != nil {
		return nil, fmt.Errorf("encrypt password: %w", err)
	}
	c := &storage.Channel{
		Name:             in.Name,
		Type:             in.Type,
		SiteURL:          in.SiteURL,
		Username:         in.Username,
		PasswordCipher:   pwd,
		TurnstileEnabled: in.TurnstileEnabled,
		CaptchaConfigID:  in.CaptchaConfigID,
		BalanceThreshold: in.BalanceThreshold,
		MonitorEnabled:   in.MonitorEnabled,
	}
	if err := s.Channels.Create(c); err != nil {
		return nil, err
	}
	return c, nil
}

// UpdateInput 编辑渠道的可选字段。Password 为空表示不修改密码。
type UpdateInput struct {
	Name             *string
	SiteURL          *string
	Username         *string
	Password         *string
	TurnstileEnabled *bool
	CaptchaConfigID  *uint
	BalanceThreshold *float64
	MonitorEnabled   *bool
}

func (s *Service) Update(id uint, in UpdateInput) (*storage.Channel, error) {
	c, err := s.Channels.FindByID(id)
	if err != nil {
		return nil, err
	}
	if in.Name != nil {
		c.Name = *in.Name
	}
	if in.SiteURL != nil {
		c.SiteURL = *in.SiteURL
	}
	if in.Username != nil {
		c.Username = *in.Username
	}
	if in.Password != nil && *in.Password != "" {
		pwd, err := s.Cipher.Encrypt(*in.Password)
		if err != nil {
			return nil, fmt.Errorf("encrypt password: %w", err)
		}
		c.PasswordCipher = pwd
		// 密码变了，强制下次重新登录。
		_ = s.AuthSessions.Delete(c.ID)
	}
	if in.TurnstileEnabled != nil {
		c.TurnstileEnabled = *in.TurnstileEnabled
	}
	if in.CaptchaConfigID != nil {
		c.CaptchaConfigID = in.CaptchaConfigID
	}
	if in.BalanceThreshold != nil {
		c.BalanceThreshold = *in.BalanceThreshold
	}
	if in.MonitorEnabled != nil {
		c.MonitorEnabled = *in.MonitorEnabled
	}
	if err := s.Channels.Update(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Service) Delete(id uint) error {
	_ = s.AuthSessions.Delete(id)
	return s.Channels.Delete(id)
}

// Resolve 把存储层的加密渠道解密成 connector 可用的 Channel。
//
// 注意：这一步**不**求解 Turnstile —— 打码只在真正要登录时做（见 prepareTurnstile），
// 复用现有 session 的路径无需任何打码消耗。
func (s *Service) Resolve(ctx context.Context, c *storage.Channel) (*connector.Channel, error) {
	_ = ctx // 保留参数以保持调用方签名
	pwd, err := s.Cipher.Decrypt(c.PasswordCipher)
	if err != nil {
		return nil, fmt.Errorf("decrypt password: %w", err)
	}
	return &connector.Channel{
		ID:               c.ID,
		Name:             c.Name,
		Type:             connector.ChannelType(c.Type),
		SiteURL:          c.SiteURL,
		Username:         c.Username,
		Password:         pwd,
		TurnstileEnabled: c.TurnstileEnabled,
	}, nil
}

// prepareTurnstile 在调用 conn.Login 之前求解 Turnstile token。
// 没启用 turnstile 或者上游 site 公开接口说"未开启 Turnstile"时是空操作。
func (s *Service) prepareTurnstile(
	ctx context.Context,
	c *storage.Channel,
	resolved *connector.Channel,
	conn connector.Connector,
) error {
	if !c.TurnstileEnabled || c.CaptchaConfigID == nil {
		return nil
	}
	progress.Start(ctx, progress.StageCaptcha, "求解 Turnstile…")
	siteKey, err := conn.GetTurnstileSiteKey(ctx, resolved)
	if err != nil {
		progress.Fail(ctx, progress.StageCaptcha, err.Error())
		return fmt.Errorf("fetch turnstile site key: %w", err)
	}
	if siteKey == "" {
		progress.OK(ctx, progress.StageCaptcha, "上游未开启 Turnstile，跳过")
		return nil
	}
	token, err := s.solveCaptcha(ctx, *c.CaptchaConfigID, siteKey, c.SiteURL)
	if err != nil {
		progress.Fail(ctx, progress.StageCaptcha, err.Error())
		return fmt.Errorf("solve captcha: %w", err)
	}
	resolved.TurnstileToken = token
	progress.OK(ctx, progress.StageCaptcha, "打码完成")
	return nil
}

func (s *Service) solveCaptcha(ctx context.Context, captchaID uint, siteKey, pageURL string) (string, error) {
	cfg, err := s.Captchas.FindByID(captchaID)
	if err != nil {
		return "", err
	}
	if !cfg.Enabled {
		return "", errors.New("captcha config disabled")
	}
	apiKey, err := s.Cipher.Decrypt(cfg.APIKeyCipher)
	if err != nil {
		return "", err
	}
	provider, err := captcha.Build(cfg, apiKey)
	if err != nil {
		return "", err
	}
	return provider.SolveTurnstile(ctx, siteKey, pageURL)
}

// EnsureSession 优先复用未过期的 session，否则重新登录并加密回写。
func (s *Service) EnsureSession(
	ctx context.Context,
	c *storage.Channel,
	resolved *connector.Channel,
	conn connector.Connector,
) (*connector.AuthSession, error) {
	saved, err := s.AuthSessions.FindByChannel(c.ID)
	if err != nil {
		return nil, err
	}
	if saved != nil && saved.ExpiresAt != nil && time.Until(*saved.ExpiresAt) > SessionRefreshThreshold {
		session, err := s.decryptSession(saved)
		if err != nil {
			return nil, err
		}
		// 轻量校验现有 session，不通过则继续走重新登录。
		progress.Start(ctx, progress.StageSession, "校验已有会话…")
		if err := conn.CheckAuth(ctx, resolved, session); err == nil {
			progress.OK(ctx, progress.StageSession, "复用现有会话")
			return session, nil
		}
		progress.OK(ctx, progress.StageSession, "会话已失效，重新登录")
	}
	return s.login(ctx, c, resolved, conn)
}

func (s *Service) login(
	ctx context.Context,
	c *storage.Channel,
	resolved *connector.Channel,
	conn connector.Connector,
) (*connector.AuthSession, error) {
	if err := s.prepareTurnstile(ctx, c, resolved, conn); err != nil {
		return nil, err
	}
	progress.Start(ctx, progress.StageLogin, "登录上游…")
	started := time.Now()
	session, err := conn.Login(ctx, resolved)
	finished := time.Now()
	_ = s.MonitorLogs.Append(&storage.MonitorLog{
		ChannelID:    c.ID,
		Job:          storage.MonitorJobLogin,
		Success:      err == nil,
		ErrorMessage: errString(err),
		StartedAt:    started,
		FinishedAt:   finished,
	})
	if err != nil {
		progress.Fail(ctx, progress.StageLogin, err.Error())
		_ = s.Channels.SetLastError(c.ID, err.Error())
		return nil, err
	}
	if err := s.persistSession(c.ID, session); err != nil {
		progress.Fail(ctx, progress.StageLogin, err.Error())
		return nil, err
	}
	_ = s.Channels.SetLastError(c.ID, "")
	progress.OK(ctx, progress.StageLogin, "登录成功")
	return session, nil
}

func (s *Service) persistSession(channelID uint, session *connector.AuthSession) error {
	acc, err := s.Cipher.Encrypt(session.AccessToken)
	if err != nil {
		return fmt.Errorf("encrypt access token: %w", err)
	}
	cookie, err := s.Cipher.Encrypt(session.Cookie)
	if err != nil {
		return fmt.Errorf("encrypt cookie: %w", err)
	}
	csrf, err := s.Cipher.Encrypt(session.CSRFToken)
	if err != nil {
		return fmt.Errorf("encrypt csrf: %w", err)
	}
	now := time.Now()
	expires := session.ExpiresAt
	return s.AuthSessions.Upsert(&storage.AuthSession{
		ChannelID:         channelID,
		UserID:            session.UserID,
		AccessTokenCipher: acc,
		CookieCipher:      cookie,
		CSRFTokenCipher:   csrf,
		ExpiresAt:         &expires,
		LastLoginAt:       &now,
	})
}

func (s *Service) decryptSession(saved *storage.AuthSession) (*connector.AuthSession, error) {
	acc, err := s.Cipher.Decrypt(saved.AccessTokenCipher)
	if err != nil {
		return nil, fmt.Errorf("decrypt access token: %w", err)
	}
	cookie, err := s.Cipher.Decrypt(saved.CookieCipher)
	if err != nil {
		return nil, fmt.Errorf("decrypt cookie: %w", err)
	}
	csrf, err := s.Cipher.Decrypt(saved.CSRFTokenCipher)
	if err != nil {
		return nil, fmt.Errorf("decrypt csrf: %w", err)
	}
	expires := time.Time{}
	if saved.ExpiresAt != nil {
		expires = *saved.ExpiresAt
	}
	return &connector.AuthSession{
		UserID:      saved.UserID,
		AccessToken: acc,
		Cookie:      cookie,
		CSRFToken:   csrf,
		ExpiresAt:   expires,
	}, nil
}

// TestLogin 手动测试登录：复用 login() 的完整流程（打码 → 登录 → 持久化 + monitor log + 进度事件），
// 成功后 session 落库，下一次 sync 直接复用、不浪费打码额度。
func (s *Service) TestLogin(ctx context.Context, channelID uint) error {
	c, err := s.Channels.FindByID(channelID)
	if err != nil {
		return err
	}
	resolved, err := s.Resolve(ctx, c)
	if err != nil {
		return err
	}
	conn, err := connector.For(connector.ChannelType(c.Type))
	if err != nil {
		return err
	}
	_, err = s.login(ctx, c, resolved, conn)
	return err
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
