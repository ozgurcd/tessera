package server

func routes(r *gin.Engine) {
    r.GET("/organizations", handleListOrganizations)
}

func handleListOrganizations(c *gin.Context) {
    parseOrgStateFilter(c)
}
