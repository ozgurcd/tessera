package api

func routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/list", a)
	mux.HandleFunc("GET /api/v1/show", b)
	mux.HandleFunc("GET /api/v1/health", c)
}
