# Glossary

- **Sim**: the headless, deterministic game simulation in `src/sim/`.
- **Room template**: a hand-authored Tiled room (`.tmj`) the generator can place.
- **Floor**: one generated graph of connected rooms for a run.
- **Run**: one playthrough from start to death/win; identified by a seed.
- **Replay**: a recorded input log + seed; replaying must reproduce the same state hash.
- **Signal / target**: puzzle wiring. A trigger (plate, lever, key) emits a signal; targets (door, spawner) respond.
- **Slice**: a vertical, independently shippable unit of work tracked as one GitHub issue.
- **Walking skeleton**: the first end-to-end slice: player moving in a physics room.
