package main

// openPermissionSettings opens the System Settings pane the grant lives in,
// asking macOS first so Dolly appears in the list.
func openPermissionSettings(kind string) {
	pane := "Privacy_Accessibility"
	if kind == "screen" {
		askScreenAccess()
		pane = "Privacy_ScreenCapture"
	}
	_ = run("open", "x-apple.systempreferences:com.apple.preference.security?"+pane)
}
