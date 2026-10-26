package main

import (
	"strings"
	"time"
)

// dolly calls Studio makes over and over: the onboarding poll asks for `trust`
// from every window while a person flips switches in System Settings. Each call
// is a process — and, when the driver service is down, a second one — so
// identical calls are folded here: concurrent ones share one answer, and a
// read-only answer is reused for a moment after it returns.
type dollyCall struct {
	done  chan struct{}
	value any
	err   error
	at    time.Time
}

const (
	// A grant only changes when a person toggles it, so its answer keeps.
	trustTTL = 5 * time.Second
	// Anything else is one poll behind at most.
	plainTTL = time.Second
	// A dolly that never answers must not hold every later call behind it.
	dollyTimeout = 30 * time.Second
)

func (s *Studio) dolly(argv []string) (any, error) {
	ttl := plainTTL
	if len(argv) > 0 && argv[0] == "trust" {
		ttl = trustTTL
	}
	key := strings.Join(argv, "\x00")

	s.mu.Lock()
	if s.calls == nil {
		s.calls = map[string]*dollyCall{}
	}
	if call, ok := s.calls[key]; ok {
		select {
		case <-call.done:
			if time.Since(call.at) < ttl {
				s.mu.Unlock()
				return call.value, call.err
			}
		default:
			// Still running: this caller waits for the same answer instead of
			// starting a second process.
			s.mu.Unlock()
			<-call.done
			return call.value, call.err
		}
	}
	call := &dollyCall{done: make(chan struct{})}
	s.calls[key] = call
	s.mu.Unlock()

	call.value, call.err = s.runDolly(argv)
	call.at = time.Now()
	close(call.done)
	return call.value, call.err
}
