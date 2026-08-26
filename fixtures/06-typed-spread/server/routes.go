package server

type organizationRequest struct {
    Name string `json:"name"`
    Domain string `json:"domain"`
    Ignored string `json:"-"`
}

func routes(r *gin.Engine) { r.POST("/organizations", createOrganization) }
func createOrganization(c *gin.Context) {
    var req organizationRequest
    _ = c.BindJSON(&req)
}
