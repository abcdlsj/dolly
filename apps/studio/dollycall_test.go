package main

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Four windows ask for `trust` while a person flips switches in System
// Settings; that must be one process, not one per window per poll.
func TestConcurrentCallsShareOneProcess(t *testing.T) {
	studio := newStudio()
	var runs atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	studio.runDolly = func(argv []string) (any, error) {
		if runs.Add(1) == 1 {
			close(started)
		}
		<-release
		return map[string]any{"ok": true, "command": argv[0]}, nil
	}

	var wait sync.WaitGroup
	answers := make([]any, 12)
	for i := range answers {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			value, err := studio.dolly([]string{"trust"})
			if err != nil {
				t.Errorf("call %d: %v", i, err)
			}
			answers[i] = value
		}(i)
	}

	<-started
	time.Sleep(20 * time.Millisecond)
	close(release)
	wait.Wait()

	if got := runs.Load(); got != 1 {
		t.Fatalf("started %d processes for 12 calls, want 1", got)
	}
	for i, answer := range answers {
		if answer == nil {
			t.Fatalf("call %d got no answer", i)
		}
	}
}

func TestTrustAnswerIsReusedButOtherVerbsAreNot(t *testing.T) {
	studio := newStudio()
	var runs atomic.Int32
	studio.runDolly = func([]string) (any, error) {
		runs.Add(1)
		return map[string]any{"ok": true}, nil
	}

	for range 3 {
		if _, err := studio.dolly([]string{"trust"}); err != nil {
			t.Fatal(err)
		}
	}
	if got := runs.Load(); got != 1 {
		t.Fatalf("trust ran %d times within its window, want 1", got)
	}

	if _, err := studio.dolly([]string{"windows"}); err != nil {
		t.Fatal(err)
	}
	if _, err := studio.dolly([]string{"windows"}); err != nil {
		t.Fatal(err)
	}
	if got := runs.Load(); got != 2 {
		t.Fatalf("the second windows call reused its answer, want a fresh one (got %d runs)", got)
	}
}
