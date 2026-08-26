package server

func routes(r *gin.Engine) { r.GET("/search", search) }
func search(c *gin.Context) { _ = c.Query("sort") }
