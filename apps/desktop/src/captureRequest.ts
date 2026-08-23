import type { NativeCaptureRequest } from './nativeHelperClient';

export function parseDesktopCapturePayload(
  payload: unknown,
  projectRoot: string,
): NativeCaptureRequest {
  if (!payload || typeof payload !== 'object') throw new Error('native_capture_request_invalid');
  const value = payload as Record<string, unknown>;
  const recordingId = typeof value.recordingId === 'string' ? value.recordingId : '';
  const codec = value.codec === 'h264' || value.codec === 'hevc' ? value.codec : null;
  const legacyDisplayID = optionalInteger(value.displayID, 0, 0xffff_ffff);
  const sourceKind = value.sourceKind === 'display' || value.sourceKind === 'window'
    ? value.sourceKind
    : legacyDisplayID !== undefined ? 'display' : null;
  const sourceID = optionalInteger(value.sourceID, 0, 0xffff_ffff) ?? legacyDisplayID;
  const width = requiredInteger(value.width, 16, 7680);
  const height = requiredInteger(value.height, 16, 4320);
  const framesPerSecond = requiredInteger(value.framesPerSecond, 1, 120);

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordingId)
    || !sourceKind
    || sourceID === undefined
    || !codec) {
    throw new Error('native_capture_request_invalid');
  }

  return {
    recordingId,
    projectRoot,
    sourceKind,
    sourceID,
    width,
    height,
    framesPerSecond,
    codec,
    captureSystemAudio: value.captureSystemAudio === true,
    captureMicrophone: value.captureMicrophone === true,
    microphoneDeviceID: optionalDeviceID(value.microphoneDeviceID),
    captureCamera: value.captureCamera === true,
    cameraDeviceID: optionalDeviceID(value.cameraDeviceID),
    cameraWidth: optionalInteger(value.cameraWidth, 320, 3840),
    cameraHeight: optionalInteger(value.cameraHeight, 240, 2160),
    cameraFramesPerSecond: optionalInteger(value.cameraFramesPerSecond, 1, 60),
  };
}

function requiredInteger(value: unknown, minimum: number, maximum: number): number {
  const result = optionalInteger(value, minimum, maximum);
  if (result === undefined) throw new Error('native_capture_request_invalid');
  return result;
}

function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error('native_capture_request_invalid');
  }
  return value as number;
}

function optionalDeviceID(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error('native_capture_request_invalid');
  }
  return value;
}
