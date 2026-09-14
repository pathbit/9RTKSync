# Dashboard

The panel is **rendered on the server**. The HTML arrives with the data already embedded; the
browser never queries the SQLite database, and the page works with JavaScript disabled. jQuery
and Bootstrap only provide comfort — modals, the dropdown, and disabling a button once clicked.

Reachable at **http://localhost:9091** (internal port 9090), behind HTTP Basic Auth.

---

## Layout

| Section | What it shows |
| :--- | :--- |
| Security banner | Only while the factory password is still in use. |
| Metric cards | Total connections, OAuth accounts, API keys, registered combos. |
| Gateway card | Gateway URL, HTTP status, latency, database summary, **Test connection**. |
| Scheduler card | State, next run, tokens renewed, last result, **Logs**. |
| Connections table | Provider, name, type, health, remaining validity, last renewal, and a **details** button that opens the per-connection modal. |
| Virtual keys | The keys the gateway itself issued (`apiKeys`), with the issue date and whether the gateway still accepts them. The key material is never read and never drawn. |
| Registered models | The catalogue the gateway publishes on `/v1/models`, minus the combos. Status, remaining validity and last renewal are **inherited** from the connection that serves each model — a model has no health of its own. |
| Resilience combos | Registered combos and their model cascade. |

The six cards below the metrics are the same six, in the same order, in all three
RTKSync panels. When this gateway has no data for one of them, the card stays on
screen with an empty state saying why — an absent card would make two panels look
like two different products.

The model catalogue is the one card that comes from HTTP rather than from SQLite:
9Router assembles `/v1/models` at request time, from its static provider registry
plus the live connections, so there is no table to read. The read is authenticated
with a key the gateway itself issued; with no active key, the card says so instead
of claiming an empty catalogue.

---

## Refreshing

Every control is a real HTTP request that redirects back to the freshly rendered page
(POST-Redirect-GET), so what you see after an action is the new state, never a cached one.

| Control | Effect |
| :--- | :--- |
| **Refresh** | Plain link to `/`; re-reads the database and re-renders. |
| **Sync now** | Runs one full scheduler cycle (`POST /acoes/cron`), then reports what changed. |
| **Test connection** | Invalidates the 30 s probe cache and really calls the gateway. |
| **Settings** | Opens the single sign-on screen (`POST /acoes/sso`), which asks for the current panel password on top of the session. See [Single Sign-On](Single-Sign-On). |

The page is served with `Cache-Control: no-store, must-revalidate`, so a browser reload always
hits the server.

---

## Renewal diagnosis

It lives in the **details modal** of each connection, opened by the button at the end of the row.
It used to be a table column, but a whole sentence squeezed between seven columns overlapped its
neighbour. Previously the panel showed only `0 renewed`, with no way to tell "nothing needed
renewing" from "renewal failed". Now each connection carries the reason:

| Diagnosis | Meaning |
| :--- | :--- |
| `Outside the 15 min margin: renewal expected in ~9 min` | Healthy. The token is still far from expiry. |
| `Within the 15 min margin: will be renewed on the next sweep` | Renewal is due and will happen. |
| `Token expired: renewal will be attempted on the next sweep` | Past due — check the scheduler logs if it persists. |
| `No expiry recorded: will be renewed on the next sweep` | The gateway did not store a readable expiry. |
| `Static key: never expires, nothing to renew` | API-key provider. |
| `Local instance answered with 4 model(s)` | Local provider, reachable. |
| `Local instance did not answer the model catalog` | Local provider down. |

The margin comes from `REFRESH_MARGIN`.

---

## Scheduler logs

**Logs** on the scheduler card opens the per-cycle history. Each entry expands to the actions
that cycle produced — renewals, self-healing, provider errors. A cycle that failed is flagged in
red, both in the list and with a badge on the button itself.

A cycle with nothing to do shows as exactly that, rather than an empty screen you have to guess
about.

The in-memory history keeps the last cycles; the durable record is the file log
(see [Logging](Logging)).

---

## Language

Default **English**, with **Português** and **Español** in the flag dropdown (real flag icons from
`flag-icons`, not emoji).

The choice is persisted in **SQLite** — `ui_prefs.sqlite`, a database of the synchronizer's own,
next to the other panel state files. Never in the gateway's database (that would couple our schema
to theirs), and never in `localStorage` (which dies with the browser profile).

A missing translation key falls back to English, never to the raw key.

---

## Local providers

An Ollama, vLLM or LM Studio instance usually needs a facade API key, which used to make it show
up as a cloud provider. It is now recognised as **Local** and its row carries the `baseUrl` and
the models the instance actually serves, discovered through `/api/tags` or `/v1/models`.

An instance that stops answering is marked `unreachable` and shows the **Unknown** badge, instead
of being assumed healthy.

---

## Security

- No access token, refresh token or API key is ever rendered.
- `Cache-Control: no-store`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`.
- `/api/status` no longer sends `Access-Control-Allow-Origin: *`.
- Publish the port on `127.0.0.1` only.

More in [Authentication](Authentication).

---

## JSON endpoints

Kept for automation; the dashboard itself does not use them.

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/healthz` | GET | Unauthenticated liveness probe. `OK`, `DATABASE_NOT_READY` or `ROUTER_SERVICE_UNREACHABLE`. |
| `/api/status` | GET | Full state as JSON. |
| `/api/cron-status` | GET | Scheduler state and history. |
| `/api/sync` | POST | Trigger a synchronization pass. |
| `/api/cron-run` | POST | Trigger one scheduler cycle. |
