package server

func routes(r *gin.Engine) {
	r.GET("/api/v1/items", list)
}

func list(c *gin.Context) { _ = c.Query("limit") }
