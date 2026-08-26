package server

func routes(r *gin.Engine) { r.GET("/items", listItems) }
func listItems(c *gin.Context) {
    _ = parsePositiveQuery(c, "page_size", 50, 200)
}
