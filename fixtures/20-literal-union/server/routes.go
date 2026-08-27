package server

func routes(r *gin.Engine) {
	r.POST("/api/v1/service-accounts/:id/disable", setServiceAccountState)
	r.POST("/api/v1/service-accounts/:id/enable", setServiceAccountState)
}

func setServiceAccountState(c *gin.Context) {}
