package server

func routes(r *gin.Engine) {
    r.GET("/resource", getResource)
    r.POST("/resource", createResource)
}
func getResource(c *gin.Context) { _ = c.Query("page") }
func createResource(c *gin.Context) {
    var req struct { Name string `json:"name"` }
    _ = c.ShouldBindJSON(&req)
}
