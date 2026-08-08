'use client';

import { RecordingLifecycleCoordinator } from '@/services/recordingLifecycle';
import type { SessionHandle } from '@/services/recordingSession';

export const recordingLifecycle = new RecordingLifecycleCoordinator<SessionHandle, Awaited<ReturnType<SessionHandle['stop']>>>();
