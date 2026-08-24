import { expect, test } from '@playwright/test';
import {
  hasDesktopDirectorProgress,
  resolveDesktopDirectorPhase,
} from '../../src/components/DesktopDirectorProgress';
import type { DesktopDirectorJobStatus } from '../../src/desktop/productContract';

function director(status: DesktopDirectorJobStatus['status']): DesktopDirectorJobStatus {
  const checkpoint = status === 'ready' ? {
    owner: 'recording-manifest' as const,
    reference: 'director/current.json' as const,
    checkpointId: `director-${'a'.repeat(64)}`,
  } : undefined;
  return {
    recordingId: 'lesson-phase-matrix',
    status,
    code: status === 'failed' ? 'director_generation_failed' : `director_job_${status}`,
    retryable: status === 'failed',
    ...(checkpoint ? { checkpoint } : {}),
    evidence: {
      profile: 'Balanced', speechActivity: 'unavailable', speechIntervalCount: 0,
      preservedMedia: true, recoveredCheckpoint: false,
    },
  };
}

test('Director phase never reports ready while a verified Director job is failed, pending, or generating', () => {
  expect(resolveDesktopDirectorPhase('ready', director('failed'))).toBe('failed');
  expect(resolveDesktopDirectorPhase('ready', director('pending'))).toBe('pending');
  expect(resolveDesktopDirectorPhase('ready', director('generating'))).toBe('generating');
  expect(resolveDesktopDirectorPhase('ready', director('ready'))).toBe('ready');
  expect(resolveDesktopDirectorPhase('ready', undefined)).toBe('ready');
});

test('Director phase keeps composition pending until both analysis and placement agree', () => {
  expect(resolveDesktopDirectorPhase('error', director('ready'))).toBe('failed');
  expect(resolveDesktopDirectorPhase('pending', director('ready'))).toBe('generating');
  expect(resolveDesktopDirectorPhase(undefined, director('ready'))).toBe('generating');
  expect(resolveDesktopDirectorPhase('pending', director('pending'))).toBe('pending');
  expect(resolveDesktopDirectorPhase(undefined, undefined)).toBe('unknown');
});

test('Director phase distinguishes verified native composition unsupported and failed states', () => {
  expect(resolveDesktopDirectorPhase('error', director('ready'), {
    status: 'unsupported', code: 'teaching_composition_unsupported_capability',
  })).toBe('unsupported');
  expect(resolveDesktopDirectorPhase('error', director('ready'), {
    status: 'failed', code: 'teaching_composition_probe_error', retryable: true,
  })).toBe('failed');
  expect(resolveDesktopDirectorPhase('pending', director('generating'), { status: 'generating' })).toBe('generating');
  expect(resolveDesktopDirectorPhase('pending', director('ready'), { status: 'pending' })).toBe('pending');
  expect(resolveDesktopDirectorPhase('ready', director('ready'), {
    status: 'ready',
    sourceTracks: [{ trackId: 'screen', kind: 'screen' }],
    operations: [{
      operationId: 'teaching:sound-effect:0000:pop', operation: 'mix-sound-effect', track: 'sound-effect',
      asset: {
        assetId: 'pop', kind: 'sound-effect', catalogVersion: 'catalog-v1', assetVersion: '1',
        checksumAlgorithm: 'sha256', checksum: 'a'.repeat(64), localUri: 'file:///tmp/pop.wav',
      },
      startMs: 0, endMs: 100,
      trim: { sourceStartMs: 0, sourceEndMs: 100, playbackMode: 'once' }, zOrder: 0,
      transition: { enterMs: 0, exitMs: 0, easing: 'easeInOutCubic' }, content: [],
      audio: {
        gainDb: -3, gainCeilingDb: -1,
        ducking: { targetSourceTracks: [], attenuationDb: -8, attackMs: 80, releaseMs: 240 },
        mixesAsIndependentEffect: true,
      },
    }],
  })).toBe('ready');
});

test('composition-only lifecycle remains visible without legacy teaching or Director metadata', () => {
  expect(hasDesktopDirectorProgress(undefined, undefined, {
    status: 'failed', code: 'teaching_composition_probe_error', retryable: true,
  })).toBe(true);
  expect(hasDesktopDirectorProgress(undefined, undefined, undefined)).toBe(false);
});
