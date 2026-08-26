package server

func routes(r *gin.Engine) {
    r.GET("/first", first)
    r.GET("/second", second)
}
func first(c *gin.Context) { _ = c.Query("page") }
func second(c *gin.Context) { _ = c.Query("limit") }
