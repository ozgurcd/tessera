package server

type nestedRequest struct {
    Name  string `json:"name"`
    Child struct {
        Ghost string `json:"ghost"`
    } `json:"child"`
}

func routes(r *gin.Engine) {
    r.POST("/nested", handleNested)
}

func handleNested(c *gin.Context) {
    var req nestedRequest
    _ = c.ShouldBindJSON(&req)
}
