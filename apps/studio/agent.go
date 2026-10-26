package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// agents runs one `pi --mode rpc` per film and tells the windows what it says.
type agents struct {
	mu      sync.Mutex
	writing sync.Mutex
	byID    map[string]*agent
	gen     atomic.Uint64
	app     *application.App
}

type agent struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	// generation tells a restarted film's new agent from the one it replaced.
	generation uint64
}

type lineEvent struct {
	ID   string `json:"id"`
	Line string `json:"line"`
}

type exitEvent struct {
	ID     string `json:"id"`
	Code   *int   `json:"code"`
	Stderr string `json:"stderr"`
}

func newAgents() *agents {
	return &agents{byID: map[string]*agent{}}
}

func (a *agents) start(app *application.App, id string, args []string, provider, endpoint, model string) error {
	a.app = app
	path := searchPath()
	pi := findOnPath(path, "pi")
	if pi == "" {
		return errors.New("pi is not installed. Install it with: npm install -g @earendil-works/pi-coding-agent")
	}

	cmd := exec.Command(pi, args...)
	cmd.Env = append(os.Environ(), "PATH="+path)

	key, hasKey := secret(provider)
	switch base := strings.TrimSpace(endpoint); {
	case base != "" && !hasKey:
		return errors.New("No key yet")
	case base != "":
		// An OpenAI-compatible address is described to pi the way pi describes
		// any endpoint it does not know: a provider in models.json. It lives in
		// the app's own agent directory, so the person's ~/.pi stays untouched.
		chosen := strings.TrimSpace(model)
		if chosen == "" || chosen == "Recommended" {
			return errors.New("Set a model for this address")
		}
		dir := filepath.Join(appDataDir(), "agent")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		config := map[string]any{
			"$schema": "https://pi.dev/schemas/models.schema.json",
			"providers": map[string]any{
				"dolly": map[string]any{
					"baseUrl": base,
					"api":     "openai-completions",
					"apiKey":  "$DOLLY_API_KEY",
					"models":  []any{map[string]any{"id": chosen}},
				},
			},
		}
		body, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "models.json"), body, 0o644); err != nil {
			return err
		}
		cmd.Env = append(cmd.Env, "PI_CODING_AGENT_DIR="+dir, "DOLLY_API_KEY="+key)
	default:
		if hasKey {
			cmd.Env = append(cmd.Env, keyVariable(provider)+"="+key)
		}
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start pi: %w", err)
	}

	a.mu.Lock()
	if old, ok := a.byID[id]; ok && old.cmd.Process != nil {
		_ = old.cmd.Process.Kill()
	}
	generation := a.gen.Add(1)
	a.byID[id] = &agent{cmd: cmd, stdin: stdin, generation: generation}
	a.mu.Unlock()

	go a.pump(id, generation, cmd, stdout, stderr)
	return nil
}

// pump reads pi's two streams: records go to the windows, and whatever it
// printed on stderr explains a death that happened before its first turn.
func (a *agents) pump(id string, generation uint64, cmd *exec.Cmd, stdout, stderr io.Reader) {
	var printed strings.Builder
	var lock sync.Mutex
	closed := make(chan struct{})

	go func() {
		defer close(closed)
		reader := bufio.NewReader(stderr)
		for {
			line, err := readRecord(reader)
			if line != "" {
				lock.Lock()
				printed.WriteString(line)
				printed.WriteString("\n")
				lock.Unlock()
			}
			if err != nil {
				return
			}
		}
	}()

	reader := bufio.NewReaderSize(stdout, 1<<16)
	for {
		line, err := readRecord(reader)
		if line != "" {
			a.emit("pi-line", lineEvent{ID: id, Line: line})
		}
		if err != nil {
			break
		}
	}
	<-closed

	// An agent replaced by a restart exits quietly, so the new one keeps its listeners.
	a.mu.Lock()
	current, ok := a.byID[id]
	running := ok && current.generation == generation
	if running {
		delete(a.byID, id)
	}
	a.mu.Unlock()
	if !running {
		return
	}

	_ = cmd.Wait()
	lock.Lock()
	tail := printed.String()
	lock.Unlock()
	a.emit("pi-exit", exitEvent{ID: id, Code: exitCode(cmd), Stderr: tail})
}

func (a *agents) emit(name string, payload any) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit(name, payload)
}

func (a *agents) send(id, line string) error {
	a.mu.Lock()
	running, ok := a.byID[id]
	a.mu.Unlock()
	if !ok {
		return errors.New("that film has no agent running")
	}
	line = strings.TrimSuffix(line, "\n")
	a.writing.Lock()
	defer a.writing.Unlock()
	_, err := io.WriteString(running.stdin, line+"\n")
	return err
}

func (a *agents) kill(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if running, ok := a.byID[id]; ok && running.cmd.Process != nil {
		_ = running.cmd.Process.Kill()
	}
}

func (a *agents) killAll() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, running := range a.byID {
		if running.cmd.Process != nil {
			_ = running.cmd.Process.Kill()
		}
	}
}

// readRecord reads up to the next "\n". Only "\n" ends a record (U+2028 is legal
// inside a JSON string) and a trailing "\r" is dropped.
func readRecord(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	line = strings.TrimSuffix(line, "\n")
	line = strings.TrimSuffix(line, "\r")
	return line, err
}

// exitCode is nil when a signal ended pi: the frontend shows no code at all.
func exitCode(cmd *exec.Cmd) *int {
	if cmd.ProcessState == nil {
		return nil
	}
	if code := cmd.ProcessState.ExitCode(); code >= 0 {
		return &code
	}
	return nil
}

// agentPaths is what pi needs to find its skill, Studio's extension and the
// folder each film's session belongs to.
func agentPaths() (map[string]string, error) {
	sessions := filepath.Join(appDataDir(), "sessions")
	if err := os.MkdirAll(sessions, 0o755); err != nil {
		return nil, err
	}
	resources := resourceDir()
	return map[string]string{
		"skill":     filepath.Join(resources, "skills", "dolly"),
		"extension": filepath.Join(resources, "agent", "studio-extension.ts"),
		"sessions":  sessions,
	}, nil
}
