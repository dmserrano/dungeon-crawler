import type { Point, Room } from "./room";

/** Tile size of the room wall grid in pixels (matches the Kenney 16x16 tiles). */
const NAV_CELL = 16;
const STRAIGHT = 10;
const DIAGONAL = 14;

/** Blocked/free grid over the room's playable area [0, width] x [0, height]. */
export interface NavGrid {
  cols: number;
  rows: number;
  cell: number;
  /** 1 = wall, row-major. */
  blocked: Uint8Array;
}

/** Rasterise the room's wall boxes into a grid: a cell is blocked when a wall overlaps its interior. */
export function buildNavGrid(room: Room, cell = NAV_CELL): NavGrid {
  const cols = Math.max(1, Math.ceil(room.width / cell));
  const rows = Math.max(1, Math.ceil(room.height / cell));
  const blocked = new Uint8Array(cols * rows);
  for (const w of room.walls) {
    const c0 = Math.max(0, Math.floor((w.x - w.hw) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((w.x + w.hw) / cell) - 1);
    const r0 = Math.max(0, Math.floor((w.y - w.hh) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((w.y + w.hh) / cell) - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
  }
  return { cols, rows, cell, blocked };
}

/** Cell index of a world point, or -1 when it lies outside the grid. */
export function cellOf(grid: NavGrid, p: Point): number {
  const c = Math.floor(p.x / grid.cell);
  const r = Math.floor(p.y / grid.cell);
  return c < 0 || r < 0 || c >= grid.cols || r >= grid.rows ? -1 : r * grid.cols + c;
}

function cellCenter(grid: NavGrid, index: number): Point {
  return {
    x: ((index % grid.cols) + 0.5) * grid.cell,
    y: (Math.floor(index / grid.cols) + 0.5) * grid.cell,
  };
}

/** Binary min-heap ordered by (f, cell index), so ties always resolve the same way. */
class OpenSet {
  private readonly f: number[] = [];
  private readonly idx: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  private less(a: number, b: number): boolean {
    const fa = this.f[a] as number;
    const fb = this.f[b] as number;
    return fa < fb || (fa === fb && (this.idx[a] as number) < (this.idx[b] as number));
  }

  private swap(a: number, b: number): void {
    [this.f[a], this.f[b]] = [this.f[b] as number, this.f[a] as number];
    [this.idx[a], this.idx[b]] = [this.idx[b] as number, this.idx[a] as number];
  }

  push(f: number, index: number): void {
    this.f.push(f);
    this.idx.push(index);
    let i = this.idx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.idx[0] as number;
    const lastF = this.f.pop() as number;
    const lastIdx = this.idx.pop() as number;
    const n = this.idx.length;
    if (n > 0) {
      this.f[0] = lastF;
      this.idx[0] = lastIdx;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.less(l, m)) m = l;
        if (r < n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [0, -1, STRAIGHT],
  [-1, 0, STRAIGHT],
  [1, 0, STRAIGHT],
  [0, 1, STRAIGHT],
  [-1, -1, DIAGONAL],
  [1, -1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [1, 1, DIAGONAL],
];

/**
 * A* over the wall grid: 8-way, no corner cutting (a diagonal step needs both adjacent
 * orthogonal cells free), integer costs, ties broken by cell index. Returns the cell centres from
 * the step after `from` up to `to`, `[]` when already in the same cell, or `null` when the goal is
 * blocked, unreachable, or farther than `maxSteps` cells of path. The start cell may be blocked
 * (a body brushing a wall) so an enemy is never trapped by its own position.
 */
export function findPath(grid: NavGrid, from: Point, to: Point, maxSteps: number): Point[] | null {
  const start = cellOf(grid, from);
  const goal = cellOf(grid, to);
  if (start < 0 || goal < 0 || grid.blocked[goal]) return null;
  if (start === goal) return [];
  const { cols, rows } = grid;
  const gx = goal % cols;
  const gy = Math.floor(goal / cols);
  const h = (i: number): number => {
    const dx = Math.abs((i % cols) - gx);
    const dy = Math.abs(Math.floor(i / cols) - gy);
    return STRAIGHT * (dx + dy) + (DIAGONAL - 2 * STRAIGHT) * Math.min(dx, dy);
  };
  const maxCost = maxSteps * DIAGONAL;
  const g = new Map<number, number>([[start, 0]]);
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  const open = new OpenSet();
  open.push(h(start), start);
  while (open.size > 0) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    if (cur === goal) {
      const cells: number[] = [];
      for (let i = goal; i !== start; i = parent.get(i) as number) cells.push(i);
      if (cells.length > maxSteps) return null;
      return cells.reverse().map((i) => cellCenter(grid, i));
    }
    closed.add(cur);
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    const gCur = g.get(cur) as number;
    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const n = ny * cols + nx;
      if (grid.blocked[n] || closed.has(n)) continue;
      if (dx !== 0 && dy !== 0 && (grid.blocked[cy * cols + nx] || grid.blocked[ny * cols + cx])) {
        continue; // no corner cutting
      }
      const gn = gCur + cost;
      if (gn > maxCost) continue;
      const known = g.get(n);
      if (known !== undefined && known <= gn) continue;
      g.set(n, gn);
      parent.set(n, cur);
      open.push(gn + h(n), n);
    }
  }
  return null;
}
