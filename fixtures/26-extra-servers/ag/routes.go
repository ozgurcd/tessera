package ag

func routes(r *gin.Engine) { r.GET("/api/v1/plan", plan) }

func plan(c *gin.Context) { _ = c.Query("limit") }
