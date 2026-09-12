# CityFlow AI — ML service

The forecasting and optimisation brain. Python, because this is the part of the
system that genuinely needs Prophet, XGBoost and a constraint solver; everything
else lives in the Next.js application.

---

## What it does

| Endpoint | What it answers |
|---|---|
| `GET /health` | Is the service up, and is the cache connected? |
| `POST /forecast` | What will demand look like in each 15-minute slot tomorrow? |
| `POST /optimize` | Given everyone's flexibility, who should leave when? |

---

## Why each library is here

**Prophet** — fits the part of travel demand that is calendar-driven: the daily
double peak, the weekly cycle, the flatter weekend. It also returns an
uncertainty interval, which matters for a product whose first principle is that
a prediction is never presented as a measurement.

**XGBoost** — fitted to *Prophet's residuals*, not to demand. Prophet cannot see
rain, a closed arterial road or a public event, so a gradient-boosted model
picks up those conditional effects from tabular features while the seasonal
structure stays interpretable.

**OR-Tools (CP-SAT)** — the actual point of the project. Telling one person that
08:45 is quiet is easy; telling ten thousand people is a scheduling problem,
because the advice invalidates itself. CP-SAT minimises the *busiest slot of the
day* subject to every person's own stated flexibility window, with a second cost
on disrupting routines. That is what makes this demand *smoothing* rather than
demand *relocation*.

**NetworkX** — corridor modelling, so two trips that leave at the same time are
only counted as competing if they actually share road.

---

## Honest limitations

1. **A new city has no history.** With fewer than seven days of real observed
   demand, `/forecast` returns a *seasonal prior* — the shape urban demand
   normally takes — labelled `method: "seasonal_prior"` with confidence capped
   at 35. It is not a measurement and the API says so on every response.
2. **The corridor graph is not a routed road network.** It knows two zones are
   connected; it does not know by which road, how many lanes, or where the
   junction backs up. Corridor pressure is therefore relative, never a
   vehicles-per-hour claim.
3. **Rain's effect is assumed, not fitted.** The uplift mapping is coarse,
   capped, and documented at the point of use in `services/forecast.py`.
4. **The optimiser optimises what it is given.** If the caller sends a baseline
   in the wrong units, the schedule will be confidently wrong. Units are stated
   on the field and enforced by the web application's client.

---

## Run it locally

### Python 3.10 or newer is required

Check what you have first:

```bash
python3 --version
```

If that says **3.9 or lower** — which it will on a stock macOS, and on
Anaconda's `base` environment — the install fails on `networkx`, and the
service would refuse to start even if you forced it through. Two reasons, both
real: networkx 3.4 dropped Python 3.9, and the request models use `X | None`
type unions, which Python only understands at runtime from 3.10.

Pick whichever you already have:

```bash
# Anaconda / Miniconda
conda create -n cityflow python=3.11 -y
conda activate cityflow
```

```bash
# Homebrew
brew install python@3.11
cd ml && python3.11 -m venv .venv && source .venv/bin/activate
```

### Then

```bash
cd ml
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Then open <http://localhost:8000/docs> for the interactive API browser.

> Prophet compiles a Stan backend on first install. It can take a few minutes
> and needs a working C++ toolchain. On macOS: `xcode-select --install`.
>
> On Apple Silicon every dependency here has a prebuilt arm64 wheel, so the
> install is a download rather than a compile in practice.

### With Docker instead

```bash
docker compose up ml
```

---

## Tests

```bash
cd ml
conda activate cityflow     # or: source .venv/bin/activate
pytest                      # fast tests — the prior, the optimiser, determinism
pytest -m slow              # fits a REAL Prophet model. Run this too.
```

**Run `pytest -m slow` before trusting a fresh install.** The fast suite proves
Prophet is importable, not that it works — Prophet fits through a compiled
CmdStan backend, and a version mismatch in `cmdstanpy` makes it fail to load
while every fast test still passes. That happened during development, which is
why `cmdstanpy` is now pinned and why CI runs the slow test as its own step.

The optimiser tests are the important ones. They assert the product's central
claim directly: that no new peak is created, that total demand is conserved, and
that a person who declared no flexibility is never moved regardless of how much
better the objective would be.

---

## Security

- A shared secret in the `X-CityFlow-Key` header. The service **refuses to
  start** in production without one.
- No database, no sessions, no personal data. A commuter reaches this service
  as an opaque `ref` string and nothing else.
- Request logs record method, path, status and duration — never bodies, which
  carry travel patterns.
- Runs as a non-root user in its container.

---

## If this service is down

The web application falls back to its own TypeScript demand model and shows a
notice. Recommendations keep working; they are simply produced by the simpler
model. That is deliberate — a free-tier ML container should not be able to take
the product down.
