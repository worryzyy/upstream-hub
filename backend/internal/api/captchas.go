package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/worryzyy/upstream-hub/internal/storage"
)

func registerCaptchas(g *gin.RouterGroup, d *Deps) {
	gp := g.Group("/captcha-configs")
	gp.GET("", func(c *gin.Context) {
		list, err := d.Captchas.List()
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": list})
	})
	gp.POST("", func(c *gin.Context) { createCaptcha(c, d) })
	gp.PUT("/:id", func(c *gin.Context) { updateCaptcha(c, d) })
	gp.DELETE("/:id", func(c *gin.Context) {
		id, err := uintParam(c, "id")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := d.Captchas.Delete(id); err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
}

type captchaInput struct {
	Name     string                      `json:"name" binding:"required"`
	Type     storage.CaptchaProviderType `json:"type" binding:"required"`
	APIKey   string                      `json:"api_key"`
	Endpoint string                      `json:"endpoint"`
	Extra    string                      `json:"extra"`
	Enabled  bool                        `json:"enabled"`
}

func createCaptcha(c *gin.Context, d *Deps) {
	var in captchaInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	key, err := d.Cipher.Encrypt(in.APIKey)
	if err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	cfg := &storage.CaptchaConfig{
		Name:         in.Name,
		Type:         in.Type,
		APIKeyCipher: key,
		Endpoint:     in.Endpoint,
		Extra:        in.Extra,
		Enabled:      in.Enabled,
	}
	if err := d.Captchas.Create(cfg); err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cfg})
}

func updateCaptcha(c *gin.Context, d *Deps) {
	id, err := uintParam(c, "id")
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	cfg, err := d.Captchas.FindByID(id)
	if err != nil {
		fail(c, http.StatusNotFound, err)
		return
	}
	var in captchaInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	cfg.Name = in.Name
	cfg.Type = in.Type
	cfg.Endpoint = in.Endpoint
	cfg.Extra = in.Extra
	cfg.Enabled = in.Enabled
	if in.APIKey != "" {
		key, err := d.Cipher.Encrypt(in.APIKey)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		cfg.APIKeyCipher = key
	}
	if err := d.Captchas.Update(cfg); err != nil {
		fail(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cfg})
}
