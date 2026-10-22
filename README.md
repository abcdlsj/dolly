<img src="assets/icon.svg" width="96" alt="Dolly">

# dolly

Pointer, keyboard and accessibility input for screen recordings on macOS, plus
eased camera moves in post. Built for agents: one JSON object per call, stable
exit codes, and a `--guard` that refuses to touch the wrong app.

```console
$ dolly help | jq -r .text        # help is a JSON object too
$ dolly service start             # macOS grants Accessibility per process
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
$ ~/Applications/Dolly.app/Contents/MacOS/dolly trust --prompt   # grant it, once
$ ~/Applications/Dolly.app/Contents/MacOS/dolly service start
```

The installer signs with an Apple Development identity when one exists, so the
grant survives rebuilds. Ad-hoc signing works too, but macOS then asks again
after every rebuild — use `DOLLY_SIGN_IDENTITY` to pin an identity.

## Why a service

Accessibility belongs to a process. A dolly started by a shell inherits the
shell's identity, and if the shell is not trusted its events are dropped
silently — `dolly trust` reports `false` and every verb refuses with exit 4.
`dolly service start` registers this binary with launchd, which makes dolly its
own responsible process; every later call, from any shell, is forwarded over a
UNIX socket to that one process. `dolly service status` shows it, `dolly
service stop` ends it, and `DOLLY_LOCAL=1` forces a direct run.

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
| `service start\|stop\|status` | the launchd-hosted input service |
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
{"ok":true,"source":[2560,1600],"ceiling":1.481,"zoom":[1.0,1.0,1.28],"clamped":false,...}
```

`t:zoom:x:y[:ease]` — `zoom` is the magnification, `x`/`y` the normalised point
of the window kept at the centre. The camera follows a monotone spline through
the keyframes (zoom eases by ratio, so a push-in looks even), and a move through several
keyframes never stalls on the middle ones. The window is first padded
(`--fit pad`, default) or cropped (`--fit crop`) to the output aspect
(`--aspect 16:9`, `9:16`, `1:1`, `4:5`); beyond `ceiling` (that canvas's width
÷ output width) the image would be upscaled, so zooms are clamped there and
reported. `--strip` writes a five frame contact strip of the result.

Named moves save the arithmetic. A shot file lists beats — `focus` on a
control's rect, `pan-to`, `punch-in`, `drift`, `tour`, `pull-back` — and
`--explain` prints the keyframes they expand to, with warnings for moves that
start too early, run too fast or hit the ceiling:

```console
$ scripts/camera.py --shot shot.json --explain
{"ok":true,"keys":["0.000:1.000:0.500:0.500:spline",...],"peak_pan":0.21,"warnings":[]}
$ scripts/camera.py --shot shot.json --strip strip.jpg
```

`python3 -m unittest discover tests` renders synthetic takes of several window
shapes and checks size, frame count and where the camera lands (needs ffmpeg).

See [`skills/dolly/SKILL.md`](skills/dolly/SKILL.md) for the shot vocabulary
and the recording workflow.

## TypeScript core

dolly is moving to a TypeScript core with a thin native driver per platform.
`packages/core` holds everything dolly computes, with no IO: eases, the camera
spline, canvas and ceiling, named moves, `--explain` review, the ffmpeg graph,
and pointer travel (a list of timed samples a driver plays back, so every
platform moves the pointer along the same curve). `packages/cli` holds the
commands that do IO; `dolly-camera` is the successor of `scripts/camera.py`
and takes the same flags (`--dry-run` prints `{"ok":true,"filter":…}`).

```console
$ bun install
$ bun test                       # core, golden plans and ffmpeg renders
$ bun run typecheck
$ bun packages/cli/src/camera.ts --shot shot.json --explain
```

`packages/core/test/fixtures/golden.json` was recorded from `scripts/camera.py`;
the core must reproduce its keyframes, warnings and filter graph exactly.
`scripts/camera.py`, `site/js/camera.js` and the Swift travel loop move onto the
core in follow-up changes.

## Extending

`Sources/dolly/Commands.swift` holds one `enum` per verb with a `spec` line; add
the enum, add its `spec` to `Registry.all` in `CLI.swift`, done. Shared
behaviour (travel, easing, guard, trust) lives in `Input.swift` and `CLI.swift`.

## Icon

`assets/` holds the mark: `icon.svg` (full bleed), `icon-dark.svg`,
`icon-small.svg` (simplified for 32 px and below) and `AppIcon.svg` on the
macOS 1024/824 grid, which `AppIcon.icns` is rendered from.

## Site

`site/` is a static onboarding page — no build, no dependencies. Open
`site/index.html`, or serve it with `python3 -m http.server -d site`. Its
animations are canvas: `site/js/camera.js` ports the camera planner from
`scripts/camera.py` (eases, spline, padding, ceiling, named moves and the
`--explain` checks), so the moves it shows are the moves `camera.py` renders.
`tests/test_site_camera.py` checks the two plan the same shots (needs node).

## Licence

MIT.
