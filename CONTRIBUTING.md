# Contributing

This is a design-led project: the vehicle design is owned by the project owner and recorded in `docs/design/` (Chinese). Code and tooling support that design — they do not redefine it.

## Scope

- **Welcome:** engine fixes, better rendering/export scripts, documentation corrections, reproducible bug reports with a render or a failing check.
- **Needs the owner's sign-off first:** any change to dimensions, criteria thresholds, mechanism states, or the design SSOT. Open an issue describing the trade-off before writing code.
- **Out of scope:** water systems, seat rails/lifts, and anything that contradicts the hard boundary of ≤ 2000 mm height with the pop-top down.

## Before you open a PR

1. Open `蓝图-v17.html` and walk all eight presets. Hard checks must be green and the browser console clean.
2. Actually look at the rendered image — a measurement or a green check alone is not accepted evidence here; the drawing and the checks can disagree.
3. If you touched geometry, include a screenshot and the key numbers from the run (which preset, which check, what value).
4. Keep one change per commit, with a message that says what changed and why.
5. Historical files (`蓝图-*.html` before v17) are archaeology: do not edit or delete them.

The exact headless recipe is in `docs/design/蓝图工具.md`; project-specific conventions are in `AGENTS.md`.

## Issues

State the preset, the parameter values if they differ from defaults, and what you expected versus what the drawing showed. Screenshots are worth more than prose. Please do not paste credentials or machine-specific paths into issues.

## License

Contributions are licensed under AGPL-3.0 (see `LICENSE.md`).
