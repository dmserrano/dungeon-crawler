/** Smoothed FPS counter. Time is supplied by the caller. */
export function createFpsMeter() {
  let last: number | null = null;
  let fps = 0;
  return {
    frame(nowMs: number): number {
      if (last !== null && nowMs > last) fps = fps * 0.9 + (1000 / (nowMs - last)) * 0.1;
      last = nowMs;
      return fps;
    },
  };
}

/** Debug overlay lines for enemies: a count, then each enemy's id and state name. */
export function describeEnemies(views: readonly { id: number; ai: string | null }[]): string {
  const enemies = views.filter((v) => v.ai !== null);
  return [`enemies ${enemies.length}`, ...enemies.map((v) => `  #${v.id} ${v.ai}`)].join("\n");
}
