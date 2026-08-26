package server

func routes(r *gin.Engine) {
    g := r.Group("/first")
    g.GET("/one", handleKnown)
    if enabled {
        g := r.Group("/second")
        g.GET("/two", handleKnown)
    }
    g.GET("/after", handleKnown)
}

func otherRoutes(r *gin.Engine) {
    g := r.Group("/third")
    g.GET("/three", handleKnown)
}

func handleKnown(c *gin.Context) {
    _ = c.Query("known")
}
