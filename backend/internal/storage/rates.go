package storage

import (
	"time"

	"gorm.io/gorm"
)

type Rates struct{ db *gorm.DB }

func NewRates(db *gorm.DB) *Rates { return &Rates{db: db} }

// ListByChannel 返回渠道当前所有倍率快照。
func (r *Rates) ListByChannel(channelID uint) ([]RateSnapshot, error) {
	var list []RateSnapshot
	if err := r.db.Where("channel_id = ?", channelID).Order("model_name ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// Upsert 更新或插入倍率快照，返回此前的记录（若有），调用方据此判断是否变化。
func (r *Rates) Upsert(snapshot *RateSnapshot) (*RateSnapshot, error) {
	var prev RateSnapshot
	err := r.db.
		Where("channel_id = ? AND model_name = ?", snapshot.ChannelID, snapshot.ModelName).
		First(&prev).Error
	switch {
	case err == nil:
		old := prev
		prev.Ratio = snapshot.Ratio
		prev.CompletionRatio = snapshot.CompletionRatio
		prev.Description = snapshot.Description
		prev.LastSeenAt = snapshot.LastSeenAt
		if err := r.db.Save(&prev).Error; err != nil {
			return nil, err
		}
		return &old, nil
	case err == gorm.ErrRecordNotFound:
		snapshot.FirstSeenAt = snapshot.LastSeenAt
		if err := r.db.Create(snapshot).Error; err != nil {
			return nil, err
		}
		return nil, nil
	default:
		return nil, err
	}
}

func (r *Rates) AppendChange(log *RateChangeLog) error {
	if log.ChangedAt.IsZero() {
		log.ChangedAt = time.Now()
	}
	return r.db.Create(log).Error
}

// ListChanges 倒序拉取倍率变化日志。channelID 为 0 表示不过滤。
func (r *Rates) ListChanges(channelID uint, limit int) ([]RateChangeLog, error) {
	if limit <= 0 {
		limit = 50
	}
	q := r.db.Model(&RateChangeLog{}).Order("changed_at DESC").Limit(limit)
	if channelID != 0 {
		q = q.Where("channel_id = ?", channelID)
	}
	var list []RateChangeLog
	if err := q.Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Rates) AppendBalance(s *BalanceSnapshot) error {
	if s.SampledAt.IsZero() {
		s.SampledAt = time.Now()
	}
	return r.db.Create(s).Error
}

// DeleteBalanceSnapshotsBefore 删除 sampled_at < cutoff 的余额快照，返回删除行数。
func (r *Rates) DeleteBalanceSnapshotsBefore(cutoff time.Time) (int64, error) {
	res := r.db.Where("sampled_at < ?", cutoff).Delete(&BalanceSnapshot{})
	return res.RowsAffected, res.Error
}

// BalanceHistory 倒序拉取余额历史。
func (r *Rates) BalanceHistory(channelID uint, limit int) ([]BalanceSnapshot, error) {
	if limit <= 0 {
		limit = 100
	}
	var list []BalanceSnapshot
	if err := r.db.
		Where("channel_id = ?", channelID).
		Order("sampled_at DESC").
		Limit(limit).
		Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

// DailyAggregate 一天的聚合余额（所有渠道之和）。
type DailyAggregate struct {
	Day     time.Time `json:"day"`
	Balance float64   `json:"balance"`
}

// AggregateBalanceTrend 取最近 N 天的"日内最后一次余额"按渠道之和，作为总余额趋势。
//
// 实现：对每个 (channel_id, day) 取该天最后一次 BalanceSnapshot 的余额，再按 day 求和。
// 没有采样的日子返回 0；调用方应自己外推 / 留空。
func (r *Rates) AggregateBalanceTrend(days int) ([]DailyAggregate, error) {
	if days <= 0 {
		days = 7
	}
	since := time.Now().AddDate(0, 0, -(days - 1)).Truncate(24 * time.Hour)
	type row struct {
		Day     time.Time
		Balance float64
	}
	var rows []row
	err := r.db.Raw(`
		WITH per_day AS (
			SELECT
				channel_id,
				date_trunc('day', sampled_at) AS day,
				MAX(sampled_at)               AS last_at
			FROM balance_snapshots
			WHERE sampled_at >= ?
			GROUP BY channel_id, date_trunc('day', sampled_at)
		)
		SELECT pd.day AS day, SUM(bs.balance) AS balance
		FROM per_day pd
		JOIN balance_snapshots bs
		  ON bs.channel_id = pd.channel_id AND bs.sampled_at = pd.last_at
		GROUP BY pd.day
		ORDER BY pd.day ASC
	`, since).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]DailyAggregate, 0, len(rows))
	for _, r := range rows {
		out = append(out, DailyAggregate{Day: r.Day, Balance: r.Balance})
	}
	return out, nil
}

// AggregateBalanceTrendHourly 取最近 N 小时的"小时内最后一次余额"按渠道之和。
//
// 实现与日趋势一致：对每个 (channel_id, hour) 取该小时最后一次 BalanceSnapshot，
// 再按 hour 求和，用于展示一天内余额波动。
func (r *Rates) AggregateBalanceTrendHourly(hours int) ([]DailyAggregate, error) {
	if hours <= 0 {
		hours = 24
	}
	since := time.Now().Add(-time.Duration(hours-1) * time.Hour).Truncate(time.Hour)
	type row struct {
		Day     time.Time
		Balance float64
	}
	var rows []row
	err := r.db.Raw(`
		WITH per_hour AS (
			SELECT
				channel_id,
				date_trunc('hour', sampled_at) AS hour,
				MAX(sampled_at)                AS last_at
			FROM balance_snapshots
			WHERE sampled_at >= ?
			GROUP BY channel_id, date_trunc('hour', sampled_at)
		)
		SELECT ph.hour AS day, SUM(bs.balance) AS balance
		FROM per_hour ph
		JOIN balance_snapshots bs
		  ON bs.channel_id = ph.channel_id AND bs.sampled_at = ph.last_at
		GROUP BY ph.hour
		ORDER BY ph.hour ASC
	`, since).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]DailyAggregate, 0, len(rows))
	for _, r := range rows {
		out = append(out, DailyAggregate{Day: r.Day, Balance: r.Balance})
	}
	return out, nil
}
