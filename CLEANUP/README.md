# Cleanup Initiative

This directory contains a structured review of the Noctua Mail codebase aimed at four goals:

1. **Maintainability** — can a new contributor (or agent) find their way around?
2. **No duplication** — every concept implemented once.
3. **Regression safety** — changes don't silently break adjacent features.
4. **Risk visibility** — performance and security issues surfaced, not buried.

## The four-pass review

| Pass | Name                          | Focus                                                   | Status |
|------|-------------------------------|---------------------------------------------------------|--------|
| 1    | Inventory & hotspots          | LOC, complexity, dead code, test coverage gaps          | **done** — see [pass1-hotspots.md](pass1-hotspots.md) |
| 2    | Duplication & abstraction     | Copy-paste, inconsistent patterns, over-abstraction     | **done** — see [pass2-duplication.md](pass2-duplication.md) |
| 3    | Architectural seams           | God-files split strategy, module boundaries             | **done** — see [pass3-architecture.md](pass3-architecture.md) |
| 4    | Risk — security & performance | Input validation, XSS, N+1, bundle, IMAP lifecycle      | **done** — see [pass4-risk.md](pass4-risk.md) |

Each pass produces a markdown report with **prioritized action points**:

- **P0** — regression risk or security; address before next refactor
- **P1** — significant maintainability or duplication debt
- **P2** — nice-to-have, opportunistic

## How to use this directory

- Agents picking up work should read the relevant `passN-*.md` and pick a single action point.
- Each action point is self-contained: location, problem, proposed approach, regression risk, test status.
- When an action point is completed, move it to `completed/` with a short note on what changed.
- New findings that don't fit a pass go in `notes.md` for triage.

## Files

- `README.md` — this file
- `pass1-hotspots.md` — Pass 1 findings and action list
- `pass1-appendix-loc.txt` — raw LOC-per-file data (555 files)
- `passN-*.md` (future) — subsequent passes
- `completed/` (future) — closed action points with short completion notes
