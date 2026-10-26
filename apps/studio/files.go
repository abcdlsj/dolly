package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// localFiles streams the takes Studio previews. Tauri's asset protocol did this
// through a scope; here one route does, and only for the folders that scope
// allowed: the person's home and the temporary folders recordings land in.
func localFiles(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_dolly/file" {
			serveLocalFile(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func serveLocalFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if !readable(path) {
		http.Error(w, "not a file Studio may read", http.StatusForbidden)
		return
	}
	// ServeFile answers range requests, which is what a <video> needs to seek.
	http.ServeFile(w, r, path)
}

// readable allows absolute paths under the person's home or a temp folder.
func readable(path string) bool {
	if !filepath.IsAbs(path) {
		return false
	}
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false
	}
	for _, root := range []string{home(), os.TempDir(), "/tmp"} {
		if root == "" {
			continue
		}
		if resolved, err := filepath.EvalSymlinks(root); err == nil {
			root = resolved
		}
		if within(root, target) {
			return true
		}
	}
	return false
}

func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
