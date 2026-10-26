package main

import (
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// Studio is the one service the web view can call. Every command arrives as a
// name plus the argument object Tauri's invoke took, so src/platform.ts stays a
// thin shim and the frontend has no bindings to keep in step.
type Studio struct {
	app    *application.App
	notify *notifications.NotificationService
	tray   *application.SystemTray
	agents *agents

	// calls folds the dolly calls windows make at the same time; runDolly is
	// the process behind them, replaceable in tests.
	mu       sync.Mutex
	calls    map[string]*dollyCall
	runDolly func([]string) (any, error)
}

func newStudio() *Studio {
	return &Studio{agents: newAgents(), calls: map[string]*dollyCall{}, runDolly: runDolly}
}

func (s *Studio) attach(app *application.App, notify *notifications.NotificationService) {
	s.app = app
	s.notify = notify
}

// Invoke runs one command and returns what the frontend expects. Windows, the
// keychain, pi and the bundled `dolly` all live behind these names.
func (s *Studio) Invoke(command string, args map[string]any) (any, error) {
	switch command {
	case "show_window":
		s.showWindow(text(args, "label"))
		return nil, nil
	case "hide_window":
		s.hideWindow(text(args, "label"))
		return nil, nil
	case "quit":
		s.quit()
		return nil, nil
	case "tray_title":
		if s.tray != nil {
			s.tray.SetLabel(text(args, "title"))
		}
		return nil, nil
	case "notify":
		s.announce(text(args, "title"), text(args, "body"))
		return nil, nil
	case "secret_set":
		return secretSet(text(args, "provider"), text(args, "key"))
	case "provider_check":
		return providerCheck(text(args, "provider"), text(args, "endpoint")), nil
	case "dolly":
		return s.dolly(list(args, "argv"))
	case "screen_access":
		return screenAccess(), nil
	case "open_permission_settings":
		openPermissionSettings(text(args, "kind"))
		return nil, nil
	case "installed_apps":
		return installedApps(), nil
	case "choose_app":
		return chooseApp(), nil
	case "reveal":
		reveal(text(args, "path"))
		return nil, nil
	case "pi_start":
		err := s.agents.start(s.app, text(args, "id"), list(args, "args"), text(args, "provider"), text(args, "endpoint"), text(args, "model"))
		return nil, err
	case "pi_send":
		return nil, s.agents.send(text(args, "id"), text(args, "line"))
	case "pi_kill":
		s.agents.kill(text(args, "id"))
		return nil, nil
	case "agent_paths":
		return agentPaths()
	}
	return nil, fmt.Errorf("unknown command %q", command)
}

// ensureService registers the driver with launchd. Accessibility belongs to a
// process, and a driver started by a shell inherits the shell's identity, so
// its events are dropped: without its own process, `trust` has nothing to
// grant and the privacy pane never lists Dolly. `dolly service start` is
// idempotent, so a second Studio does not disturb a running one.
func (s *Studio) ensureService() {
	if _, err := s.dolly([]string{"service", "start"}); err != nil {
		// An unbundled run has no `dolly` next to it; the onboarding says so.
		return
	}
}

func (s *Studio) quit() {
	s.agents.killAll()
	if s.app != nil {
		s.app.Quit()
	}
}

// text and list read the argument object the way JSON leaves it.
func text(args map[string]any, key string) string {
	value, _ := args[key].(string)
	return value
}

func list(args map[string]any, key string) []string {
	items, _ := args[key].([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		if value, ok := item.(string); ok {
			out = append(out, value)
		}
	}
	return out
}
