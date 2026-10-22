---
name: dolly
description: Use when filming a macOS app — driving real pointer hovers, drag-and-drop and keyboard input while recording one window, and cutting eased push-ins, pans and pull-backs over the raw take.
---

# Filming a macOS app with dolly

`dolly` posts real HID events on an eased clock and copies frames out of one
window without stealing focus. `scripts/camera.py` turns the raw take into
camera moves. Together they replace a static screen recording with a shot that
moves.

## Before the first input

0. `dolly service start` once per machine — Accessibility is per process, and a
   dolly launched by an untrusted shell cannot post events. `dolly service
   status` confirms it answers.
1. `dolly front` — read the pid, name and bundle of what the user is looking at.
2. Pass `--guard <pid>` on **every** input verb. Without it a stray move can
   click the user's own window; with it the call refuses (exit 3) instead.
3. `dolly trust` must report `true`. If not, Accessibility is missing: exit 4,
   nothing was posted.
4. `dolly windows --pid <pid>` — take the window id and its frame. Write every
   coordinate as an offset inside that frame, so a moved window does not
   invalidate the script.

Never film the user's live app: start an isolated copy of the app (own config,
own port, own data directory) and film that one.

## Exploring an app you have not seen

```console
$ dolly launch <App.app|bundle id> --isolated --size 1440,900   # own profile, waits for the window
$ dolly snap --pid <pid> look.png                               # read look.png to see the window
$ dolly tree <pid>                                              # every control: role, title, center, rect
$ dolly quit <pid>
```

- Work from `tree`, not from guessing pixels: `center` is the screen point to
  hover or click, `rect` goes straight into a `focus` beat.
- After every action that should change the window, `snap` again and look.
- `snap` reports `scale`; a pixel `(px, py)` in the image is screen point
  `(frame.x + px / scale, frame.y + py / scale)`.
- `launch` warns when an app is sandboxed: then `--isolated` cannot move its
  data, so do not create or delete anything the user would miss.

## Recording a take

```console
$ dolly record <windowID> /tmp/take 8 --loops 4
```

Frames land as `<millisecond>.png`; four loops reach ~60 fps, enough to slow
down a moment to a third of its speed afterwards. Plan the take as one pass:

| beat | call |
| --- | --- |
| open the shot | hold still 0.4 s so the cut has a clean entry frame |
| travel to the first target | `dolly move` / `dolly path`, `--ms 600..1200`, `--ease inOut` |
| hover a row | `dolly hover --hold 1.2` — the hold is what makes a hover plate visible |
| drag something | `dolly drag … --ms 1100 --hold 0.7` — the hold keeps the drop overlay on screen |
| switch tabs / press a control | `dolly press <pid> "<label>"` (AX) or `dolly click` |
| leave the shot | hold still 0.4 s |

To aim camera moves at what happened, log the take:

```console
$ dolly events start /tmp/take/events.jsonl
$ dolly capture <windowID> /tmp/take/take.mov 8 &    # records while you drive it
$ dolly hover … ; dolly drag … ; …
$ dolly events stop      # beats: verb, at/until in seconds of the take, point in window fractions
```

Use each beat's `at` and `point` for the shot file's beats: start a `focus` on
the `at` of the hover it explains.

Pace: one beat per 1.5–3 s of finished film. Two beats inside a second reads as
a glitch, and five seconds of one static frame reads as a crash.

## Camera moves

Camera moves are post, never zoomed UI: crop a 2x take, ease the crop, keep the
text at native resolution.

Write a shot as named moves in a shot file and let `camera.py` turn them into
keyframes. Coordinates are window-normalised (0..1), `rect` is `[x, y, w, h]`.

| move | what it does | fields (defaults) |
| --- | --- | --- |
| `hold` | stay put | `for` (0.5) |
| `focus` | push in on a control; with `rect` the zoom is chosen so it fills `fill` of the frame | `rect` or `point`, `fill` (0.5), `zoom`, `for` (1.8) |
| `frame` | re-frame: zoom and centre move together | `point`/`rect`, `zoom` (1.28), `for` (1.6) |
| `pan-to` | keep the zoom, move the centre | `point`/`rect`, `for` (1.4) |
| `pull-back` | back to the whole window | `for` (1.6) |
| `punch-in` | a short emphasis push with a small overshoot | `amount` (1.12), `point`, `for` (0.35), ease `back` |
| `drift` | a slow linear creep on a long static beat | `amount` (1.04), `for` (until the next beat) |
| `tour` | visit several points without stopping between holds | `stops`, `zoom`, `travel` (1.2), `hold` (0.8) |

Every beat takes `at` — seconds, `"+0.6"` after the previous beat, or
`"end-2"` from the end of the take; left out, it follows the previous beat
directly. Any beat may set `ease`: `spline` (default), `smooth`, `out`, `in`,
`linear`, `back`.

```json
{
  "source": "take.mov",
  "out": "film.mp4",
  "output": { "aspect": "16:9", "fit": "pad" },
  "beats": [
    { "move": "hold", "for": 0.4 },
    { "move": "focus", "rect": [0.08, 0.2, 0.22, 0.06], "fill": 0.45 },
    { "move": "pan-to", "at": "+0.8", "point": [0.6, 0.3] },
    { "move": "pull-back", "at": "end-2" }
  ]
}
```

```console
$ scripts/camera.py --shot shot.json --explain   # keyframes, peak speeds, warnings — no render
$ scripts/camera.py --shot shot.json --strip strip.jpg
```

Run `--explain` first and fix every warning: it checks the stillness at both
ends, beats closer than 1.5 s, pans faster than 0.8 frame widths a second, and
zooms clamped at the ceiling. Raw keyframes still work for anything the moves
do not cover: `--keys t:zoom:x:y[:ease]`.

Rules:

- **Ceiling.** `camera.py` brings the window onto a canvas of the output aspect
  (`--fit pad` letterboxes, `--fit crop` trims) and reports `ceiling` = canvas
  width ÷ output width; for 16:9:
  a 2x capture of a 1280×800 window gives 1.481 padded, 1.333 cropped. Asking
  for more clamps and says so; text beyond it goes soft. A window under 960 pt
  wide reports `upscaled` and only renders at zoom 1. Need a deeper push?
  record a bigger window, not a bigger zoom.
- **Ease everything.** The default spline starts and stops softly and glides
  through keyframes in between; repeat a keyframe to stop there. A linear move
  reads as a cut — keep `linear` for `drift`. Never start a move on the first frame of a cut and never
  end one on the last — leave 0.3–0.6 s of stillness at both ends.
- **Move with the content, not instead of it.** Start the push-in on the frame
  the hover appears, so the move explains the change.
- **One move per beat.** A zoom and a pan at once look like a mistake.
- **Anchor the subject.** `x`,`y` is the point that stays in the middle; aim it
  at the label or row the voice-over names, not the window's centre.

- **Other formats.** `--aspect 9:16` (or `"output": {"aspect": "9:16"}`)
  renders a vertical cut for social posts; `1:1` and `4:5` work the same way,
  short side 1080.

Check the strip before trusting the move: five frames, evenly spaced, showing
the start, the travel and the landing.

## Cutting

- Convert a take to a clip: `mkclip`-style concat of the timestamped frames at
  30 fps, optionally slowed (`speed < 1`) so a fast pointer becomes readable.
- Hard cut between shots; fades only at the very start and the very end.
- Build a contact sheet of the finished cut (one frame per shot) and look at
  it: identical adjacent frames mean a shot is missing, a blur means a move is
  too fast.

## Adding a verb

`Sources/dolly/Commands.swift`: one `enum` with `name`, `summary`, `usage`,
`spec` and `run`, then add `<Verb>.spec` to `Registry.all` in `CLI.swift`.
Reuse `Travel` for anything that moves and `Shared.guardFront` for anything
that types or clicks.
