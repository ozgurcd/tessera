package server

func routes(r *gin.Engine) {
	r.GET("/api/v1/organizations/:id/identity-provider", identityProvider)
}

func identityProvider(c *gin.Context) {}
