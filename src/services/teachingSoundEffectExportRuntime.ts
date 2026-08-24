'use client';

import type { ExportTeachingSoundEffectOptions } from '@/services/exportPipeline';
import { createDesktopTeachingSoundEffectAssetProvider } from '@/services/desktopTeachingSoundEffectAssetProvider';
import { DESKTOP_IPC_CHANNELS } from '@/desktop/productContract';

interface DesktopBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

function bridge(): DesktopBridge | undefined {
  const host = typeof window === 'undefined' ? globalThis : window;
  return (host as typeof globalThis & { excalicastDesktop?: DesktopBridge }).excalicastDesktop;
}

function isReadyExportPayload(value: unknown): value is {
  state: 'ready';
  sourceTracks: ExportTeachingSoundEffectOptions['sourceTracks'];
  operations: ExportTeachingSoundEffectOptions['operations'];
} {
  return !!value && typeof value === 'object'
    && (value as { state?: unknown }).state === 'ready'
    && Array.isArray((value as { sourceTracks?: unknown }).sourceTracks)
    && Array.isArray((value as { operations?: unknown }).operations);
}

function exportState(value: unknown): 'absent' | 'pending' | 'unsupported' | 'failed' | null {
  if (!value || typeof value !== 'object') return null;
  const state = (value as { state?: unknown }).state;
  return state === 'absent' || state === 'pending' || state === 'unsupported' || state === 'failed' ? state : null;
}

/** Reads only a main-validated ready plan; missing plans stay on legacy export. */
export async function resolveDesktopTeachingSoundEffectExportOptions(
  recordingId: string,
): Promise<ExportTeachingSoundEffectOptions | undefined> {
  const desktop = bridge();
  if (!desktop) return undefined;
  const response = await desktop.invoke(DESKTOP_IPC_CHANNELS.projectReadTeachingCompositionExport, { recordingId });
  if (exportState(response) === 'absent') return undefined;
  const state = exportState(response);
  if (state) throw new Error(`teaching_composition_export_${state}`);
  if (!isReadyExportPayload(response)) throw new Error('teaching_composition_export_payload_invalid');
  return {
    sourceTracks: response.sourceTracks,
    operations: response.operations,
    assetProvider: createDesktopTeachingSoundEffectAssetProvider({ recordingId }),
  };
}
