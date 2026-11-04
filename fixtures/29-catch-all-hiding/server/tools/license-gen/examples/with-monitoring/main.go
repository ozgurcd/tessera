package main

func main() {
	mux := http.NewServeMux()
	mux.Handle("/api/", mw.Handler(http.HandlerFunc(apiHandler)))
}
