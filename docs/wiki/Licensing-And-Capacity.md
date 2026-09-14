# Licensing and capacity: how many subscriptions for how many developers

*(Versão em português ao final.)*

"We are twelve developers — how many Max subscriptions do I buy?" is the first
question anyone asks after the gateway is up, and it is the one this wiki cannot
close with a table. Not because nobody did the arithmetic: because **no consumer
subscription publishes its absolute capacity**. Anthropic publishes a multiplier
and a window; OpenAI publishes ranges and then says they are not fixed; Google
points at a dashboard. One number in the whole landscape comes stamped with an
absolute value, and it is stamped *per user*.

So this page gives three things instead of a table of licences: the formula, the
demand side solved with numbers that were actually measured, and the command that
finds the missing term in your environment. And it starts with the part that
needs no measurement at all.

---

## The part that needs no measuring

For Claude Pro/Max, `L = N`. Twelve developers, twelve subscriptions, each one
bought and authenticated by its own holder. That is not a capacity finding — it
is the licence text
`[FONTE: https://code.claude.com/docs/en/legal-and-compliance — read on 2026-09-12]`:

> "Advertised usage limits for Pro and Max plans assume **ordinary, individual
> usage** of Claude Code and the Agent SDK."

> "**OAuth authentication is intended exclusively for purchasers** of Claude
> Free, Pro, Max, Team, and Enterprise subscription plans (…)"

> "**Customers may not pay for, resell, or intermediate Claude usage on their end
> users' behalf.** Each end user must authenticate with their own Anthropic API
> key, Claude subscription plan credentials, or 3P inference provider
> credential."

A gateway does not reduce that number, and this one does not try to. What it
does is keep accounts that **are already individual** alive, readable and
observable: renewing tokens before they die, healing credential formats the
gateway cannot parse, clearing locks that have already expired, and showing which
account is actually blocked. That is where it pays for itself — not in buying
fewer seats.

For Google AI Pro / Antigravity and for OpenAI plans the equivalent terms
**were not read here**: `[A VERIFICAR: read each provider's subscription terms and
cite URL + date, as was done for Anthropic above]`. Do not assume symmetry
between providers.

---

## What is published, and what is a hole

| Provider | What is published | Absolute number? |
| :--- | :--- | :--- |
| Anthropic Pro/Max | "Your session-based usage limit will reset every five hours." · "Max 5x provides five times more usage per session than the Pro plan." · "Max plans also have a weekly usage limit that applies across all models." | **No** — a relative multiplier and a window. |
| OpenAI Codex | Message estimates "per five-hour period", as plan ranges (Plus 10–100 / 25–200 / 250–2,000 depending on the model) | **No** — "These estimates are not fixed message limits; check your usage dashboard for current limits and reset times." |
| Google Gemini API | "Rate limits depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio." | **No** — it defers to the dashboard. |
| Google Gemini Code Assist | Standard: **1,500** requests **per user per day** · Enterprise: **2,000** requests **per user per day** · **2** requests per second **per user** | **Yes — and per user.** |

`[FONTE: https://support.claude.com/en/articles/11049741-what-is-the-max-plan — read on 2026-09-12]`
`[FONTE: https://learn.chatgpt.com/docs/pricing — read on 2026-09-12]`
`[FONTE: https://ai.google.dev/gemini-api/docs/rate-limits — read on 2026-09-12]`
`[FONTE: https://docs.cloud.google.com/gemini/docs/quotas — read on 2026-09-12]`

The last row is the instructive one. The moment a provider does publish a hard
number, it arrives carved *per user*. There is no pot of 1,500 requests that
twelve developers share; there are twelve pots of 1,500. That is not a detail of
wording — it is the shape of the answer, and it is the same shape the licence
text imposes above.

So one term stays empty on purpose:

`[A MEDIR]` **`C_window` — the capacity of one subscription inside its reset
window.** Nobody publishes it. The procedure to obtain it is below; until you
run it, any table of the form "1 licence = 4 devs" is invention.

---

## The formula

| Symbol | Meaning | Where it comes from |
| :--- | :--- | :--- |
| `N` | developers on the team | headcount |
| `c` | concurrency factor, 0–1 | `[A MEDIR]` — the fraction of `N` requesting at the same moment |
| `U_sim` | simultaneous active sessions | `U_sim = N × c` |
| `R_h` | requests per hour per active session | measured — below |
| `T_tot` | **total** input tokens per request (cache reads included) | measured — below |
| `T_out` | output tokens per request | measured — below |
| `W_h` | quota reset window, in hours | 5 h published for Anthropic `[FONTE: support.claude.com article 11049741 — read on 2026-09-12]`; the 2 h seen on Antigravity is a **log observation**, not a published window `[FONTE: https://github.com/pathbit/pathbit-ai-for-devs/blob/96a5a34/0002_claude_gravity_utilizando_9router/article/ARTICLE.md#L689 — read on 2026-09-12]` |
| `F` | slack | an operating decision; 0.30 in the examples below |
| `C_window` | capacity of **one** subscription inside `W_h` | `[A MEDIR]` |

```
U_sim = N × c
D     = U_sim × R_h × (T_tot + T_out) × W_h × (1 + F)
L     = ceil( D / C_window )
```

**The unit of `D` and the unit of `C_window` must be the same.** On this gateway
the path is a subscription, and a subscription's meter does not publish what it
counts — so both sides are kept in **total** tokens, cache reads included. The
"only uncached input counts toward ITPM" rule belongs to the **API** rate-limit
page, not to a Pro/Max meter, and it is not a rounding difference: on the history
measured below the total input median is **22.6×** the median of the input that
would count for ITPM (88,442 ÷ 3,914 — a ratio between two medians, good for the
order of magnitude and not for accounting). Importing that rule here would size
the team at a twentieth of its demand, which is the most likely silent error in
the whole method. If your team is on API keys instead of
subscriptions, that is the sibling gateway's page, not this one — see
[Where this gateway differs](#where-this-gateway-differs).

---

## The demand side, measured

This is a **snapshot of one machine, frozen at an instant** — not a constant.
The history under `~/.claude/projects` grows with every session, so a run
without a cutoff gives a different answer every day. The cutoff is what makes
the block below reproducible rather than merely plausible:

```bash
python3 tools/measure_agent_usage.py --until 2026-09-13T02:00:00Z
```

`[FONTE: the command above, run on 2026-09-12 on the author's machine — the
cutoff 2026-09-13T02:00:00Z is 23:00 local time, UTC−3. It
reproduces bit for bit on that machine for as long as Claude Code keeps the
session files of that period; on yours it will print your numbers, not these.]`

```
recorte (--since)                           : nenhum (desde o inicio)
recorte (--until)                           : 2026-09-13T02:00:00Z
sessoes analisadas                         : 131
linhas assistant com usage (antes do dedup) : 17382
turnos unicos (dedup por message.id)        : 7332
inflacao de contar linha em vez de id       : 2.37x
T_in  entrada que conta p/ ITPM  mediana    : 3914
T_in  entrada que conta p/ ITPM  p90        : 7668
T_out saida                      mediana    : 723
T_out saida                      p90        : 1351
T_cache leitura de cache         mediana    : 83463
T_tot entrada total (conta+cache) mediana   : 88442
T_tot entrada total (conta+cache) p90       : 205437
R_h   requisicoes por hora ativa mediana    : 206
R_h   requisicoes por hora ativa p90        : 342
fracao de leitura de cache no total         : 98.2%
razao entrada total / entrada que conta     : 22.6x
pico de sessoes simultaneas                 : 13

TOTAL GERAL entrada total (conta+cache)     : 1967956629
TOTAL GERAL saida                           : 5817008
TOTAL GERAL token total do periodo          : 1973773637
```

Three caveats that have to travel with those numbers:

1. **Deduplication is not optional.** One API response is written to several
   `type: "assistant"` lines — the text and each tool block — repeating the same
   `message.id` and the same usage object. Over the population above — the lines
   that pass every filter the script applies (`type: "assistant"`, a `usage`
   object with a positive token count, a parsable timestamp, inside the cutoff) —
   counting lines instead of ids inflates the count by **2.37×**: 17,382 lines
   collapse to 7,332 turns. That factor is printed by the script itself, on the
   `inflacao` line, so it is not a claim you have to take on faith. Any
   consumption figure derived from Claude Code history without that dedup is
   wrong by roughly a factor of two.
2. **`R_h ≈ 206 req/h` is an agent session**, roughly one request every 17 s —
   not a person typing. The machine measured runs orchestration with subagents,
   which is also why "13 simultaneous sessions" is one operator's parallelism and
   not a team's concurrency.
3. These are **this** machine's numbers, and the point of publishing them is the
   order of magnitude and the method, not the digits. Run the script on yours:
   `python3 tools/measure_agent_usage.py` (no cutoff: your whole history). It
   reads only the numeric fields of `usage`, the `message.id` and the timestamp —
   no conversation content is read, aggregated or printed.

---

## Sizing table

`W_h = 5 h`, in **total** tokens, from the measured profile above.

`c = 0.6` and slack `F = 0.30` are **arbitrated, not measured** — there is no
measurement of concurrency anywhere on this page, and `c` is still marked
`[A MEDIR]` in the table of symbols. They are defaults picked inside
`tools/sizing.py` so the formula has something to resolve; the script is the
place where they were *chosen*, not evidence for them. Vary them there and
measure your own.
`[FONTE: tools/sizing.py, run on 2026-09-12 — it computes D from the
measured profile; c and F are its own hardcoded constants]`

| Profile | Developers | `U_sim` | Demand `D` inside the 5 h window | Licences |
| :--- | ---: | ---: | ---: | :--- |
| median | 3 | 1.8 | 214,905,483 tokens | `ceil(D / C_window)` |
| median | 12 | 7.2 | 859,621,932 tokens | `ceil(D / C_window)` |
| median | 40 | 24.0 | 2,865,406,440 tokens | `ceil(D / C_window)` |
| p90 | 3 | 1.8 | 827,441,503 tokens | `ceil(D / C_window)` |
| p90 | 12 | 7.2 | 3,309,766,013 tokens | `ceil(D / C_window)` |
| p90 | 40 | 24.0 | 11,032,553,376 tokens | `ceil(D / C_window)` |

The right-hand column is deliberately unresolved. This is exactly where a method
differs from an invented table: it names what is missing, in which unit, and how
to get it.

Two readings that survive the missing term, because they are ratios:

- **All the uncertainty lives in `c`, not in `N`.** `D` is a product, and
  `U_sim = N × c`, so the two are perfectly symmetric: doubling `N` and doubling
  `c` move `D` by exactly the same amount. That symmetry is the point. `N` you
  know exactly — you count chairs — while `c` is a guess that can easily be off
  by 2×, and a 2× error in `c` is a 2× error in the answer. Measuring
  concurrency is where the effort pays, not because the term is stronger, but
  because it is the only one still unknown.
- **The p90 profile is about 3.85× the median** (827,441,503 ÷ 214,905,483 at any
  team size, since `N` cancels). Sizing for the median and discovering the p90 in
  production is the usual way this goes wrong.

### Filling in `C_window`

The only place a subscription's capacity is visible is the usage screen of the
provider's own account, which shows the progress bars for the 5 h and weekly
windows `[FONTE: https://support.claude.com/en/articles/11049741-what-is-the-max-plan — read on 2026-09-12]`.

1. Wait for the window to reset and note the time.
2. Work a typical shift inside the window.
3. Read the fraction `p` consumed on the bar, and cut the history to exactly that
   period. `D_measured` is the `TOTAL GERAL token total do periodo` line:

   ```bash
   python3 tools/measure_agent_usage.py --since 2026-09-12T21:00:00Z --until 2026-09-13T02:00:00Z
   ```

   On the machine measured above, that 5 h window totals `433,749,323` tokens.
4. `C_window ≈ D_measured / p`, in total tokens.

Note that step 3 needs the **sum** over the window, not the medians — the medians
above describe one average request, and multiplying them back out is not the same
number. That is why the script prints both.

That is a measurement with a stated procedure, not a guess — and it is valid for
*that* plan, *that* model and *that* effort level, because the provider's own
page says all four factors move the result.

---

## What this synchronizer shows you about it

This is where the page stops being arithmetic. The gateway knows nothing about
requests per minute or tokens per month; what it records is **the fact that a
ceiling was reached**, and that record is the only evidence that closes the loop.

### The one field that answers the capacity question

`rateLimitedUntil`, inside the JSON `data` column of `providerConnections`. It is
**a deadline, not a flag** — it holds the instant the provider's window reopens
`[FONTE: src/nine_rtksync/models.py:173-186]`. Beside it live the
`modelLock_*` keys: locks scoped to **one model family, not the whole account**
`[FONTE: src/nine_rtksync/normalizer.py:91-99]`.

That distinction is the whole capacity story on this gateway. An account is
rarely "out"; one family is. Measured during a block, model by model: the
`ag/gemini-*` entries answered 503 while `ag/claude-opus-4-6-thinking` (3.8 s),
`ag/claude-sonnet-4-6` (1.4 s) and `ag/gpt-oss-120b-medium` (0.8 s) kept
answering on the same account
`[FONTE: https://github.com/pathbit/pathbit-ai-for-devs/blob/96a5a34/0002_claude_gravity_utilizando_9router/article/ARTICLE.md#L684-L720 — read on 2026-09-12]`.

### And the trap on the screen

The **Status** badge does not answer the capacity question, and it is worth being
explicit about that rather than letting someone discover it during an outage.
`health_status` consults `rate_limit_active` only on the API-key branch; an OAuth
connection is classified by how much life is left in its token
`[FONTE: src/nine_rtksync/models.py:189-227]`. So an Antigravity account
holding a rate-limit deadline 90 minutes into the future, plus a family lock,
reports:

```
is_oauth          : True
rate_limit_active : True
health_status     : active
```

The badge reads **Active**, and it is not lying: the credential is healthy. It
is answering a different question. The live probe cannot rescue it either — for
an OAuth connection the probe asks Google's `tokeninfo` about the *token*
`[FONTE: src/nine_rtksync/credential_check.py:238-255]`, and the `rate_limited`
state exists only for the HTTP 429 an API-key probe can receive
`[FONTE: src/nine_rtksync/credential_check.py:115-116]`. A quota-exhausted
account has a perfectly live token.

See [Dashboard](Dashboard) for what each badge does mean.

### Where the answer actually is

**1. The database.** Validated against a synthetic database with the real schema
`[FONTE: src/nine_rtksync/gateway.py:64 — the providerConnections columns]`,
run on 2026-09-12:

```bash
sqlite3 -header -column ~/.9router/data/db/data.sqlite "
SELECT name AS account,
       provider,
       CASE WHEN json_extract(data,'\$.rateLimitedUntil') IS NULL THEN '-'
            ELSE datetime(json_extract(data,'\$.rateLimitedUntil')/1000,'unixepoch') END AS account_hold_until,
       (SELECT count(*) FROM json_each(providerConnections.data)
         WHERE key LIKE 'modelLock_%') AS family_locks
FROM providerConnections ORDER BY provider, name;"
```

```
account  provider     account_hold_until   family_locks
-------  -----------  -------------------  ------------
dev-a    antigravity  2026-09-13 01:05:27  1
dev-b    antigravity  -                    0
dev-c    antigravity  -                    2
```

`dev-a` is held at the account level. `dev-c` is not held at all — it simply lost
two model families and is still serving everything else. Reading that as "two
accounts down" would buy a licence that was never needed.

**2. The scheduler log.** Every time a deadline expires, the sweep clears it and
says so in a note that reaches both the **Logs** modal on the scheduler card and
the persistent file log `[FONTE: src/nine_rtksync/daemon.py:129-135]`. The two
notes are emitted verbatim by the normalizer
`[FONTE: src/nine_rtksync/normalizer.py:89 and :99]`, the `[HEAL]` prefix is what
`log_msg` puts in front of them `[FONTE: src/nine_rtksync/daemon.py:37]`, and the
timestamp and level in front of that come from the handler's formatter,
`"[%(asctime)s] [%(levelname)s] %(message)s"`
`[FONTE: src/nine_rtksync/logs.py:90-91]`. That exact text is what makes the
greps below match at all:

```
[2026-09-12 18:04:11] [INFO] [HEAL] [antigravity · dev-a] Expired rateLimitedUntil lock successfully cleared
[2026-09-12 18:04:11] [INFO] [HEAL] [antigravity · dev-a] Temporary model lock modelLock_gemini-3.8-flash-high expired and removed
```

Which turns the file log into the counter nobody else keeps. The file is
`9rtksync.log` and retention is 30 days by default — `DEFAULT_RETENTION_DAYS = 30`,
overridable by `LOG_RETENTION_DAYS`
`[FONTE: src/nine_rtksync/logs.py:24-25 and 31-34]` — so the week of history the
rule below needs is always there (see [Logging](Logging); the shipped stack points
`LOG_DIR` at `/app/logs`):

```bash
grep -c "rateLimitedUntil lock successfully cleared" /app/logs/9rtksync.log
grep -o "modelLock_[a-z0-9.-]*" /app/logs/9rtksync.log | sort | uniq -c | sort -rn
```

**3. The state, without SQL.** `9rtksync --status` prints every connection with
its provider, type, health and remaining validity, plus the registered combos and
their cascades, and `/api/status` returns the state as JSON — with `healthStatus`,
`expiresAtMs` and `remainingSeconds` per connection
`[FONTE: src/nine_rtksync/web.py:549-561]`. Note what is **not** in that
payload: neither `rateLimitedUntil` nor `modelLock_*` is exported. For the
capacity question, use the SQL above or the log.

**The decision rule.** Count locks per account per day for a week. An account
that locks every day is under-provisioned; an account that never locks is slack
that can absorb another person. That is the only evidence that closes the
sizing; everything before it is projection.

---

## The cheapest lever: a cascade that crosses families

Because a lock is scoped to a model family, a fallback cascade that **changes
family** buys capacity without buying a licence. The synchronizer registers two
such combos by default, visible on the panel under **Resilience combos** with
their **Model cascade** `[FONTE: src/nine_rtksync/combos.py:14-36; the two labels are combos.title and
table.cascade in src/nine_rtksync/i18n.py:84-85]`:

```
claudegravity-fallback   ag/gemini-3.8-flash-high → ag/gemini-3.7-flash-high →
                         ag/gemini-3.6-flash-high → ag/claude-sonnet-4-6 →
                         ag/gpt-oss-120b-medium
```

Read that cascade against the measurement above and the honest reading is
uncomfortable: the **first three rungs fall together** — they were all 503 during
the same block — so the capacity is bought by rungs four and five, the ones that
leave the Gemini family. A cascade of five models inside one family is one model
with extra steps.

And the illusion that costs the most money, measured rather than argued:
**registering the same account twice does not double anything.** Two entries in
the gateway, one ceiling
`[FONTE: https://github.com/pathbit/pathbit-ai-for-devs/blob/96a5a34/0002_claude_gravity_utilizando_9router/article/ARTICLE.md#L716-L720 — read on 2026-09-12]`.
`L` counts **distinct accounts with their own subscription**, which is the same
number the licence text already forced.

---

## Renewal is not quota

Two different clocks, and confusing them produces the wrong diagnosis — the
wrong purchase, in this case.

| | Credential validity | Quota |
| :--- | :--- | :--- |
| Duration | ~1 h — the renewal takes the provider's `expires_in`, default 3599 s `[FONTE: src/nine_rtksync/providers/google.py:202]` | 5 h / weekly published; 2 h per family is a log observation `[FONTE: https://github.com/pathbit/pathbit-ai-for-devs/blob/96a5a34/0002_claude_gravity_utilizando_9router/article/ARTICLE.md#L689 — read on 2026-09-12]` |
| Symptom | 401, "spontaneous" disconnection | 429 / 503 |
| Field | `expiresAt` | `rateLimitedUntil`, `modelLock_*` |
| Who fixes it | automatic renewal — what this service does | wait for the window, or one more licence |
| Scales with the team? | **No** | **Yes** |

The "it logs itself out after an hour" that sends people shopping for more
accounts is a storage format, not a missing quota: 9Router writes `expiresAt` as
an ISO string where its own consumer expects epoch milliseconds, and the
normalizer converts it on every sweep
`[FONTE: src/nine_rtksync/normalizer.py:56-66]`. Neither clock belongs in the
formula, but only one of them is solved by money.

---

## Where this gateway differs

| | 9Router (this repo) | A LiteLLM proxy |
| :--- | :--- | :--- |
| What is multiplexed | subscription accounts over OAuth | virtual keys over an API credential you already own |
| What "licence" means | one subscription, one holder | nothing — it means tier and budget |
| Where the ceiling lives | inside the provider's account, invisible | declared at three levels, verifiable |
| `C_window` | `[A MEDIR]` — not published | the question does not arise: the API publishes a **per-minute** ceiling (RPM / ITPM / OTPM per tier), not a window capacity `[FONTE: https://platform.claude.com/docs/en/api/rate-limits — read on 2026-09-12]` |
| Granularity | per account **and per model family** | per key / team / platform default |
| Unit of `D` | total tokens | uncached input tokens |
| How it grows | buy an account, with a new holder | move up a tier, redistribute budget |
| Saturation signal | `rateLimitedUntil`, `modelLock_*` in SQLite | 429 plus the proxy's own spend log |

The sibling [OminiRTkSync](https://github.com/pathbit/OminiRTkSync) sizes exactly
like this column — same shape, same `[A MEDIR]`, different storage format for
the expiry. The LiteLLM-facing sibling is the one where the question changes
shape entirely: there the ceiling is declared at **three** levels and the rule is
`key ≤ team ≤ platform default`, checkable field by field — which is exactly the
sibling's subject, because LiteLLM accepts a key that declares more than its
team and then silently enforces the smaller number
`[FONTE: https://github.com/pathbit/LiteLlmRTKSync/blob/master/docs/wiki/Rate-Limit-Coherence.md — lido em 2026-09-13]`. Do not carry a
number from one column to the other.

---

## One more constraint that is not about capacity

Several sessions on one account are unremarkable. What draws attention is the
inverse — several **accounts** leaving through one address, which is the natural
shape of a gateway with everyone's account registered in it. Sizing a team up
walks straight into that, so read
[Egress and Multi-Session](Egress-And-Multi-Session) before you add the tenth
account, and note its trap: an inactive pool, or one with no address, raises no
error — the connection silently falls back to the host's address.

---

## Reproducing everything on this page

```bash
python3 tools/measure_agent_usage.py     # the demand side, on your machine
python3 tools/sizing.py                  # the tables (it prints C_window as C_janela)
9rtksync --status                        # current state of every account
```

To reproduce the exact block published above rather than measure your own, add
the cutoff it was taken at — otherwise the growing history gives a larger number
every day:

```bash
python3 tools/measure_agent_usage.py --until 2026-09-13T02:00:00Z
```

Numbers without a reproducible script become, given enough time, invented
numbers. That is why both scripts are versioned in this repository, next to this
page — `tools/measure_agent_usage.py` and `tools/sizing.py` — and why the
measured block above carries the exact `--until` cutoff it was produced with.

---

# Em português

"Somos doze devs, quantas assinaturas Max eu compro?" é a primeira pergunta
depois que o gateway sobe, e é a que esta wiki não fecha com uma tabela. Não por
falta de conta: porque **nenhuma assinatura de consumo publica a capacidade
absoluta dela**. A Anthropic publica multiplicador e janela; a OpenAI publica
faixas e em seguida diz que não são fixas; o Google remete ao painel. Um único
número do quadro inteiro vem com valor absoluto — e vem carimbado *por usuário*.

## A parte que não depende de medir nada

Para Claude Pro/Max, `L = N`. Doze devs, doze assinaturas, cada uma comprada e
autenticada pelo próprio titular. Isso não é achado de capacidade, é o texto da
licença
`[FONTE: https://code.claude.com/docs/en/legal-and-compliance — lido em 12/09/2026]`:

> "**Customers may not pay for, resell, or intermediate Claude usage on their end
> users' behalf.** Each end user must authenticate with their own Anthropic API
> key, Claude subscription plan credentials, or 3P inference provider
> credential."

O gateway não reduz esse número, e este aqui não tenta. O que ele faz é manter
vivas, legíveis e observáveis contas que **já são individuais**. É aí que ele se
paga — não em comprar menos assinatura.

Para Google AI Pro / Antigravity e para planos OpenAI, os termos equivalentes
**não foram lidos aqui**: `[A VERIFICAR: ler os termos de cada fornecedor e citar
URL + data, como foi feito com a Anthropic]`. Não presuma simetria.

## O buraco honesto

O Gemini Code Assist é a única linha do quadro com número fechado — **1.500
requisições por usuário por dia** no Standard, **2.000** no Enterprise, **2** por
segundo por usuário
`[FONTE: https://docs.cloud.google.com/gemini/docs/quotas — lido em 12/09/2026]`.
E repare na forma: não existe um pote de 1.500 que doze devs dividem; existem
doze potes de 1.500. É a mesma forma que a licença impõe acima.

Então um termo fica vazio de propósito: `[A MEDIR]` **`C_window`, a capacidade de
uma assinatura dentro da janela de reset.** Ninguém publica. Enquanto ele não for
medido, qualquer tabela "1 licença = 4 devs" é invenção.

## A fórmula e a tabela

```
U_sim = N × c
D     = U_sim × R_h × (T_tot + T_out) × W_h × (1 + F)
L     = ceil( D / C_window )
```

O perfil abaixo é um **instantâneo de uma máquina, congelado num instante** — não
uma constante. O histórico em `~/.claude/projects` cresce a cada sessão, então
rodar sem recorte dá outro número a cada dia; o recorte é o que torna o bloco
reproduzível em vez de apenas plausível:

```bash
python3 tools/measure_agent_usage.py --until 2026-09-13T02:00:00Z
```

`[FONTE: o comando acima, executado em 12/09/2026 na máquina do autor — o
recorte 2026-09-13T02:00:00Z é 23:00 no fuso local, UTC−3. Reproduz
bit a bit naquela máquina enquanto o Claude Code guardar os arquivos daquele
período; na sua ele vai imprimir os seus números, não estes.]`

Dali saem 131 sessões e 7.332 turnos **deduplicados por `message.id`** — contar
linha em vez de `id` infla a contagem em **2,37×** (17.382 linhas viram 7.332
turnos), e é o próprio script que imprime esse fator, na linha `inflacao`, sobre
a mesma população que ele usa no resto do bloco: as linhas `type: "assistant"`
com objeto `usage` de contagem positiva, timestamp legível e dentro do recorte.
`R_h` mediana 206 req/h, `T_tot` mediana 88.442 tokens, `T_out` mediana 723.
Trate `R_h` como **sessão de agente**, uma requisição a cada ~17 s, não como um
dev digitando; rode o script no seu ambiente.

**A unidade dos dois lados da divisão tem que ser a mesma.** Aqui o caminho é
assinatura, e o medidor da assinatura não publica o que conta — então `D` e
`C_window` ficam os dois em **token total**, leitura de cache inclusa. A regra
"só entrada não-cacheada conta para o ITPM" é da página de rate limits **da
API**, não do medidor de um Pro/Max, e importá-la para cá não é diferença de
arredondamento: no histórico medido a mediana da entrada total é **22,6×** a
mediana da entrada que contaria para ITPM (88.442 ÷ 3.914 — razão entre duas
medianas, serve para ordem de grandeza e não para contabilidade). Quem mistura
as duas dimensiona o time por um vigésimo da demanda dele.

`W_h = 5 h`, em **token total**, sobre o perfil medido acima.

`c = 0,6` e folga `F = 0,30` são **arbitrados, não medidos** — não há medição de
concorrência nenhuma nesta página, e `c` continua sendo um `[A MEDIR]` declarado.
São apenas os valores escolhidos dentro de `tools/sizing.py` para
que a fórmula tenha o que resolver: o script é onde eles foram *arbitrados*, não
evidência a favor deles. Varie os dois lá e meça os seus.
`[FONTE: tools/sizing.py, executado em 12/09/2026 — ele calcula D a partir do
perfil medido; c e F são constantes dele mesmo]`

| Perfil | Devs | `U_sim` | Demanda `D` na janela de 5 h | Licenças |
| :--- | ---: | ---: | ---: | :--- |
| mediana | 3 | 1,8 | 214.905.483 tokens | `ceil(D / C_window)` |
| mediana | 12 | 7,2 | 859.621.932 tokens | `ceil(D / C_window)` |
| mediana | 40 | 24,0 | 2.865.406.440 tokens | `ceil(D / C_window)` |
| p90 | 3 | 1,8 | 827.441.503 tokens | `ceil(D / C_window)` |
| p90 | 12 | 7,2 | 3.309.766.013 tokens | `ceil(D / C_window)` |
| p90 | 40 | 24,0 | 11.032.553.376 tokens | `ceil(D / C_window)` |

A coluna da direita fica em aberto de propósito. É exatamente aí que método se
separa de tabela inventada: ele diz o que falta, em que unidade e como obter.

Duas leituras sobrevivem ao termo faltante, porque são razões. A primeira: **toda
a incerteza está em `c`, não em `N`.** `D` é um produto e `U_sim = N × c`, então
os dois são perfeitamente simétricos — dobrar `N` e dobrar `c` deslocam `D`
exatamente igual. É justamente essa simetria que importa: `N` você sabe de cor,
é contar cadeira, enquanto `c` é um palpite que erra 2× com facilidade — e 2× de
erro em `c` é 2× de erro na resposta. Medir concorrência compensa não porque o
termo pese mais, mas porque é o único que ainda está desconhecido. A segunda: o
**p90 é cerca de 3,85× a mediana** (827.441.503 ÷ 214.905.483, em qualquer
tamanho de time, já que `N` se cancela).

Para preencher `C_window`: espere a janela zerar, trabalhe uma jornada típica,
leia a fração `p` consumida na tela de uso do fornecedor e recorte o histórico
exatamente naquele período. `D_medido` é a linha `TOTAL GERAL token total do
periodo`:

```bash
python3 tools/measure_agent_usage.py --since 2026-09-12T21:00:00Z --until 2026-09-13T02:00:00Z
```

Na máquina medida acima essa janela de 5 h soma `433.749.323` tokens. Daí
`C_window ≈ D_medido / p`, em token total. É a **soma** do período que entra
aqui, não as medianas: mediana descreve uma requisição média, e remultiplicá-la
não devolve o mesmo número — por isso o script imprime as duas coisas. Vale para
*aquele* plano, *aquele* modelo e *aquele* nível de esforço.

## O que este sincronizador te mostra sobre isso

O gateway não sabe nada de requisição por minuto. O que ele guarda é **o registro
de que o teto foi atingido**, e esse registro é a única evidência que fecha a
conta.

O campo é `rateLimitedUntil`, dentro da coluna JSON `data` de
`providerConnections`. Ele é **um prazo, não uma bandeira**: guarda o instante em
que a janela do provedor reabre `[FONTE: src/nine_rtksync/models.py:173-186]`. Ao
lado dele ficam as chaves `modelLock_*`, travas por **família de modelo, não pela
conta inteira** `[FONTE: src/nine_rtksync/normalizer.py:91-99]`. Durante um
bloqueio medido, `ag/gemini-*` devolvia 503 enquanto `ag/claude-opus-4-6-thinking`
(3,8 s), `ag/claude-sonnet-4-6` (1,4 s) e `ag/gpt-oss-120b-medium` (0,8 s)
seguiam respondendo na mesma conta
`[FONTE: https://github.com/pathbit/pathbit-ai-for-devs/blob/96a5a34/0002_claude_gravity_utilizando_9router/article/ARTICLE.md#L684-L720 — lido em 12/09/2026]`.

**E a armadilha da tela.** O badge **Status** não responde à pergunta de
capacidade. `health_status` consulta `rate_limit_active` só no ramo de chave de
API; conexão OAuth é classificada pelo que resta de vida no token
`[FONTE: src/nine_rtksync/models.py:189-227]`. Uma conta Antigravity com prazo de
rate limit 90 minutos à frente e uma trava de família reporta:

```
is_oauth          : True
rate_limit_active : True
health_status     : active
```

O badge diz **Active** e não está mentindo — a credencial está saudável. Ele
responde outra pergunta. A sondagem também não salva: para OAuth ela pergunta ao
`tokeninfo` do Google sobre o *token*
`[FONTE: src/nine_rtksync/credential_check.py:238-255]`, e o estado
`rate_limited` só existe para o 429 que uma sondagem de chave recebe
`[FONTE: src/nine_rtksync/credential_check.py:115-116]`. Conta sem cota tem token
vivo. Veja [Dashboard](Dashboard) para o que cada badge de fato significa.

**Onde a resposta está.** No banco, com a consulta validada contra um banco
sintético de mesmo esquema (12/09/2026):

```bash
sqlite3 -header -column ~/.9router/data/db/data.sqlite "
SELECT name AS account,
       provider,
       CASE WHEN json_extract(data,'\$.rateLimitedUntil') IS NULL THEN '-'
            ELSE datetime(json_extract(data,'\$.rateLimitedUntil')/1000,'unixepoch') END AS account_hold_until,
       (SELECT count(*) FROM json_each(providerConnections.data)
         WHERE key LIKE 'modelLock_%') AS family_locks
FROM providerConnections ORDER BY provider, name;"
```

```
account  provider     account_hold_until   family_locks
-------  -----------  -------------------  ------------
dev-a    antigravity  2026-09-13 01:05:27  1
dev-b    antigravity  -                    0
dev-c    antigravity  -                    2
```

`dev-a` está travada no nível da conta. `dev-c` não está travada: perdeu duas
famílias e continua servindo o resto. Ler isso como "duas contas fora" compra
licença que não faltava.

E no log: cada prazo vencido é limpo e anunciado numa nota que chega ao modal
**Logs** do agendador e ao log em arquivo
`[FONTE: src/nine_rtksync/daemon.py:129-135]`. As duas notas saem literalmente do
normalizador `[FONTE: src/nine_rtksync/normalizer.py:89 e :99]`, o prefixo
`[HEAL]` é o que o `log_msg` põe na frente delas
`[FONTE: src/nine_rtksync/daemon.py:37]`, e a data e o nível que vêm antes disso
são do formatador do handler, `"[%(asctime)s] [%(levelname)s] %(message)s"`
`[FONTE: src/nine_rtksync/logs.py:90-91]`. É esse texto exato que faz os `grep`
abaixo casarem. O arquivo é o `9rtksync.log`, com
retenção de 30 dias por padrão — `DEFAULT_RETENTION_DAYS = 30`, ajustável por
`LOG_RETENTION_DAYS` `[FONTE: src/nine_rtksync/logs.py:24-25 e 31-34]` — o que dá
a semana de histórico que a regra abaixo pede (veja [Logging](Logging); a stack de
exemplo aponta `LOG_DIR` para `/app/logs`):

```bash
grep -c "rateLimitedUntil lock successfully cleared" /app/logs/9rtksync.log
grep -o "modelLock_[a-z0-9.-]*" /app/logs/9rtksync.log | sort | uniq -c | sort -rn
```

Sem SQL, `9rtksync --status` imprime cada conexão com provedor, tipo, saúde e
validade restante, mais os combos e suas cascatas, e `/api/status` devolve
`healthStatus`, `expiresAtMs` e `remainingSeconds`
`[FONTE: src/nine_rtksync/web.py:549-561]` — mas repare no que **não** vai
nesse payload: nem `rateLimitedUntil` nem `modelLock_*`. Para capacidade, use o
SQL ou o log.

**Regra de decisão:** conte travas por conta por dia durante uma semana. Conta
que trava todo dia está subdimensionada; conta que nunca trava é folga que
absorve mais gente. O resto é projeção.

## A alavanca mais barata

Como a trava é por família, uma cascata que **muda de família** compra capacidade
sem comprar licença. O sincronizador registra combos assim por padrão, visíveis
no painel em **Resilience combos** com a **Model cascade**
`[FONTE: src/nine_rtksync/combos.py:14-36; os dois rótulos são combos.title e
table.cascade em src/nine_rtksync/i18n.py:84-85]`:

```
claudegravity-fallback   ag/gemini-3.8-flash-high → ag/gemini-3.7-flash-high →
                         ag/gemini-3.6-flash-high → ag/claude-sonnet-4-6 →
                         ag/gpt-oss-120b-medium
```

Lida contra a medição acima, a leitura honesta incomoda: os **três primeiros
degraus caem juntos** — todos deram 503 no mesmo bloqueio — então quem compra
capacidade é o quarto e o quinto, os que saem da família Gemini. Cascata de cinco
modelos dentro de uma família é um modelo com passos a mais.

E a ilusão mais cara, medida e não argumentada: **cadastrar a mesma conta duas
vezes não dobra nada.** Duas entradas no gateway, um teto só
`[FONTE: https://github.com/pathbit/pathbit-ai-for-devs/blob/96a5a34/0002_claude_gravity_utilizando_9router/article/ARTICLE.md#L716-L720 — lido em 12/09/2026]`.
`L` conta **contas distintas com assinatura própria** — o mesmo número que a
licença já obrigava.

## Renovação não é cota

| | Validade da credencial | Cota |
| :--- | :--- | :--- |
| Duração | ~1 h — a renovação usa o `expires_in` do provedor, padrão 3599 s `[FONTE: src/nine_rtksync/providers/google.py:202]` | 5 h / semanal, publicado; 2 h por família é observação de log `[FONTE: https://github.com/pathbit/pathbit-ai-for-devs/blob/96a5a34/0002_claude_gravity_utilizando_9router/article/ARTICLE.md#L689 — lido em 12/09/2026]` |
| Sintoma | 401, desconexão "espontânea" | 429 / 503 |
| Campo | `expiresAt` | `rateLimitedUntil`, `modelLock_*` |
| Quem resolve | renovação automática — o que este serviço faz | esperar a janela, ou mais uma licença |
| Escala com o time? | **Não** | **Sim** |

O "desconecta sozinho depois de uma hora" que manda gente comprar conta nova é
formato de gravação, não falta de cota: o 9Router grava `expiresAt` como string
ISO onde o consumidor dele espera epoch em milissegundos, e o normalizador
converte a cada varredura `[FONTE: src/nine_rtksync/normalizer.py:56-66]`.
Nenhum dos dois relógios entra na fórmula — mas só um deles se resolve com
dinheiro.

## Onde este gateway difere

Aqui o que se multiplexa é **conta de assinatura**, e "licença" quer dizer uma
assinatura com um titular; o teto vive dentro da conta do fornecedor, invisível,
com granularidade por conta **e por família**; a unidade de `D` é token total; e
cresce comprando conta, com titular novo. Num proxy LiteLLM a pergunta muda de
forma: lá se repartem chaves virtuais sobre uma credencial de API que já é sua e
o teto é declarado em **três** níveis, com a regra `chave ≤ time ≤ padrão da
plataforma`, conferível campo a campo — que é exatamente o assunto do irmão,
porque o LiteLLM aceita uma chave declarando mais que o time dela e depois impõe
o número menor em silêncio
`[FONTE: https://github.com/pathbit/LiteLlmRTKSync/blob/master/docs/wiki/Rate-Limit-Coherence.md — lido em 2026-09-13]`. E `C_window` nem
chega a existir daquele lado: o que a API publica é teto **por minuto**
(RPM / ITPM / OTPM por tier), não capacidade de janela
`[FONTE: https://platform.claude.com/docs/en/api/rate-limits — lido em 12/09/2026]`.
Não carregue número de uma coluna para a outra. O irmão
[OminiRTkSync](https://github.com/pathbit/OminiRTkSync) dimensiona igual a esta
coluna: mesma forma, mesmo `[A MEDIR]`, formato de expiração diferente.

## Uma restrição que não é de capacidade

Várias sessões numa conta não incomodam. O que chama atenção é o inverso: várias
**contas** saindo pelo mesmo endereço, que é a forma natural de um gateway com a
conta de todo mundo cadastrada. Crescer o time cai direto nisso — leia
[Egress and Multi-Session](Egress-And-Multi-Session) antes da décima conta, e
note a armadilha: pool inativo, ou sem endereço, não gera erro; a conexão cai em
silêncio para o endereço do host.

## Reproduzindo

```bash
python3 tools/measure_agent_usage.py     # o lado da demanda, na sua máquina
python3 tools/sizing.py                  # as tabelas (ele imprime C_window como C_janela)
9rtksync --status                        # estado corrente de cada conta
```

Para reproduzir o bloco publicado acima em vez de medir o seu, acrescente o
recorte com que ele foi tirado — sem isso o histórico, que cresce, devolve um
número maior a cada dia:

```bash
python3 tools/measure_agent_usage.py --until 2026-09-13T02:00:00Z
```

Número sem script reproduzível vira, com o tempo, número inventado. É por isso
que os dois scripts estão versionados neste repositório, ao lado desta página —
`tools/measure_agent_usage.py` e `tools/sizing.py` — e por isso que o bloco
medido acima carrega o recorte `--until` exato com que foi produzido.
