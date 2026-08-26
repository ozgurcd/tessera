package server

func routes(r *gin.Engine) { r.GET("/items", listItems) }
func listItems(c *gin.Context) {
    _ = c.Query("page")
    _ = c.DefaultQuery("page_size", "20")
}
