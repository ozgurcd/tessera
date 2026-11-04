package api

func routes(r *gin.Engine) { r.GET("/api/v1/items", list) }

func list(c *gin.Context) {
	mw.RespondUnauthenticatedReason(c, "no_session")
	mw.RespondAuthStoreUnavailable(c, "store_down")
	_ = c.Query("limit")
}
