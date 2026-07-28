'use client';

const DEFAULT_STOP_TIMEOUT_MS = 3000;
const INACTIVE_WITHOUT_STOP_EVENT_GRACE_MS = 1800;

/**
 * MediaRecorder stop is not perfectly reliable across capture sources:
 * tracks can end before our UI Stop click, browsers can throw while racing to
 * inactive, and some implementations fail to dispatch a final stop event.
 *
 * Never let one recorder strand the whole Excalicast recording in
 * "Finishing recording…". We request a final chunk, wait for stop when it
 * arrives, and then continue after a short timeout.
 */
export async function stopMediaRecorderSafely(
  recorder: MediaRecorder,
  timeoutMs = DEFAULT_STOP_TIMEOUT_MS,
): Promise<void> {
  if (recorder.state === 'inactive') return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let inactiveFallback: number | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (inactiveFallback !== null) window.clearTimeout(inactiveFallback);
      recorder.removeEventListener('stop', finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    recorder.addEventListener('stop', finish, { once: true });

    try { recorder.requestData(); } catch { /* some recorders reject late requestData */ }
    try {
      recorder.stop();
      // Some browser/display-source combinations transition the recorder to
      // inactive but never dispatch the final "stop" event. Once inactive,
      // no more recording work can be requested from this recorder; keep a
      // short grace period for late final dataavailable callbacks, then let
      // the app leave "Finishing recording…" instead of waiting for the full
      // stop timeout on every media track.
      if (recorder.state === 'inactive') {
        inactiveFallback = window.setTimeout(finish, INACTIVE_WITHOUT_STOP_EVENT_GRACE_MS);
      }
    } catch {
      finish();
    }
  });
}
