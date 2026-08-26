package server

func routes(r *gin.Engine) { r.POST("/computed", computed) }
func computed(c *gin.Context) {}
