package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A live view of the app being filmed: the driver captures one window, Studio
// overwrites a single PNG, and the web view reloads it. A capture is native, so
// a frame costs about as much as a screenshot rather than a process.
const (
	frameEvery = 400 * time.Millisecond
	frameMax   = 900
)

type liveView struct {
	mu     sync.Mutex
	stop   chan struct{}
	pid    int
	window int
	file   string
}

// liveStart watches the app at `app` and returns where its frames land.
func (s *Studio) liveStart(app string) (map[string]any, error) {
	s.liveStop()

	pids := pidsForApp(app)
	if len(pids) == 0 {
		return nil, errors.New("that app is not running")
	}
	// An app can be several processes; the one with a window is the one to watch.
	for _, pid := range pids {
		window := frontWindow(pid)
		if window == 0 {
			continue
		}
		view := &liveView{stop: make(chan struct{}), pid: pid, window: window, file: filepath.Join(os.TempDir(), fmt.Sprintf("dolly-live-%d.png", pid))}
		s.mu.Lock()
		s.live = view
		s.mu.Unlock()

		go view.run(driver{path: driverSocket()})
		return map[string]any{"pid": pid, "window": window, "path": view.file}, nil
	}
	return nil, errors.New("that app has no window on screen")
}

func (s *Studio) liveStop() {
	s.mu.Lock()
	view := s.live
	s.live = nil
	s.mu.Unlock()
	if view != nil {
		view.close()
	}
}

func (view *liveView) close() {
	select {
	case <-view.stop:
	default:
		close(view.stop)
	}
}

func (view *liveView) stopped() bool {
	select {
	case <-view.stop:
		return true
	default:
		return false
	}
}

// run keeps the PNG fresh, and looks for a new window when the app is relaunched.
func (view *liveView) run(d driver) {
	ticker := time.NewTicker(frameEvery)
	defer ticker.Stop()
	for {
		if _, err := d.call(map[string]any{"op": "still", "window": view.window, "file": view.file, "max": frameMax}); err != nil {
			// The window can close while the film goes on; a new one is the same app.
			if window := frontWindow(view.pid); window != 0 {
				view.window = window
			}
		}
		select {
		case <-view.stop:
			return
		case <-ticker.C:
		}
	}
}

// pidsForApp finds the processes whose executable is the app's own, which is
// how a bundle launched long before the film is recognised. The one macOS
// started without arguments comes first; its helpers follow.
func pidsForApp(app string) []int {
	app = expand(strings.TrimSuffix(app, "/"))
	executable, ok := bundleExecutable(app)
	if !ok {
		return nil
	}
	path := filepath.Join(app, "Contents", "MacOS", executable)

	out, err := exec.Command("ps", "-Ao", "pid=,command=").Output()
	if err != nil {
		return nil
	}
	var plain, helpers []int
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 || fields[1] != path {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		if len(fields) == 2 {
			plain = append(plain, pid)
		} else {
			helpers = append(helpers, pid)
		}
	}
	return append(plain, helpers...)
}

// frontWindow is the app's frontmost window on screen, or 0.
func frontWindow(pid int) int {
	response, err := driver{path: driverSocket()}.call(map[string]any{"op": "windows", "pid": pid, "layer": 0})
	if err != nil {
		return 0
	}
	windows, _ := response["windows"].([]any)
	for _, entry := range windows {
		window, _ := entry.(map[string]any)
		if onScreen, _ := window["onScreen"].(bool); !onScreen {
			continue
		}
		if id, ok := window["id"].(float64); ok {
			return int(id)
		}
	}
	return 0
}
