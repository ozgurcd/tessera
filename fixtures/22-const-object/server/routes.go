package server

type widgetRequest struct {
	Name string `json:"name"`
}

func routes(r *gin.Engine) {
	r.GET("/api/v1/search", search)
	r.GET("/api/v1/widgets", list)
	r.GET("/api/v1/widgets/show", show)
	r.POST("/api/v1/widgets", create)
}

func search(c *gin.Context) { _ = c.Query("limit") }
func list(c *gin.Context)   {}
func show(c *gin.Context)   { _ = c.Query("page") }
func create(c *gin.Context) {
	var req widgetRequest
	_ = c.ShouldBindJSON(&req)
}
