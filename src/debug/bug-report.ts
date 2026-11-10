/** Pure builder for the prefilled GitHub "new issue" URL. No DOM, no network. */

export interface BugReportInfo {
  /** `owner/name` */
  repo: string;
  simVersion: number;
  seed: number | string;
  tick: number;
  hash: string;
  userAgent: string;
  /** Log lines, oldest first. */
  logLines: readonly string[];
}

/** Common browser/server limit is ~8k; stay a bit under. */
const MAX_URL_LENGTH = 8000;
const MAX_LOG_LINES = 50;
const TEMPLATE = "bug-report.yml";

const build = (info: BugReportInfo, lines: readonly string[], ua: string): string => {
  const q = new URLSearchParams({
    template: TEMPLATE,
    title: `Bug: (sim ${info.simVersion}, seed ${info.seed}, tick ${info.tick})`,
    version: `sim ${info.simVersion}`,
    seed: String(info.seed),
    tick: String(info.tick),
    hash: info.hash,
    "user-agent": ua,
    logs: lines.join("\n"),
  });
  return `https://github.com/${info.repo}/issues/new?${q.toString()}`;
};

/**
 * Build the URL. Keeps the last 50 log lines, then drops the oldest lines until the URL
 * fits in `maxLength`. If it still does not fit, the user agent is truncated.
 */
export function buildIssueUrl(info: BugReportInfo, maxLength = MAX_URL_LENGTH): string {
  let lines = info.logLines.slice(-MAX_LOG_LINES);
  let url = build(info, lines, info.userAgent);
  while (url.length > maxLength && lines.length > 0) {
    lines = lines.slice(1);
    url = build(info, lines, info.userAgent);
  }
  if (url.length > maxLength) url = build(info, lines, info.userAgent.slice(0, 100));
  return url;
}
