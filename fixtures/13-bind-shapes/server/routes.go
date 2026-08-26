package server

type queryRequest struct {
    Page string `form:"page"`
}

type secondQueryRequest struct {
    Sort string `form:"sort"`
}

type genericRequest struct {
    Name string `json:"name"`
}

type uriRequest struct {
    ID string `uri:"id"`
}

func routes(r *gin.Engine) {
    r.GET("/bind", handleBind)
}

func handleBind(c *gin.Context) {
    var query queryRequest
    var secondQuery secondQueryRequest
    var generic genericRequest
    var uri uriRequest
    _ = c.ShouldBindQuery(&query)
    _ = c.BindQuery(&secondQuery)
    _ = c.ShouldBind(&generic)
    _ = c.ShouldBindUri(&uri)
}
