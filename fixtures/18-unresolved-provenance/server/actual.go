package server

func actualHandler(c *gin.Context) {
    var req struct { ID string `uri:"id"` }
    _ = c.ShouldBindUri(&req)
}
