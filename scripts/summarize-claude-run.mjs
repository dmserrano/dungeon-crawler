// Prints a tool-usage summary of a claude-code-action run to the job log / step summary.
// Usage: node scripts/summarize-claude-run.mjs [execution-output.json]
//
// The action hides tool calls in the job log (show_full_output: false) because the log is public.
// This prints counts only: tool names, the first two words of Bash commands and Read paths.
// Never tool results, full commands or prompts. Never fails the job.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file =
  process.argv[2] ??
  join(process.env.RUNNER_TEMP ?? "/home/runner/work/_temp", "claude-execution-output.json");

function load(path) {
  const text = readFileSync(path, "utf8").trim();
  if (text.startsWith("[")) return JSON.parse(text);
  return text.split("\n").map((line) => JSON.parse(line));
}

const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const bashLabel = (cmd = "") => cmd.trim().split(/\s+/).slice(0, 2).join(" ") || "(empty)";

try {
  const messages = load(file);
  const tools = new Map();
  const bash = new Map();
  const reads = new Map();
  let assistantTurns = 0;

  for (const m of messages) {
    if (m.type !== "assistant") continue;
    assistantTurns++;
    for (const block of m.message?.content ?? []) {
      if (block.type !== "tool_use") continue;
      tally(tools, block.name);
      if (block.name === "Bash") tally(bash, bashLabel(block.input?.command));
      if (block.name === "Read" && block.input?.file_path) tally(reads, block.input.file_path);
    }
  }

  const result = messages.findLast((m) => m.type === "result") ?? {};
  const denials = new Map();
  for (const d of result.permission_denials ?? []) {
    tally(
      denials,
      d.tool_name === "Bash" ? `Bash: ${bashLabel(d.tool_input?.command)}` : d.tool_name,
    );
  }

  const lines = [
    "### Claude run tool usage",
    `turns (result): ${result.num_turns ?? "?"} | assistant messages: ${assistantTurns} | cost: $${result.total_cost_usd ?? "?"} | denials: ${result.permission_denials?.length ?? "?"}`,
    "",
    "Tool calls:",
    ...top(tools, 20).map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`),
    "",
    "Bash by command prefix:",
    ...top(bash, 15).map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`),
    "",
    "Permission denials:",
    ...(denials.size
      ? top(denials, 15).map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`)
      : ["  none"]),
    "",
    "Most re-read files:",
    ...top(reads, 8)
      .filter(([, v]) => v > 1)
      .map(([k, v]) => `  ${String(v).padStart(4)}  ${k}`),
  ];
  console.log(lines.join("\n"));
} catch (err) {
  console.log(`Could not summarize ${file}: ${err instanceof Error ? err.message : err}`);
}
