// The native half of Studio. It owns what the web view must not: the agent
// processes, the API key in the login keychain, the `dolly` sidecar, the menu
// bar icon and the four windows.

package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// The built frontend and the menu bar icon ride inside the binary.
//
//go:embed all:dist
var assets embed.FS

//go:embed icons/tray.png
var trayIcon []byte

func main() {
	studio := newStudio()

	// macOS keys notifications to an app bundle, so a `go run` shell has none
	// and announces through osascript instead.
	var notifier *notifications.NotificationService
	services := []application.Service{application.NewService(studio)}
	if insideBundle() {
		notifier = notifications.New()
		services = append(services, application.NewService(notifier))
	}

	app := application.New(application.Options{
		Name:        "Dolly",
		Description: "Pointer, keyboard and camera moves for screen recordings",
		Assets: application.AssetOptions{
			Handler:    application.BundledAssetFileServer(assets),
			Middleware: localFiles,
		},
		Mac: application.MacOptions{
			// Closing the last window only hides it; Dolly keeps filming from
			// the menu bar, and a Dock click reopens it.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		Services: services,
	})

	studio.attach(app, notifier)
	studio.openWindows()
	studio.openTray(trayIcon)

	go studio.ensureService()

	app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) {
		studio.showWindow("main")
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
