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

Pace: one beat per 1.5–3 s of finished film. Two beats inside a second reads as
a glitch, and five seconds of one static frame reads as a crash.

## Camera moves

Camera moves are post, never zoomed UI: crop a 2x take, ease the crop, keep the
text at native resolution.

Vocabulary, with numbers that hold up:

| move | keyframes | note |
| --- | --- | --- |
| push in | `0:1.0:0.5:0.5` → `2.4:1.28:0.3:0.42` | 1.5–2.5 s, ends on the detail |
| hold | same values twice, ~0.5 s apart | a beat inside the move |
| pan | zoom fixed, `x`/`y` change 0.2–0.4 | 1.2–2.0 s |
| pull back | reverse of a push-in | lands on the whole window |
| re-frame | `zoom` and centre move together | only when the beat changes |

Rules:

- **Ceiling.** `camera.py` reports `ceiling` = source width ÷ 1920 (1.333 for a
  2x capture of a 1280-wide window). Asking for more clamps and says so; text
  beyond it goes soft. Need a deeper push? record a bigger window, not a
  bigger zoom.
- **Ease everything.** smoothstep is the default and the right one; a linear
  move reads as a cut. Never start a move on the first frame of a cut and never
  end one on the last — leave 0.3–0.6 s of stillness at both ends.
- **Move with the content, not instead of it.** Start the push-in on the frame
  the hover appears, so the move explains the change.
- **One move per beat.** A zoom and a pan at once look like a mistake.
- **Anchor the subject.** `x`,`y` is the point that stays in the middle; aim it
  at the label or row the voice-over names, not the window's centre.

```console
$ scripts/camera.py --input take.mp4 --out push-in.mp4 \
    --keys 0:1.0:0.5:0.5 0.5:1.02:0.42:0.5 2.8:1.28:0.2:0.4 --strip strip.jpg
```

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
