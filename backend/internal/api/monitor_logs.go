package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func registerMonitorLogs(g *gin.RouterGroup, d *Deps) {
	g.GET("/monitor-logs", func(c *gin.Context) {
		var channelID uint
		if s := c.Query("channel_id"); s != "" {
			id, err := strconv.ParseUint(s, 10, 64)
			if err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			channelID = uint(id)
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
		list, err := d.MonLogs.List(channelID, limit)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": list})
	})
}
