package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Four windows load the same page; the hash says which one it is. The main
// window owns the state, the settings and glance panels float, and the tray is
// the menu bar popover.
func (s *Studio) openWindows() {
	app := s.app

	s.hideOnClose(app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "Dolly",
		Width:     1280,
		Height:    800,
		MinWidth:  900,
		MinHeight: 600,
		URL:       "/",
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarHiddenInset,
			InvisibleTitleBarHeight: 28,
		},
	}))

	s.hideOnClose(app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:          "settings",
		Title:         "Settings",
		Width:         580,
		Height:        600,
		Hidden:        true,
		DisableResize: true,
		URL:           "/#/settings",
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarHiddenInset,
			InvisibleTitleBarHeight: 28,
		},
	}))

	s.hideOnClose(app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:           "glance",
		Title:          "Dolly",
		Width:          300,
		Height:         190,
		Hidden:         true,
		Frameless:      true,
		AlwaysOnTop:    true,
		DisableResize:  true,
		BackgroundType: application.BackgroundTypeTransparent,
		URL:            "/#/glance",
	}))

	tray := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:           "tray",
		Title:          "Dolly",
		Width:          320,
		Height:         560,
		Hidden:         true,
		Frameless:      true,
		AlwaysOnTop:    true,
		DisableResize:  true,
		BackgroundType: application.BackgroundTypeTransparent,
		URL:            "/#/tray",
	})
	s.hideOnClose(tray)
	// The menu bar panel goes away as soon as it stops being the front window.
	tray.RegisterHook(events.Common.WindowLostFocus, func(*application.WindowEvent) {
		tray.Hide()
	})
}

// Closing a window hides it, so a film keeps running with Studio out of sight.
func (s *Studio) hideOnClose(window application.Window) {
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		window.Hide()
		event.Cancel()
	})
}

func (s *Studio) showWindow(label string) {
	window, ok := s.app.Window.GetByName(label)
	if !ok || window == nil {
		return
	}
	if label == "glance" {
		s.placeBottomRight(window)
	}
	window.Show()
	window.Focus()
}

func (s *Studio) hideWindow(label string) {
	if window, ok := s.app.Window.GetByName(label); ok && window != nil {
		window.Hide()
	}
}

// placeBottomRight puts the glance panel in the corner of the screen in use.
func (s *Studio) placeBottomRight(window application.Window) {
	screen := s.app.Screen.GetPrimary()
	if screen == nil {
		return
	}
	width, height := window.Size()
	const margin = 20
	area := screen.WorkArea
	window.SetPosition(area.X+area.Width-width-margin, area.Y+area.Height-height-margin)
}
