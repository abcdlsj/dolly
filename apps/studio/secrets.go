package main

import (
	"bytes"
	"errors"
	"os/exec"
	"strings"
)

// The keychain item the Tauri build created, so a saved key keeps working.
const keychain = "Dolly Studio"

// keyVariable is the environment variable each provider's key goes in.
func keyVariable(provider string) string {
	switch provider {
	case "openai", "custom":
		return "OPENAI_API_KEY"
	case "openrouter":
		return "OPENROUTER_API_KEY"
	default:
		return "ANTHROPIC_API_KEY"
	}
}

// secret reads a provider's key from the login keychain. `security` gets it on
// stdout, so the key never appears in an argument list.
func secret(provider string) (string, bool) {
	out, err := exec.Command("security", "find-generic-password", "-s", keychain, "-a", provider, "-w").Output()
	if err != nil {
		return "", false
	}
	key := strings.TrimSuffix(string(out), "\n")
	return key, key != ""
}

// secretSet stores the key and returns its last four characters for display.
// The key arrives on stdin because `security` prompts for it there twice, and
// nothing in the process table ever holds it.
func secretSet(provider, key string) (string, error) {
	if strings.TrimSpace(key) == "" {
		return "", errors.New("No key")
	}
	cmd := exec.Command("security", "add-generic-password", "-U", "-s", keychain, "-a", provider, "-w")
	cmd.Stdin = strings.NewReader(key + "\n" + key + "\n")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", errors.New(message)
	}
	runes := []rune(key)
	if len(runes) > 4 {
		runes = runes[len(runes)-4:]
	}
	return string(runes), nil
}
