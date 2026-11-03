package server

import "net/http"

const (
	itemsPath    = "/api/v1/items"
	itemByIDPath = "/api/v1/items/{id}"
)

func register(mux *http.ServeMux) {
	mux.HandleFunc("GET "+itemsPath, listItems)
	mux.HandleFunc("POST "+itemsPath, createItem)
	mux.Handle("DELETE "+itemByIDPath, http.HandlerFunc(deleteItem))
	mux.HandleFunc("/api/setup/status", statusHandler)
	mux.HandleFunc("/api/files/", filesHandler)
	http.HandleFunc("GET /healthz", health)
}

func listItems(w http.ResponseWriter, r *http.Request)    {}
func createItem(w http.ResponseWriter, r *http.Request)   {}
func deleteItem(w http.ResponseWriter, r *http.Request)   {}
func statusHandler(w http.ResponseWriter, r *http.Request) {}
func filesHandler(w http.ResponseWriter, r *http.Request) {}
func health(w http.ResponseWriter, r *http.Request)       {}
