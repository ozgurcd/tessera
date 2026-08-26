package server

func routes(r *gin.Engine) { r.GET("/organizations/:id/members", members) }
func members(c *gin.Context) { _ = c.Query("status") }
