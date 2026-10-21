# dolly

Pointer, keyboard and accessibility input for screen recordings on macOS, plus
eased camera moves in post. Built for agents: one JSON object per call, stable
exit codes, and a `--guard` that refuses to touch the wrong app.

```console
$ dolly help
$ dolly front
{"bundle":"com.example.App","command":"front","name":"App","ok":true,"pid":4711}

$ dolly hover 640,420 --guard 4711 --hold 1.4
{"command":"hover","held":1.4,"ms":703,"ok":true,"to":[{"x":640,"y":420}]}

$ dolly drag 300,64 900,540 --guard 4711 --ms 1200 --hold 0.8
$ dolly record 61527 /tmp/take 6 --loops 4
{"command":"record","directory":"/tmp/take","fps":61.2,"frames":367,"ok":true,"seconds":6.0,"window":61527}
```

## Why

Synthetic input is the only way to film hover states and real drag sessions:
`onHover`, tooltips, drop overlays and SwiftUI/AppKit drag targets all need
pointer events that travel. `screencapture -l <windowID>` records one window
without stealing focus, so the same run can be cut into a film afterwards.

## Install

```console
$ ./scripts/install.sh              # builds Dolly.app in ~/Applications and signs it
$ ~/Applications/Dolly.app/Contents/MacOS/dolly trust --prompt
```

Grant it in System Settings → Privacy & Security → Accessibility, then check:

```console
$ ~/Applications/Dolly.app/Contents/MacOS/dolly trust
{"command":"trust","ok":true,"trusted":true}
```

The installer signs with an Apple Development identity when one exists, so the
grant survives rebuilds. Ad-hoc signing works too, but macOS then asks again
after every rebuild — use `DOLLY_SIGN_IDENTITY` to pin an identity.

## Commands

| command | what it does |
| --- | --- |
| `move <x,y>` | move the pointer |
| `path <x,y> <x,y> …` | one eased travel through several points |
| `hover <x,y>` | move, then hold so hover state settles |
| `click <x,y>` | move, press, release (`--button`, `--count`) |
| `drag <x,y> <x,y>` | press, travel while held, release — starts real drag sessions |
| `scroll <dy> [dx]` | wheel at the pointer |
| `key <code>` | virtual key code with `--modifiers cmd,shift,alt,ctrl` |
| `type <text>` | type into the focused control |
| `press <pid> <label>` | AX press by label, for menus and toolbar items |
| `find <pid> <label>` | list matching controls, to aim a press |
| `front` | frontmost app (pid, name, bundle) |
| `windows` | window ids and frames |
| `trust` | Accessibility state, `--prompt` to ask |
| `record <windowID> <dir> <seconds>` | window-only frames for a camera move |

Shared flags: `--guard <pid|bundle|name>` (refuse unless that app is frontmost),
`--ms`, `--ease inOut|out|inQuint|linear`.

Coordinates are global screen points, origin at the main display's top-left.
`dolly windows` gives a window's frame, so a shot can be written as offsets
inside a window and stay valid when the window moves.

Exit codes: `0` ok, `2` usage, `3` refused by guard, `4` Accessibility not
granted, `5` failed. Every call prints one JSON object with `ok`.

## Camera moves

`scripts/camera.py` crops a high-resolution recording along keyframes and
eases between them, so a push-in or pan is a number instead of a timeline.

```console
$ scripts/camera.py --input take.mp4 --out push-in.mp4 \
    --keys 0:1.0:0.5:0.5 0.4:1.0:0.5:0.5 2.6:1.28:0.16:0.34 --strip strip.jpg
{"ok":true,"source":[2560,1600],"ceiling":1.333,"zoom":[1.0,1.0,1.28],"clamped":false,...}
```

`t:zoom:x:y` — `zoom` is the magnification, `x`/`y` the normalised source point
kept at the centre. Beyond `ceiling` (source width ÷ 1920) the image would be
upscaled, so zooms are clamped there and reported. `--strip` writes a five
frame contact strip of the result.

See [`skills/dolly/SKILL.md`](skills/dolly/SKILL.md) for the shot vocabulary
and the recording workflow.

## Extending

`Sources/dolly/Commands.swift` holds one `enum` per verb with a `spec` line; add
the enum, add its `spec` to `Registry.all` in `CLI.swift`, done. Shared
behaviour (travel, easing, guard, trust) lives in `Input.swift` and `CLI.swift`.

## Licence

MIT.
