package server

type protectedRequest struct {
    Name string `json:"name"`
}

func routes(r *gin.Engine) {
    r.POST("/protected", RequireFeature("organizations"), handleProtected)
}

func RequireFeature(feature string) gin.HandlerFunc {
    return func(c *gin.Context) { _ = c.Query("middleware_only") }
}

func handleProtected(c *gin.Context) {
    var req protectedRequest
    _ = c.ShouldBindJSON(&req)
}
