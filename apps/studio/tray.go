package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

// The menu bar icon: a left click drops the tray panel under it, a right click
// offers the same two things macOS people expect.
func (s *Studio) openTray(icon []byte) {
	tray := s.app.SystemTray.New()
	tray.SetTemplateIcon(icon)
	tray.SetTooltip("Dolly")

	menu := s.app.NewMenu()
	menu.Add("Open Dolly").OnClick(func(*application.Context) { s.showWindow("main") })
	menu.Add("Quit Dolly").SetAccelerator("CmdOrCtrl+Q").OnClick(func(*application.Context) { s.quit() })
	tray.SetMenu(menu)

	if trayWindow, ok := s.app.Window.GetByName("tray"); ok && trayWindow != nil {
		tray.AttachWindow(trayWindow).WindowOffset(4)
	}

	s.tray = tray
}

// announce tells the person a film is done or needs an answer while Studio is
// out of sight. Unbundled runs (go run) and refused permission fall back to
// osascript, which still reaches Notification Center.
func (s *Studio) announce(title, body string) {
	if title == "" {
		return
	}
	if s.notify != nil && insideBundle() {
		if allowed, err := s.notify.CheckNotificationAuthorization(); err == nil {
			if !allowed {
				granted, err := s.notify.RequestNotificationAuthorization()
				if err != nil || !granted {
					return
				}
			}
			if err := s.notify.SendNotification(notificationsOptions(title, body)); err == nil {
				return
			}
		}
	}
	script := "display notification " + quote(body) + " with title " + quote(title)
	_ = run("osascript", "-e", script)
}
