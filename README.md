# Climbing Competition Strategy Planner

A web-based dashboard for optimizing your strategy in timed climbing competitions. Input the competition parameters and your climbing ability, and get a mathematically optimized route plan — plus a live mode that adapts in real-time as you climb.

## Features

- **Route distribution modeling** — assigns YDS grades across routes using a normal distribution
- **Time & fatigue modeling** — sigmoid-based climb/rest time curves and a piecewise warm-up → peak → fatigue performance model
- **Failure probability** — sigmoid model for onsight fail rates based on grade vs ability gap
- **Greedy optimizer** — maximizes expected points per minute across the full competition window
- **Live competition mode** — log climbs during the comp, get real-time grade recalibration and top-3 route recommendations
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
