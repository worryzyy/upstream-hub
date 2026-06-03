package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/worryzyy/upstream-hub/internal/crypto"
	"github.com/worryzyy/upstream-hub/internal/storage"
)

// Dispatcher 把单条事件 fan-out 到所有启用的通知渠道，并按 Policy 做去抖。
type Dispatcher struct {
	repo     *storage.Notifications
	cipher   *crypto.Cipher
	log      *slog.Logger
	policy   Policy
	cooldown CooldownStore
}

// NewDispatcher 用 *storage.Notifications 作为 CooldownStore 的具体实现，
// 跨重启的冷却记录持久化在 PostgreSQL 的 notification_cooldowns 表里。
//
// 如果上层需要注入 stub（比如单测），可以用 NewDispatcherWithCooldown。
func NewDispatcher(repo *storage.Notifications, cipher *crypto.Cipher, log *slog.Logger, policy Policy) *Dispatcher {
	return NewDispatcherWithCooldown(repo, cipher, log, policy, repo)
}

func NewDispatcherWithCooldown(repo *storage.Notifications, cipher *crypto.Cipher, log *slog.Logger, policy Policy, cooldown CooldownStore) *Dispatcher {
	if policy.SendMaxAttempts <= 0 {
		policy.SendMaxAttempts = 1
	}
	return &Dispatcher{
		repo:     repo,
		cipher:   cipher,
		log:      log,
		policy:   policy,
		cooldown: cooldown,
	}
}

// Policy 返回当前策略，便于调用方做条件分支（如是否走批量路径）。
func (d *Dispatcher) Policy() Policy {
	return d.policy
}

// Send 把消息发送到一个具体的渠道（用于"测试发送"按钮）。
// 不走 Policy 过滤 / 不走重试——测试场景要求快速反馈，失败立刻显示出来。
func (d *Dispatcher) Send(ctx context.Context, ch *storage.NotificationChannel, msg Message) error {
	if demoNotifyEnabled() {
		d.logResult(ch.ID, msg, nil)
		return nil
	}
	cfgJSON, err := d.cipher.Decrypt(ch.ConfigCipher)
	if err != nil {
		return fmt.Errorf("decrypt config: %w", err)
	}
	n, err := Build(ch, cfgJSON)
	if err != nil {
		return err
	}
	err = n.Send(ctx, msg)
	d.logResult(ch.ID, msg, err)
	return err
}

// Dispatch 按事件类型广播到所有启用的通知渠道，返回累计错误（部分失败也会写日志）。
//
// 订阅过滤：渠道配置 Subscriptions 非空时，必须有任意一条订阅命中 msg 才发送；
// 空订阅列表（""/null/[]）视为"订阅一切"，向后兼容已有通知渠道。
//
// 去抖：balance_low 同渠道在 BalanceLowCooldown 内不重复推送，状态在 PostgreSQL 里持久化。
// 失败：按 SendMaxAttempts 进行指数退避重试。
func (d *Dispatcher) Dispatch(ctx context.Context, msg Message) error {
	if d.suppress(msg) {
		return nil
	}
	return d.fanout(ctx, msg, nil)
}

// DispatchRateBatch 把一次扫描收集到的多条 RateChange 按 Policy 合并 / 过滤后推送。
//
//   - 先按 MinChangePct 过滤掉小变动
//   - 然后对每个通知渠道：先用它自己的 Subscriptions 切片出它关心的 changes，
//     再按 BatchRateChanges 决定合并发送 1 条还是逐条发送
//
// 关键：合并消息只包含订阅匹配的子集，避免"全合并后 ModelName='' 被 groups 模式订阅过滤掉"的边界。
func (d *Dispatcher) DispatchRateBatch(ctx context.Context, channel *storage.Channel, changes []RateChange) error {
	if channel == nil || len(changes) == 0 {
		return nil
	}
	filtered := make([]RateChange, 0, len(changes))
	for _, c := range changes {
		if c.ChangePctAbove(d.policy.MinChangePct) {
			filtered = append(filtered, c)
		}
	}
	if len(filtered) == 0 {
		return nil
	}

	notifyChannels, err := d.repo.ListEnabledChannels()
	if err != nil {
		return err
	}
	if len(notifyChannels) == 0 {
		return nil
	}

	var errs []error
	for i := range notifyChannels {
		nch := notifyChannels[i]
		subs, _ := ParseSubscriptions(nch.Subscriptions)

		// 切出该通知渠道关心的 changes 子集。
		matching := subsetForSubscriptions(channel.ID, filtered, subs)
		if len(matching) == 0 {
			continue
		}

		if d.policy.BatchRateChanges {
			merged := BuildBatchMessage(channel, matching)
			if err := d.sendOne(ctx, &nch, merged); err != nil {
				errs = append(errs, err)
			}
		} else {
			// 用户显式关掉合并：仍按订阅切片，但逐条发。
			for _, c := range matching {
				single := BuildBatchMessage(channel, []RateChange{c})
				if err := d.sendOne(ctx, &nch, single); err != nil {
					errs = append(errs, err)
				}
			}
		}
	}
	return errors.Join(errs...)
}

// subsetForSubscriptions 把 changes 过滤成"匹配 subs 订阅规则"的子集。
// subs 为空（订阅一切）→ 返回全部。
func subsetForSubscriptions(upstreamID uint, changes []RateChange, subs []Subscription) []RateChange {
	if len(subs) == 0 {
		return changes
	}
	out := make([]RateChange, 0, len(changes))
	for _, c := range changes {
		stub := Message{
			Event:     storage.EventRateChanged,
			ChannelID: upstreamID,
			ModelName: c.GroupName,
		}
		if AnyMatch(subs, stub) {
			out = append(out, c)
		}
	}
	return out
}

// suppress 判断是否要按 cooldown 跳过本次发送。仅对 balance_low 生效。
func (d *Dispatcher) suppress(msg Message) bool {
	if msg.Event != storage.EventBalanceLow {
		return false
	}
	if msg.ChannelID == 0 {
		return false
	}
	if d.policy.BalanceLowCooldown <= 0 {
		return false
	}
	ok, err := d.cooldown.TryClaimCooldown(msg.ChannelID, msg.Event, d.policy.BalanceLowCooldown)
	if err != nil {
		if d.log != nil {
			d.log.Warn("cooldown lookup failed, sending anyway",
				"err", err, "channel_id", msg.ChannelID, "event", msg.Event)
		}
		return false
	}
	if !ok && d.log != nil {
		d.log.Debug("notification suppressed by cooldown",
			"event", msg.Event,
			"channel_id", msg.ChannelID,
			"cooldown", d.policy.BalanceLowCooldown,
		)
	}
	return !ok
}

// fanout 广播给所有启用的通知渠道（仅给 Dispatch 用，DispatchRateBatch 自己控订阅切片）。
//
// extraFilter 可选：用于在 ParseSubscriptions / AnyMatch 之后做额外裁剪；
// 当前没有调用方传入，保留参数位是为以后扩展。
func (d *Dispatcher) fanout(ctx context.Context, msg Message, extraFilter func(*storage.NotificationChannel) bool) error {
	channels, err := d.repo.ListEnabledChannels()
	if err != nil {
		return err
	}
	if len(channels) == 0 {
		return nil
	}
	var errs []error
	for i := range channels {
		ch := channels[i]
		subs, _ := ParseSubscriptions(ch.Subscriptions)
		if len(subs) > 0 && !AnyMatch(subs, msg) {
			continue
		}
		if extraFilter != nil && !extraFilter(&ch) {
			continue
		}
		if err := d.sendOne(ctx, &ch, msg); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// sendOne 给单个通知渠道发送一条消息，包含"解密配置 → 构造 Notifier → 重试发送 → 写日志"。
func (d *Dispatcher) sendOne(ctx context.Context, ch *storage.NotificationChannel, msg Message) error {
	if demoNotifyEnabled() {
		d.logResult(ch.ID, msg, nil)
		return nil
	}
	cfgJSON, err := d.cipher.Decrypt(ch.ConfigCipher)
	if err != nil {
		d.logResult(ch.ID, msg, err)
		return fmt.Errorf("decrypt %s: %w", ch.Name, err)
	}
	n, err := Build(ch, cfgJSON)
	if err != nil {
		d.logResult(ch.ID, msg, err)
		return fmt.Errorf("build %s: %w", ch.Name, err)
	}
	sendErr := d.sendWithRetry(ctx, ch.Name, n, msg)
	d.logResult(ch.ID, msg, sendErr)
	if sendErr != nil {
		return fmt.Errorf("send via %s: %w", ch.Name, sendErr)
	}
	return nil
}

// sendWithRetry 指数退避重试发送。
//
// 重试策略：
//   - 最多 SendMaxAttempts 次（含首发）
//   - 退避 = 2^(attempt-1) * 1s，上限 30s（即 1s / 2s / 4s / 8s / 16s / 30s ...）
//   - ctx 被取消时立即返回，不再等待
//
// 注意：所有错误都会重试，包括 "Telegram 401 unauthorized" 这类永久错误。
// 单用户场景下，简单胜过复杂；如果反复重试相同 401，反正最多 SendMaxAttempts 次就停了。
func (d *Dispatcher) sendWithRetry(ctx context.Context, channelName string, n Notifier, msg Message) error {
	maxAttempts := d.policy.SendMaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := n.Send(ctx, msg)
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt == maxAttempts {
			break
		}
		delay := backoffDelay(attempt)
		if d.log != nil {
			d.log.Warn("notify send failed, will retry",
				"channel", channelName,
				"attempt", attempt,
				"max_attempts", maxAttempts,
				"retry_in", delay,
				"err", err,
			)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	return lastErr
}

// backoffDelay 指数退避：第 1 次重试等 1s，第 2 次等 2s，第 3 次等 4s …
// 上限 30s 避免重试链拉得过长。
func backoffDelay(attempt int) time.Duration {
	const maxDelay = 30 * time.Second
	delay := time.Duration(1<<uint(attempt-1)) * time.Second
	if delay > maxDelay || delay <= 0 {
		return maxDelay
	}
	return delay
}

func (d *Dispatcher) logResult(channelID uint, msg Message, sendErr error) {
	log := &storage.NotificationLog{
		ChannelID: channelID,
		Event:     msg.Event,
		Subject:   msg.Subject,
		Body:      msg.Body,
		Success:   sendErr == nil,
	}
	if sendErr != nil {
		log.ErrorMessage = sendErr.Error()
	}
	if err := d.repo.AppendLog(log); err != nil && d.log != nil {
		d.log.Warn("append notification log", "err", err)
	}
}

func demoNotifyEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("UPSTREAMHUB_DEMO_NOTIFY"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
