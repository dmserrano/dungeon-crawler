// Headless sim benchmark. Seeded, deterministic inputs; only the timings vary between runs.
//   pnpm bench                  print a table
//   pnpm bench --json out.json  also write results for bench/compare.mjs
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { InputFrame } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { createRng } from "../src/sim/rng/rng";
import { ROOM_HEIGHT, ROOM_WIDTH } from "../src/sim/room";
import { createSimState, step, TICK_DT } from "../src/sim/step";

const SEED = 1337;
const BODIES = 200;
const WARMUP_TICKS = 120;
const SAMPLES = 15;
const TICKS_PER_SAMPLE = 120;

/** Budget for step() at BODIES bodies (see AGENTS.md). A 60 Hz frame is 16.6 ms. */
const BUDGET_MS = 4;

interface BenchResult {
  name: string;
  /** Median ms per tick over SAMPLES samples. */
  medianMs: number;
  p95Ms: number;
}

function inputs(count: number): InputFrame[] {
  const rng = createRng(SEED);
  return Array.from({ length: count }, () => ({
    up: rng.next() < 0.5,
    down: rng.next() < 0.5,
    left: rng.next() < 0.5,
    right: rng.next() < 0.5,
    aim: 0,
    attack: false,
    dash: false,
  }));
}

function measure(name: string, tick: (i: number) => void): BenchResult {
  for (let i = 0; i < WARMUP_TICKS; i++) tick(i);
  const samples: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const t0 = performance.now();
    for (let i = 0; i < TICKS_PER_SAMPLE; i++) tick(i);
    samples.push((performance.now() - t0) / TICKS_PER_SAMPLE);
  }
  samples.sort((a, b) => a - b);
  return {
    name,
    medianMs: samples[Math.floor(samples.length / 2)] ?? 0,
    p95Ms: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 0,
  };
}

/** A room with BODIES seeded, moving dynamic circles, all created through the PhysicsWorld interface. */
function stressState() {
  const world = createRapierWorld();
  const state = createSimState(world, SEED);
  const rng = createRng(SEED);
  for (let i = 0; i < BODIES; i++) {
    const id = world.createDynamicCircle(rng.next() * ROOM_WIDTH, rng.next() * ROOM_HEIGHT, 4);
    world.setVelocity(id, (rng.next() - 0.5) * 120, (rng.next() - 0.5) * 120);
  }
  return state;
}

async function runBench(): Promise<BenchResult[]> {
  await initPhysics();
  const results: BenchResult[] = [];
  const frames = inputs(TICKS_PER_SAMPLE);
  const frame = (i: number) => frames[i % frames.length] as InputFrame;

  let small = createSimState(createRapierWorld(), SEED);
  results.push(
    measure("step() player room", (i) => {
      small = step(small, frame(i));
    }),
  );

  const raw = stressState();
  results.push(measure(`physics.step() ${BODIES} bodies`, () => raw.world.step(TICK_DT)));

  let stress = stressState();
  results.push(
    measure(`step() ${BODIES} bodies`, (i) => {
      stress = step(stress, frame(i));
    }),
  );
  return results;
}

const results = await runBench();
const w = Math.max(...results.map((r) => r.name.length));
console.log(`${"case".padEnd(w)}  median ms/tick  p95 ms/tick`);
for (const r of results) {
  console.log(
    `${r.name.padEnd(w)}  ${r.medianMs.toFixed(4).padStart(14)}  ${r.p95Ms.toFixed(4).padStart(11)}`,
  );
}
const stressResult = results.find((r) => r.name === `step() ${BODIES} bodies`);
if (stressResult && stressResult.medianMs > BUDGET_MS) {
  const msg = `step() with ${BODIES} bodies takes ${stressResult.medianMs.toFixed(2)} ms/tick, over the ${BUDGET_MS} ms budget. Not a failure.`;
  console.warn(
    process.env.GITHUB_ACTIONS ? `::warning title=Sim budget::${msg}` : `Warning: ${msg}`,
  );
}
const jsonIdx = process.argv.indexOf("--json");
const jsonPath = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : undefined;
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`);
