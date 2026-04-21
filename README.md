# Climbing Competition Planner

A strategy optimizer for **time-limited, open-format climbing competitions** — the kind where all routes are open simultaneously, competitors choose what to attempt and in what order, and points are awarded based on route number (higher number = harder route = more points).

## Competition Format

This tool is built for a specific comp format:
- **Fixed time window** (e.g. 3 hours) to climb as many routes as possible
- **Numbered routes** with increasing difficulty — route #1 is easiest, route #N is hardest
- **Points = route number × 100** (route #1 = 100 pts, route #37 = 3,700 pts)
- **Routes can be toprope, lead, or bouldering** — all mixed together
- **Limited attempts** per route with a point penalty for retries
- Competitors choose their own order and strategy

If your comp uses a different format (IFSC-style isolation, redpoint scoring, etc.), this tool probably isn't what you need.

## Features

- **Route distribution modeling** — assigns YDS/V-grades across routes using a normal distribution
- **Time & fatigue modeling** — sigmoid-based climb/rest time curves and a piecewise warm-up → peak → fatigue performance model
- **Failure probability** — sigmoid model for onsight fail rates based on grade vs ability gap
- **Greedy optimizer** — maximizes expected points per minute across the full competition window
- **Live competition mode** — log climbs during the comp, get real-time grade and time recalibration with top-3 route recommendations
- **Dual grade display** — all grades shown as YDS/V-grade (e.g. 5.11c/V4) with a rope/boulder toggle for logging
- **Advanced parameter tuning** — every model constant is exposed as a configurable input
- **Persistent state** — live comp data saved to localStorage, survives page refresh

## Run Locally

```bash
npm start
```

Opens a local server at `http://localhost:3000`. No build step — it's vanilla HTML/CSS/JS with Chart.js via CDN.

## Tech

- Vanilla JS, HTML, CSS
- [Chart.js](https://www.chartjs.org/) for interactive graphs
- [Google Material Symbols](https://fonts.google.com/icons) for icons
- Zero dependencies beyond CDN links

## License

MIT

---

*Built entirely with [Claude Opus 4.6](https://www.anthropic.com/claude) via [Kiro CLI](https://kiro.dev).*
