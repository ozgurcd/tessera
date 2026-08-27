package server

func routes(r *gin.Engine) {
    r.GET("/provenance", serviceMissingFallback)
    r.GET("/provenance", actualHandler)
}
