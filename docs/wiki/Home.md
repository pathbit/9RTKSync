# 9RTKSync

**9Router Universal Token & Connection Synchronizer** — a high-availability guardian for
[9Router](https://github.com/decolua/9router) gateways. It keeps OAuth accounts alive, heals
credential formats the gateway cannot read, clears stale rate-limit locks, and reports exactly
why each connection was or was not renewed.

This wiki is generated from [`docs/wiki/`](https://github.com/pathbit/9RTKSync/tree/master/docs/wiki)
in the main repository. Edit the files there and open a pull request — a push to `master`
republishes these pages automatically. Editing a page directly here will be overwritten.

---

## Pages

| Page | What it covers |
| :--- | :--- |
| [Installation](Installation) | Docker Compose and local virtual environment |
| [Configuration](Configuration) | Every environment variable — the full headless contract |
| [Dashboard](Dashboard) | The server-rendered panel, language switcher, cron logs |
| [Authentication](Authentication) | Credentials, headless mode, break-glass recovery |
| [Logging](Logging) | Persistent file log, rotation, 30-day retention |
| [Architecture](Architecture) | How the sync engine talks to the 9Router database |
| [Remote Access](Remote-Access) | Tunnel, Tailscale, and what has to be on before either |
| [Egress Testing](Egress-Testing) | A bench that proves where the traffic actually leaves from |
| [Egress and Multi-Session](Egress-And-Multi-Session) | Why several accounts sharing one outbound address is the risk, and what the gateway models |
| [Licensing and Capacity](Licensing-And-Capacity) | How many subscriptions for how many developers, and which field answers it |
| [Troubleshooting](Troubleshooting) | Concrete symptoms and what they actually mean |
| [Upstream Fixes](Upstream-Fixes) | Bugs found in the gateways and the patches sent upstream |

---

## What it does

**Credential format healing.** 9Router stores `expiresAt` inside a JSON `data` column. When a
value arrives in a shape the gateway's parser rejects, its proactive refresh silently stops
firing for that connection and the account 401s until someone re-authenticates by hand.
9RTKSync normalizes those values on every sweep.

**Proactive OAuth renewal.** Google Antigravity and Gemini CLI tokens are refreshed before they
expire, using a configurable margin (`REFRESH_MARGIN`, default 15 minutes). Credentials found on
the host (`~/.gemini/`, `~/.config/antigravity/`) are picked up and synced into the gateway.

**Rate-limit unlocking.** Expired `rateLimitedUntil` locks and stale `modelLock_*` entries are
removed, and `backoffLevel` is reset, so a connection stops being skipped once its cooldown has
actually passed.

**Local provider health.** Ollama, vLLM, LM Studio and any OpenAI-compatible local instance are
probed for their model catalog. A local instance that stops answering is marked `unreachable`
instead of being assumed healthy.

**Server-rendered dashboard.** Port `9090` inside the container (published on `9091`), bound to
loopback. The page is assembled on the server with the data already embedded — the browser never
queries the SQLite database.

---

## The sibling project

If you run [OmniRoute](https://github.com/diegosouzapw/OmniRoute) instead of 9Router, use
[OminiRTKSync](https://github.com/pathbit/OminiRTkSync), which targets that gateway's relational
schema. The two projects share the same dashboard, logging, authentication and configuration
contract; only the database layer and the provider set differ.

Both synchronizers listen on **port 9090 inside their container**. The published host ports
differ so they can run side by side: `9091` for 9RTKSync, `9092` for OminiRTKSync.

---

---

## Signing in to the dashboard

| | |
| :--- | :--- |
| **Address** | `http://localhost:9091` |
| **User** | `admin` — or whatever `DASHBOARD_USER` says |
| **Password** | the value you set in `DASHBOARD_PASSWORD` |

There is **no factory password**: a fixed one shipped in an image is public the
moment the image is. Set yours in `.env` before bringing the stack up.

Brought it up without setting one? The container generated a recovery
credential on first boot — read it and sign in as `admin`, then set a real
password on the screen:

```bash
docker exec 9rtk-sync cat /app/data/db/.dashboard_recovery
```

Full detail in [Authentication](Authentication).

## License

MIT — see [LICENSE](https://github.com/pathbit/9RTKSync/blob/master/LICENSE).

Built by [Pathbit](https://pathbit.co/).
