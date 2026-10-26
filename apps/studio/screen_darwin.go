//go:build darwin

package main

/*
#cgo LDFLAGS: -framework CoreGraphics
#include <CoreGraphics/CoreGraphics.h>
*/
import "C"

// screenAccess reports whether macOS lets this app record the screen. Screen
// Recording is checked against the binary itself, so a rebuild can turn this
// false while Accessibility still holds.
func screenAccess() bool {
	return bool(C.CGPreflightScreenCaptureAccess())
}

// askScreenAccess shows macOS's Screen Recording dialog. macOS asks once per
// app; System Settings is where it is switched on afterwards.
func askScreenAccess() {
	C.CGRequestScreenCaptureAccess()
}
