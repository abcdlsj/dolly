package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// runDolly runs the bundled `dolly` with argv and returns the one JSON object
// it prints. Its exit code is part of that object, so a failed verb still
// answers.
func runDolly(argv []string) (any, error) {
	path := searchPath()
	binary := findOnPath(path, "dolly")
	if binary == "" {
		return nil, errors.New("dolly is missing from the app bundle")
	}
	cmd := exec.Command(binary, argv...)
	cmd.Env = append(os.Environ(), "PATH="+path)
	out, err := cmd.Output()
	if len(out) == 0 {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("dolly printed nothing")
	}
	var value any
	if err := json.Unmarshal(out, &value); err != nil {
		return nil, fmt.Errorf("dolly printed no JSON: %w", err)
	}
	return value, nil
}

// check is what Settings shows after asking a provider for its model list.
type check struct {
	OK    bool   `json:"ok"`
	MS    int64  `json:"ms"`
	Error string `json:"error,omitempty"`
}

// providerCheck lists the provider's models with the stored key. The key goes to
// curl on stdin, never in argv.
func providerCheck(provider, endpoint string) check {
	key, ok := secret(provider)
	if !ok {
		return check{Error: "No key yet"}
	}
	url, header := "", ""
	switch provider {
	case "openai":
		url, header = "https://api.openai.com/v1/models", "Authorization: Bearer "+key
	case "openrouter":
		url, header = "https://openrouter.ai/api/v1/models", "Authorization: Bearer "+key
	case "custom":
		// An OpenAI-compatible endpoint is only known from the address the
		// person typed, so an empty one is a refusal, not a pass.
		if strings.TrimSpace(endpoint) == "" {
			return check{Error: "No address"}
		}
		url, header = modelsURL(endpoint), "Authorization: Bearer "+key
	default:
		url, header = "https://api.anthropic.com/v1/models", "x-api-key: "+key+"\nanthropic-version: 2023-06-01"
	}

	started := time.Now()
	cmd := exec.Command("curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", "-H", "@-", url)
	cmd.Stdin = strings.NewReader(header)
	out, err := cmd.Output()
	ms := time.Since(started).Milliseconds()
	if err != nil {
		return check{MS: ms, Error: err.Error()}
	}
	switch status := strings.TrimSpace(string(out)); status {
	case "200":
		return check{OK: true, MS: ms}
	case "401", "403":
		return check{MS: ms, Error: "Key not accepted"}
	case "000":
		return check{MS: ms, Error: "No connection"}
	default:
		return check{MS: ms, Error: "Error " + status}
	}
}

// modelsURL is the address a base URL exposes its model list at.
func modelsURL(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if strings.HasSuffix(base, "/models") {
		return base
	}
	return base + "/models"
}

// installedApp is one entry of the app picker.
type installedApp struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Version string `json:"version"`
}

// installedApps lists the apps a person could film.
func installedApps() []installedApp {
	apps := []installedApp{}
	for _, dir := range []string{"/Applications", filepath.Join(home(), "Applications")} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".app") {
				continue
			}
			if app, ok := readApp(filepath.Join(dir, entry.Name())); ok {
				apps = append(apps, app)
			}
		}
	}
	sort.Slice(apps, func(i, j int) bool {
		return strings.ToLower(apps[i].Name) < strings.ToLower(apps[j].Name)
	})
	return apps
}

// chooseApp asks macOS for one app with its own picker; a cancel is nil.
func chooseApp() *installedApp {
	const script = `POSIX path of (choose application with prompt "Choose the app to film" as alias)`
	out, err := exec.Command("osascript", "-e", script).Output()
	if err != nil {
		return nil
	}
	path := strings.TrimSuffix(strings.TrimSpace(string(out)), "/")
	if path == "" {
		return nil
	}
	app, ok := readApp(path)
	if !ok {
		return nil
	}
	return &app
}

// readApp names an .app the way its Info.plist does.
func readApp(path string) (installedApp, bool) {
	out, err := exec.Command("plutil", "-convert", "json", "-o", "-", filepath.Join(path, "Contents", "Info.plist")).Output()
	if err != nil {
		return installedApp{}, false
	}
	var info map[string]any
	if err := json.Unmarshal(out, &info); err != nil {
		return installedApp{}, false
	}
	name, _ := info["CFBundleDisplayName"].(string)
	if name == "" {
		name, _ = info["CFBundleName"].(string)
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(path), ".app")
	}
	version, _ := info["CFBundleShortVersionString"].(string)
	return installedApp{Name: name, Path: path, Version: version}, true
}

// reveal shows a file in Finder.
func reveal(path string) {
	_ = run("open", "-R", expand(path))
}
