# Recording Controls Product Audit — 2026-07-27

## Summary

The current product has three visually adjacent recording entry points, but they should not be treated as three independent “record” buttons.

They are three states in one funnel:

1. **New recording entry** — create intent and open setup.
2. **Setup confirmation** — choose source, ratio, camera, mic, and background.
3. **Framing start bar** — after permissions and preview are ready, start countdown and recording.

The redundancy users feel comes from copy and visual emphasis, not from the underlying need for the states.

## Current relationship

| Surface | Product role | User mental model risk | Recommended role |
|---|---|---|---|
| Whiteboard / app primary button | Entry into the recording flow | Looks like it should immediately record | Rename/position as **New recording** or **Create recording** |
| New recording modal primary button | Configuration confirmation | If named “Start recording”, it duplicates the framing bar | Use **Next: framing** / **Continue** |
| Floating start bar | Final armed state before recording | Necessary because user still has to position crop/camera | Keep as the only place that says **Start countdown** or **Start recording** |
| Live recording bar | Runtime controls | Should never be understood as an entry button | Keep REC / pause / stop / mic / camera / zoom / notes |

## Why the framing/start bar should still exist

The setup modal cannot safely replace the start bar because several things happen after setup:

- display source permission may open the browser picker;
- selected area users need to adjust crop;
- camera users need to place the bubble;
- mic level needs a quick readiness check;
- desktop/window users need the controls moved outside the captured surface before countdown.

If the modal directly starts recording, users lose the chance to inspect what will be captured.

The start bar should therefore stay, but it must not look like a separate product surface. It should visually read as the **armed state** of the recording bar:

- same black pill language as the live recording bar;
- no explanatory helper sentence in the detached PiP window;
- only readiness, mic level, cancel, and “Start countdown”;
- for desktop/window sources, rendered in the detached host whenever possible so it cannot be captured.

## Recommended UX model

Use a three-step vocabulary:

1. **New recording**  
   Entry button. Opens setup.

2. **Prepare**  
   Setup modal. User chooses source, ratio, camera, mic, background.

3. **Start countdown**  
   Floating bar. Final confirmation after preview/framing is ready.

This makes the flow read as:

> New recording → Prepare → Start countdown → REC / Pause / Stop

## Template entry recommendation

Do not put “Start from a template” as a large separate empty-state line in the center of the whiteboard. It competes with recording.

Recommended hierarchy:

- Keep the template icon in the recording/start controls.
- In the empty canvas, show a subtle helper row:
  - “Start blank”
  - “Use a template”
  - “Import image”
- If space is tight, keep only the template icon in the control bar and add a one-time coachmark pointing to it:
  - Chinese: `也可以先从模板开始`
  - English: `You can start from a template`

## Display-source rule

For `desktop` and `window` sources, controls and camera preview must leave the captured page before recording starts.

Implementation direction:

- Use Document PiP / popup controls when available.
- Hide in-page camera bubble, source preview, crop aids, and recording controls before `MediaRecorder.start()`.
- Keep the separate camera stream for export composition, but prevent the page bubble from being embedded in `screenBlob`.

This avoids the “two cameras in preview” problem without disabling the legitimate camera overlay for real desktop recordings.

## PiP dock rule

When the detached control host auto-collapses, it must remain useful rather than becoming a passive REC badge:

- keep REC / elapsed time visible;
- keep Pause or Resume visible;
- keep Stop visible;
- do not show browser-minimum-size explanatory text in the UI;
- shrink-wrap the host to the measured content height as tightly as the browser allows.

## Copy recommendations

| Old / risky copy | Better copy |
|---|---|
| 开始录制 | 新建录制 |
| Start recording | New recording |
| 下一步：取景 | 下一步：取景 |
| Start from a template | Template icon + coachmark |
| 开始倒计时 | 开始倒计时 |
| REC | REC |

## Acceptance criteria

- Only the final armed bar uses “开始倒计时 / Start countdown”.
- The setup modal does not imply recording has already started.
- Desktop/window recording never exposes in-page controls in the captured surface.
- PiP docked state keeps REC, pause, and stop visible.
- The start/framing bar uses the same black pill language as the recording bar.
