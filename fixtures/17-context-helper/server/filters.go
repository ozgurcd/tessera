package server

func parseOrgStateFilter(c *gin.Context) {
    _ = c.Query("active")
    parseDeletedFilter(c)
}

func parseDeletedFilter(c *gin.Context) {
    _ = c.Query("deleted")
}
