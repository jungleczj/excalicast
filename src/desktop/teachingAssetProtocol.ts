export const TEACHING_ASSET_SCHEME = 'excalicast-asset';

export interface TeachingAssetIdentity {
  readonly recordingId: string;
  readonly assetId: string;
  readonly assetVersion: string;
  readonly checksum: string;
}

const RECORDING_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const ASSET_ID = /^[a-zA-Z0-9_.-]{1,160}$/;
const ASSET_VERSION = /^[a-zA-Z0-9_.-]{1,80}$/;
const CHECKSUM = /^[a-f0-9]{64}$/;

function validIdentity(value: TeachingAssetIdentity): boolean {
  return RECORDING_ID.test(value.recordingId)
    && ASSET_ID.test(value.assetId)
    && ASSET_VERSION.test(value.assetVersion)
    && CHECKSUM.test(value.checksum);
}

export function teachingAssetUrl(recordingId: string, asset: Omit<TeachingAssetIdentity, 'recordingId'>): string {
  const identity = { recordingId, ...asset };
  if (!validIdentity(identity)) throw new Error('teaching_asset_url_invalid');
  return `${TEACHING_ASSET_SCHEME}://project/${identity.recordingId}/${identity.assetId}/${identity.assetVersion}/${identity.checksum}`;
}

/** Parses a pure asset identity. It intentionally has no field capable of carrying a local pathname. */
export function parseTeachingAssetUrl(value: string): TeachingAssetIdentity {
  // URL normalisation would otherwise erase `..` before the identity check.
  // Asset identities are ASCII-only, so percent encoding is never legitimate.
  if (value.includes('%') || value.includes('/./') || value.includes('/../')) {
    throw new Error('teaching_asset_url_invalid');
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('teaching_asset_url_invalid'); }
  const parts = url.pathname.split('/').filter(Boolean);
  const identity: TeachingAssetIdentity = {
    recordingId: parts[0] ?? '',
    assetId: parts[1] ?? '',
    assetVersion: parts[2] ?? '',
    checksum: parts[3] ?? '',
  };
  if (url.protocol !== `${TEACHING_ASSET_SCHEME}:`
    || url.hostname !== 'project'
    || parts.length !== 4
    || url.search
    || url.hash
    || !validIdentity(identity)) throw new Error('teaching_asset_url_invalid');
  return identity;
}
