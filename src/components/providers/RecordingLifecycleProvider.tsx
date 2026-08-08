'use client';

import { useEffect, type ReactNode } from 'react';
import {
  markRecordingInterruptionRequested,
  recoverUnfinishedRecordings,
} from '@/lib/db-client';
import { recordingLifecycle } from '@/services/recordingLifecycleSingleton';

export function RecordingLifecycleProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    if (!recordingLifecycle.activeSession()) {
      void recoverUnfinishedRecordings().catch(() => undefined);
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const session = recordingLifecycle.activeSession();
      if (!session) return;
      void markRecordingInterruptionRequested(session.recordingId).catch(() => undefined);
      event.preventDefault();
      event.returnValue = '';
    };
    const onPageHide = (event: PageTransitionEvent) => {
      const session = recordingLifecycle.activeSession();
      if (event.persisted || !session) return;
      void markRecordingInterruptionRequested(session.recordingId).catch(() => undefined);
      void recordingLifecycle.stop('interrupted');
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return <>{children}</>;
}
