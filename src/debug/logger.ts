type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  readonly t: number;
  readonly level: LogLevel;
  readonly msg: string;
  readonly data?: unknown;
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** Oldest first. */
  entries(): readonly LogEntry[];
  /** Plain text, one line per entry. */
  dump(): string;
}

export interface LoggerOptions {
  capacity: number;
  /** Clock, injectable for tests. Defaults to milliseconds since the logger was created. */
  now?: () => number;
  minLevel?: LogLevel;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Fixed-capacity in-memory logger. When full, the oldest entry is dropped. */
export function createLogger(opts: LoggerOptions): Logger {
  if (!Number.isInteger(opts.capacity) || opts.capacity < 1) {
    throw new Error("logger capacity must be a positive integer");
  }
  const start = performance.now();
  const now = opts.now ?? (() => Math.round(performance.now() - start));
  const min = RANK[opts.minLevel ?? "debug"];
  const buf: LogEntry[] = [];

  const add = (level: LogLevel, msg: string, data?: unknown) => {
    if (RANK[level] < min) return;
    buf.push(data === undefined ? { t: now(), level, msg } : { t: now(), level, msg, data });
    if (buf.length > opts.capacity) buf.shift();
  };

  return {
    debug: (m, d) => add("debug", m, d),
    info: (m, d) => add("info", m, d),
    warn: (m, d) => add("warn", m, d),
    error: (m, d) => add("error", m, d),
    entries: () => [...buf],
    dump: () =>
      buf
        .map((e) => {
          const base = `[${e.t}] ${e.level.toUpperCase()} ${e.msg}`;
          return e.data === undefined ? base : `${base} ${JSON.stringify(e.data)}`;
        })
        .join("\n"),
  };
}
