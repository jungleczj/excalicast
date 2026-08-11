# Web Key-Point Drawer Motion Design

## Goal

Replace the existing key-point cards with editorial chapter and key-point drawers that are generated from captions, editable on the timeline, deterministic in preview/export, and concise enough to support rather than repeat the narration.

## Editorial model

- Chapter openings use `chapter_drawer` (visual B): a chapter title plus up to two supporting key points.
- Meaningful moments inside a chapter use `key_points_drawer` (visual C): two to four short key-point lines.
- Chinese key points must contain 2-5 Han characters after punctuation and spaces are removed. English key points use 1-4 words and at most 28 visible characters.
- Chapter titles may use 2-8 Chinese characters or 1-6 English words.
- Key points must summarize meaning, not copy a full caption sentence. Filler, punctuation-only text, duplicate phrases, and unsupported claims are rejected.
- Generated timing references source caption indices so every motion can be traced back to its evidence.

## Visual behavior

- Left/right drawers cover the full video-frame height; top/bottom drawers cover the full width.
- The edge nearest the drawer is semi-transparent black and fades to transparent toward the video center.
- A drawer enters from its placement edge and exits back toward that same edge. A right drawer therefore never enters from the left.
- Each visible line is tokenized into words. Tokens rise from below with opacity and vertical offset, staggered in reading order. The animation is driven only by media time.
- Chapter and key-point drawers share one visual language. The distinction is hierarchy and content density, not a different card treatment.
- Placement remains editable. `auto` resolves deterministically and avoids the right edge when the camera reserves it; bottom remains manual-first because captions normally occupy that area.

## Generation

- A new authenticated Pro API accepts caption cues, duration, and locale; no audio or video is uploaded.
- DeepSeek JSON mode receives a stable system prompt, an explicit output example, strict brevity rules, chapter-boundary rules, and evidence-cue requirements.
- The server validates JSON, time ranges, cue references, phrase lengths, duplicates, and overlaps before returning flattened `KeyPointMotionSegment[]`.
- If the remote request is unavailable, the existing local path remains available but generates short phrases rather than copying caption sentences. The UI identifies local fallback results.

## Compatibility

- New segments use schema version 2 and `chapter_drawer | key_points_drawer`.
- Existing schema version 1 values map to the nearest drawer behavior when loaded or persisted: `chapter_title -> chapter_drawer`; `side_card | lower_third -> key_points_drawer`.
- Preview, WebCodecs export, and ffmpeg-compatible composition continue to call one shared renderer.

## Acceptance

- A right-side B or C segment enters from the right and covers the entire frame height with no card background.
- Every line appears word by word from below; seeking to the same media time produces the same pixels.
- Chapter openings use B and interior moments use C.
- No generated Chinese key point exceeds five characters or contains a full subtitle sentence.
- Existing recordings keep their key-point track after upgrade.

