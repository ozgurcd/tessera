package main

func routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/real", real)
	mux.HandleFunc("/files/", files)
	orgLink := http.NewServeMux()
	orgLink.HandleFunc("GET /api/v1/org-link/detail", detail)
	mux.Handle("/api/v1/org-link/", RequireOperator(logging)(orgLink))
}
