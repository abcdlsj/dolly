package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"
)

// The driver answers one JSON line per request, the way `dolly` talks to it:
// `{"op": …}` in, `{"ok": true, …}` or `{"ok": false, "code": n, "error": …}`
// back. Studio uses it directly for the live preview, so a frame costs one
// capture instead of one CLI start.
type driver struct {
	path string
}

func driverSocket() string {
	if configured := os.Getenv("DOLLY_SOCKET"); configured != "" {
		return configured
	}
	return filepath.Join(home(), "Library", "Caches", "dolly", "dolly.sock")
}

func (d driver) call(request any) (map[string]any, error) {
	conn, err := net.DialTimeout("unix", d.path, 2*time.Second)
	if err != nil {
		return nil, errors.New("the driver service is not running")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

	body, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Write(append(body, '\n')); err != nil {
		return nil, err
	}

	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil && len(line) == 0 {
		return nil, err
	}
	var response map[string]any
	if err := json.Unmarshal(line, &response); err != nil {
		return nil, fmt.Errorf("the driver answered with something that is not JSON: %s", string(line))
	}
	if ok, _ := response["ok"].(bool); !ok {
		message, _ := response["error"].(string)
		if message == "" {
			message = "the driver refused"
		}
		return nil, errors.New(message)
	}
	return response, nil
}
