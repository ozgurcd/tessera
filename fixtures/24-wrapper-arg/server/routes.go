package api

func routes(r *gin.Engine) {
	r.GET("/api/v1/things", list)
	r.POST("/api/v1/things", create)
}

type createRequest struct {
	Name string `json:"name"`
}

func list(c *gin.Context) { _ = c.Query("limit") }

func create(c *gin.Context) {
	var req createRequest
	_ = c.ShouldBindJSON(&req)
}
