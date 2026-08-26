package server

type createOrganizationRequest struct {
    Name       string `json:"name"`
    Domain     string `json:"domain"`
    AdminEmail string `json:"admin_email"`
}

func routes(r *gin.Engine) {
    r.POST("/organizations", serviceMissingFallback)
    r.POST("/organizations", handleCreateOrganization)
    r.POST("/organizations", organizationServiceMissing)
}

func serviceMissingFallback(c *gin.Context) {}
func organizationServiceMissing(c *gin.Context) {}
func handleCreateOrganization(c *gin.Context) {
    var req createOrganizationRequest
    _ = c.ShouldBindJSON(&req)
}
