package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

const bundleID = "app.dolly.studio"

func home() string {
	dir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return dir
}

func expand(path string) string {
	if rest, ok := strings.CutPrefix(path, "~/"); ok {
		return filepath.Join(home(), rest)
	}
	return path
}

// appDataDir is where Studio keeps its own things. The Tauri build used the
// same folder, so a film list and agent sessions survive the move.
func appDataDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(home(), "Library", "Application Support", bundleID)
	}
	return filepath.Join(dir, bundleID)
}

// executable is the running binary; inside Dolly.app it sits in Contents/MacOS.
func executable() string {
	path, err := os.Executable()
	if err != nil {
		return ""
	}
	return path
}

// sidecarDir is where the bundled `dolly` and `dolly-driver` live: next to this
// executable. `dolly` looks for its driver the same way.
func sidecarDir() string {
	return filepath.Dir(executable())
}

// resourceDir holds the skill and the agent extension inside Dolly.app.
func resourceDir() string {
	return filepath.Join(sidecarDir(), "..", "Resources")
}

// insideBundle reports whether this process was started from a .app, which is
// what user notifications and the Accessibility grant are keyed to.
func insideBundle() bool {
	return strings.Contains(executable(), ".app/Contents/MacOS/")
}

// searchPath is the PATH a Finder launch lacks: the sidecar folder, where pi is
// usually installed, and then whatever the person's shell had.
func searchPath() string {
	dirs := []string{sidecarDir(), "/opt/homebrew/bin", "/usr/local/bin"}
	for _, dir := range []string{".bun/bin", ".npm-global/bin", ".local/bin", ".volta/bin"} {
		dirs = append(dirs, filepath.Join(home(), dir))
	}
	dirs = append(dirs, filepath.SplitList(os.Getenv("PATH"))...)
	return strings.Join(dirs, string(os.PathListSeparator))
}

func findOnPath(path, name string) string {
	for _, dir := range filepath.SplitList(path) {
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func run(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}

// quote makes a string safe to paste into an AppleScript literal.
func quote(text string) string {
	text = strings.ReplaceAll(text, `\`, `\\`)
	text = strings.ReplaceAll(text, `"`, `\"`)
	return `"` + text + `"`
}

func notificationsOptions(title, body string) notifications.NotificationOptions {
	return notifications.NotificationOptions{Title: title, Body: body}
}
