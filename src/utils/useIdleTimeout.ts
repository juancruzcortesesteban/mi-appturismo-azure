import { useEffect, useRef } from 'react';

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove',
  'keydown',
  'click',
  'scroll',
  'touchstart',
];
const ACTIVITY_SYNC_INTERVAL_MS = 60 * 1000;

export function useIdleTimeout(
  isActive: boolean,
  onTimeout: () => void,
  onActivity?: () => void | Promise<void>,
): void {
  const onTimeoutRef = useRef(onTimeout);
  const onActivityRef = useRef(onActivity);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
    onActivityRef.current = onActivity;
  }, [onActivity, onTimeout]);

  useEffect(() => {
    if (!isActive) return undefined;

    let idleTimer = 0;
    let lastActivitySync = 0;
    let hasTimedOut = false;

    const registerActivity = () => {
      if (hasTimedOut) return;

      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        hasTimedOut = true;
        onTimeoutRef.current();
      }, IDLE_TIMEOUT_MS);

      const now = Date.now();
      if (now - lastActivitySync >= ACTIVITY_SYNC_INTERVAL_MS) {
        lastActivitySync = now;
        void onActivityRef.current?.();
      }
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, registerActivity, { passive: true });
    });
    registerActivity();

    return () => {
      window.clearTimeout(idleTimer);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, registerActivity);
      });
    };
  }, [isActive]);
}
