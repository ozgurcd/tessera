package api

func routes(mux *http.ServeMux) {
	mux.HandleFunc("/files/", files)
	mux.Handle("/api/v1/", http.StripPrefix("/api/v1", v1()))
}

func v1() *http.ServeMux {
	sub := http.NewServeMux()
	sub.HandleFunc("GET /items", items)
	sub.HandleFunc("GET /status", status)
	return sub
}
