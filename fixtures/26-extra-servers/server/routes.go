package api

func routes(mux *http.ServeMux) { mux.HandleFunc("GET /api/v1/things", things) }
