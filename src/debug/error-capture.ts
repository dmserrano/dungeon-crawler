import type { Logger } from "./logger";

const describe = (v: unknown): { message: string; stack?: string } => {
  if (v instanceof Error) return { message: v.message, ...(v.stack ? { stack: v.stack } : {}) };
  return { message: String(v) };
};

/**
 * Record uncaught errors and unhandled promise rejections in `log`.
 * Uses listeners only: nothing is prevented or swallowed, so the browser console still shows them.
 * Returns a function that removes the listeners.
 */
export function installErrorCapture(target: EventTarget, log: Logger): () => void {
  const onError = (e: Event) => {
    const ev = e as ErrorEvent;
    const err = describe(ev.error ?? ev.message);
    log.error(`uncaught: ${err.message || ev.message}`, {
      ...(err.stack ? { stack: err.stack } : {}),
      ...(ev.filename ? { at: `${ev.filename}:${ev.lineno}:${ev.colno}` } : {}),
    });
  };
  const onRejection = (e: Event) => {
    const err = describe((e as PromiseRejectionEvent).reason);
    log.error(`unhandled rejection: ${err.message}`, err.stack ? { stack: err.stack } : undefined);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
