package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/worryzyy/upstream-hub/internal/channel"
	"github.com/worryzyy/upstream-hub/internal/progress"
	"github.com/worryzyy/upstream-hub/internal/storage"
)

func registerChannels(g *gin.RouterGroup, d *Deps) {
	gp := g.Group("/channels")
	gp.GET("", func(c *gin.Context) { listChannels(c, d) })
	gp.POST("", func(c *gin.Context) { createChannel(c, d) })
	gp.GET("/:id", func(c *gin.Context) { getChannel(c, d) })
	gp.PUT("/:id", func(c *gin.Context) { updateChannel(c, d) })
	gp.DELETE("/:id", func(c *gin.Context) { deleteChannel(c, d) })
	gp.POST("/:id/enable", func(c *gin.Context) { toggleChannel(c, d, true) })
	gp.POST("/:id/disable", func(c *gin.Context) { toggleChannel(c, d, false) })
	gp.POST("/:id/test-login", func(c *gin.Context) { testLogin(c, d) })
	gp.POST("/:id/refresh-balance", func(c *gin.Context) { refreshBalance(c, d) })
	gp.POST("/:id/refresh-rates", func(c *gin.Context) { refreshRates(c, d) })
	gp.POST("/:id/sync", func(c *gin.Context) { syncChannel(c, d) })
	gp.GET("/:id/rates", func(c *gin.Context) { channelRates(c, d) })
	gp.GET("/:id/balance-history", func(c *gin.Context) { balanceHistory(c, d) })
}

type channelInput struct {
	Name             string              `json:"name" binding:"required"`
	Type             storage.ChannelType `json:"type" binding:"required"`
	SiteURL          string              `json:"site_url" binding:"required"`
	Username         string              `json:"username" binding:"required"`
	Password         string              `json:"password" binding:"required"`
	TurnstileEnabled bool                `json:"turnstile_enabled"`
	CaptchaConfigID  *uint               `json:"captcha_config_id"`
	BalanceThreshold float64             `json:"balance_threshold"`
	MonitorEnabled   bool                `json:"monitor_enabled"`
}

type channelUpdateInput struct {
	Name             *string  `json:"name"`
	SiteURL          *string  `json:"site_url"`
	Username         *string  `json:"username"`
	Password         *string  `json:"password"`
	TurnstileEnabled *bool    `json:"turnstile_enabled"`
	CaptchaConfigID  *uint    `json:"captcha_config_id"`
	BalanceThreshold *float64 `json:"balance_threshold"`
	MonitorEnabled   *bool    `json:"monitor_enabled"`
}

func listChannels(c *gin.Context, d *Deps) {
	list, err := d.Channels.List()
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func createChannel(c *gin.Context, d *Deps) {
	var in channelInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	created, err := d.ChannelSvc.Create(channel.CreateInput{
		Name:             in.Name,
		Type:             in.Type,
		SiteURL:          in.SiteURL,
		Username:         in.Username,
		Password:         in.Password,
		TurnstileEnabled: in.TurnstileEnabled,
		CaptchaConfigID:  in.CaptchaConfigID,
		BalanceThreshold: in.BalanceThreshold,
		MonitorEnabled:   in.MonitorEnabled,
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": created})
}

func getChannel(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	ch, err := d.Channels.FindByID(id)
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ch})
}

func updateChannel(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	var in channelUpdateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	updated, err := d.ChannelSvc.Update(id, channel.UpdateInput{
		Name:             in.Name,
		SiteURL:          in.SiteURL,
		Username:         in.Username,
		Password:         in.Password,
		TurnstileEnabled: in.TurnstileEnabled,
		CaptchaConfigID:  in.CaptchaConfigID,
		BalanceThreshold: in.BalanceThreshold,
		MonitorEnabled:   in.MonitorEnabled,
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": updated})
}

func deleteChannel(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if err := d.ChannelSvc.Delete(id); err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func toggleChannel(c *gin.Context, d *Deps, enabled bool) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	_, err = d.ChannelSvc.Update(id, channel.UpdateInput{MonitorEnabled: &enabled})
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "monitor_enabled": enabled})
}

func testLogin(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if err := d.ChannelSvc.TestLogin(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func refreshBalance(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	ch, err := d.Channels.FindByID(id)
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	if err := d.Monitor.RefreshBalance(c.Request.Context(), ch); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func refreshRates(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	ch, err := d.Channels.FindByID(id)
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	if err := d.Monitor.RefreshRates(c.Request.Context(), ch); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func channelRates(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	list, err := d.Rates.ListByChannel(id)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func balanceHistory(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	list, err := d.Rates.BalanceHistory(id, limit)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func uintParam(c *gin.Context, name string) (uint, error) {
	id, err := strconv.ParseUint(c.Param(name), 10, 64)
	return uint(id), err
}

// sseObserver 把 progress.Event 序列化成 SSE 格式写入 ResponseWriter。
// 因为 gin 的 Handler 在一个 goroutine 中跑，而 emit 可能从下游同步 / 异步发起，
// 这里加锁保证 writer 串行写。
type sseObserver struct {
	mu     sync.Mutex
	w      io.Writer
	flush  func()
	closed bool
}

func (o *sseObserver) Emit(ev progress.Event) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		return
	}
	// SSE: "data: <json>\n\n"
	if _, err := io.WriteString(o.w, "data: "); err != nil {
		o.closed = true
		return
	}
	if _, err := o.w.Write(payload); err != nil {
		o.closed = true
		return
	}
	if _, err := io.WriteString(o.w, "\n\n"); err != nil {
		o.closed = true
		return
	}
	if o.flush != nil {
		o.flush()
	}
}

// syncChannel 通过 SSE 把整个同步过程的子步骤实时推给前端。
//
//	GET / POST /api/channels/:id/sync
//	响应 Content-Type: text/event-stream，每条事件形如
//	  data: {"stage":"login","message":"登录上游…","time":"..."}
//
// 前端用 fetch + ReadableStream 读取，按 "\n\n" 切片解析。
func syncChannel(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	ch, err := d.Channels.FindByID(id)
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache, no-transform")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no") // disable nginx-style proxy buffering
	c.Writer.WriteHeader(http.StatusOK)

	flusher, _ := c.Writer.(http.Flusher)
	obs := &sseObserver{w: c.Writer}
	if flusher != nil {
		obs.flush = flusher.Flush
	}

	ctx := progress.WithObserver(c.Request.Context(), obs)

	// 串行执行：先余额，再倍率。任一步失败仍尝试下一个，但用 done 表示整体状态。
	balErr := d.Monitor.RefreshBalance(ctx, ch)
	rateErr := d.Monitor.RefreshRates(ctx, ch)

	switch {
	case balErr != nil && rateErr != nil:
		obs.Emit(progress.Event{
			Stage:   progress.StageError,
			Message: balErr.Error() + " | " + rateErr.Error(),
		})
	case balErr != nil:
		obs.Emit(progress.Event{Stage: progress.StageError, Message: balErr.Error()})
	case rateErr != nil:
		obs.Emit(progress.Event{Stage: progress.StageError, Message: rateErr.Error()})
	default:
		obs.Emit(progress.Event{Stage: progress.StageDone, Message: "同步完成"})
	}
}
