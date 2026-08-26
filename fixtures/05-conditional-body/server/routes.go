package server

func routes(r *gin.Engine) { r.POST("/organizations", createOrganization) }
func createOrganization(c *gin.Context) {
    var req struct {
        Name string `json:"name"`
        Domain string `json:"domain"`
        Scope string `json:"scope,omitempty"`
    }
    _ = c.ShouldBindJSON(&req)
}
