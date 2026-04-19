# The Gateway Test Fleet — a Practical Walk-Through

This folder is a **small, runnable town** of five AI agents plus a
mayor who coordinates them. You can start the town on your laptop,
ask the mayor a question, and watch her decide which townspeople to
call, in what order, to get you a real answer.

If you haven't worked with AI agents before, that's fine. Read on in
order — each section builds on the one before it. By the end you'll
have a working feel for:

- What an "agent" is, in practice
- Why we have a "gateway" in the middle
- How a plan gets turned into real agent calls
- What can go wrong, and how to read the logs

---

## Part 1 — The cast of characters

Five agents, each good at one thing and stubborn about saying no to
everything else. Narrow scope is the point — it makes mistakes visible.

| Agent | Port | What it does | How it behaves off-topic |
|---|---|---|---|
| **joke**     | 3773 | Tells jokes on request | Politely refuses, offers to joke about something else |
| **math**     | 3775 | Solves math problems, step-by-step | Politely refuses non-math |
| **poet**     | 3776 | Writes 4-line poems | Politely refuses if it's not a poem request |
| **research** | 3777 | Looks things up on the web via DuckDuckGo, summarizes with sources | Does its best — no hard refusal |
| **faq**      | 3778 | Answers questions about the Bindu framework specifically | Falls back to general research if the answer isn't in the docs |

All five run on your laptop, each listening on its own HTTP port.
Each is a plain Python program — look inside `joke_agent.py` and
you'll see a tiny file that wires an OpenRouter-backed language
model to a few lines of instructions.

Each agent has a **DID** — a cryptographic identity it earned when
it first started up. You don't need to know the details yet; just
know that the gateway uses the DID to prove to each agent "yes, I'm
really me" on every call.

---

## Part 2 — The mayor (the gateway)

Five agents by themselves aren't very interesting. You'd have to
know ahead of time which one to ask, format your message correctly
for each one, and paste together the answers yourself. That's
tedious.

The **gateway** is the mayor. She listens on port 3774. When you
send her a question, she:

1. Reads your question.
2. Reads the list of agents you said she's allowed to call (the
   "agent catalog" — you pass this along with your question).
3. Decides which agents to call, in what order, and what to ask
   each one.
4. Calls them. Collects their answers.
5. Writes you a final answer that uses what they all said.

She is, herself, an AI — one that was specifically trained to be
good at planning multi-step work across tools. The tool it uses are
the five agents you gave her.

The gateway's own language model runs on OpenRouter too, but she
uses a stronger model (Claude Sonnet 4.6 by default) because
planning is harder than just "tell me a joke."

---

## Part 3 — Setting up

You'll need:

- **Python 3.12+** and `uv` — our package manager for the agents.
- **Node.js 22+** and `npm` — for the gateway, which is TypeScript.
- **An OpenRouter API key** — this is what pays for the language
  models. Get one from [openrouter.ai](https://openrouter.ai). Add
  a few dollars of credit.
- **Supabase credentials** — the gateway uses a tiny database to
  remember what it's done. There's a shared dev instance linked
  from `gateway/.env.example`.

One-time setup:

```bash
# Install Python agent dependencies
uv sync --dev --extra agents

# Install gateway TypeScript dependencies
cd gateway && npm install && cd ..
```

Then configure your environment. Copy and fill in two files:

```bash
cp gateway/.env.example gateway/.env.local
# Then edit gateway/.env.local — paste your real OPENROUTER_API_KEY,
# your Supabase URL + key, and generate a strong GATEWAY_API_KEY
# (openssl rand -base64 32 | tr -d '=' | tr '+/' '-_').
```

The `examples/.env` file is already set up for the agents — it just
needs the same OpenRouter key.

### One more thing — identity for the gateway

If you want the gateway to call the agents in "signed" mode (which
proves to each agent "yes, this is really me"), you also need to
give the gateway its own DID. Append to `gateway/.env.local`:

```bash
# Generate a seed (one time — treat this like a password)
#   python3 -c "import os, base64; print(base64.b64encode(os.urandom(32)).decode())"
BINDU_GATEWAY_DID_SEED=<paste the seed>
BINDU_GATEWAY_AUTHOR=you@example.com
BINDU_GATEWAY_NAME=gateway

# Where to register that identity (Hydra is our OAuth server)
BINDU_GATEWAY_HYDRA_ADMIN_URL=https://hydra-admin.getbindu.com
BINDU_GATEWAY_HYDRA_TOKEN_URL=https://hydra.getbindu.com/oauth2/token
```

On first startup, the gateway will register that identity
automatically. You'll see confirmation in the logs.

---

## Part 4 — Starting everything up

Open two terminal windows.

**Window 1 — start the five agents.**

```bash
./examples/gateway_test_fleet/start_fleet.sh
```

This starts all five agent programs in the background. Each logs
to `examples/gateway_test_fleet/logs/<agent>.log`. You should see
five lines ending in "started, pid=...". Leave this window be.

**Window 2 — start the gateway.**

```bash
cd gateway
npm run dev
```

You should see, in order:

```
[bindu-gateway] DID identity loaded: did:bindu:...
[bindu-gateway] registering with Hydra at https://hydra-admin.getbindu.com...
[bindu-gateway] Hydra registration confirmed for did:bindu:...
[bindu-gateway] publishing DID document at /.well-known/did.json
[bindu-gateway] listening on http://0.0.0.0:3774
```

That's the gateway saying "I'm ready."

### Quick sanity checks

All six services should answer a cheap ping:

```bash
# Gateway
curl http://localhost:3774/health
# Each agent
for port in 3773 3775 3776 3777 3778; do
  echo "port $port:"
  curl -s http://localhost:$port/.well-known/agent.json | python3 -m json.tool | head -3
done
```

If anything fails to respond, check that terminal's log.

---

## Part 5 — Asking the gateway a question

The gateway has exactly one endpoint: `POST /plan`. You send her a
question and an agent catalog, she streams back a live transcript
of what she's doing.

The easy way is the bundled runner:

```bash
# Load the gateway credentials into your shell
set -a && source gateway/.env.local && set +a

# Run one of the prepared questions
./examples/gateway_test_fleet/run_matrix.sh Q1
```

`Q1` is the simplest case — "Tell me a joke about databases." The
runner sends that to the gateway with a catalog of just one agent
(`joke`) and prints a summary of what happens.

Real output looks like this:

```
▶ Q1
  plan=1  final=1  done=1  error=0  → ok
```

That's the summary. The full transcript — the "stream" of events —
lives in `examples/gateway_test_fleet/logs/Q1.sse`. Open it. You'll
see a sequence of events:

```
event: session        — the gateway opened a session
event: plan           — the planner committed to a plan
event: task.started   — she's calling the joke agent
event: task.artifact  — the joke agent replied: here's its text
event: task.finished  — that call is done
event: text.delta     — she's now streaming her own answer to you
event: text.delta     — (many of these — each is one or two words)
...
event: final          — her full final answer
event: done           — she's finished
```

Each `task.started` tells you which agent got called. Each
`text.delta` is a piece of the final answer as she generates it.
If something goes wrong, you'll see `event: error` instead of
`final`.

---

## Part 6 — The thirteen test cases

`run_matrix.sh` has thirteen prepared questions, chosen to exercise
different parts of the system. Run all of them:

```bash
./examples/gateway_test_fleet/run_matrix.sh
```

Or one:

```bash
./examples/gateway_test_fleet/run_matrix.sh Q_MULTIHOP
```

Here's what each tests:

### Basic routing
- **Q1** — "Tell me a joke." Simplest possible single-agent call.
- **Q2** — "Solve 17 × 23." Sent to joke agent only. Tests that
  the agent refuses off-topic cleanly.
- **Q3** — "Solve 12 + 5, then write a poem." Two agents, both
  needed. Order doesn't strictly matter here.

### Tricky routing
- **Q4** — "Make me smile." Ambiguous. Either joke or poem works.
  Tests the planner's judgment.
- **Q5** — "asdkjfh akjdhf." Nonsense. Planner should handle without
  crashing.
- **Q6** — empty question. Rejected with a clean **HTTP 400** at
  the API boundary (not a crash mid-stream).

### Failure modes
- **Q7** — catalog points at `localhost:39999` (nothing there).
  The tool call fails; the planner apologizes gracefully.
- **Q8** — catalog uses a bogus bearer token. Agent rejects the
  call; planner handles the rejection.
- **Q9** — catalog declares a skill the agent doesn't actually
  have. Planner calls it; agent responds as best it can.

### Size + preferences
- **Q10** — fixed 30-second timeout. Sends a simple research
  question. Confirms timeout settings round-trip correctly.
- **Q11** — 10KB of junk context before the question. Tests that
  the gateway doesn't silently truncate large inputs.
- **Q12** — catalog lists all five agents. Only one is relevant.
  Tests that the planner doesn't dispatch unnecessarily.

### The full demo — multi-hop chaining
- **Q_MULTIHOP** — **three agents in a row, each needs the last
  one's answer.** "Research Tokyo's population, compute 0.5% of
  it, then write a 4-line poem celebrating that number of people."

The Q_MULTIHOP transcript is the best thing to read end-to-end —
it shows the planner genuinely orchestrating work. A real run:

1. `research` returns "~36.95 million" with two sources.
2. `math` computes `0.5% × 36,950,000 = 184,750`.
3. `poet` writes a four-line poem about 184,750 people.
4. The planner writes a final Markdown-formatted summary that
   weaves all three together.

All in one `/plan` call. You didn't coordinate anything.

---

## Part 7 — Reading the logs when something breaks

**Gateway boot failure** — read the gateway terminal. The Effect-
wrapped error messages are long but the bottom line usually names
a specific thing (`SUPABASE_URL`, `OPENROUTER_API_KEY`, `Hydra
registration`) that's missing or wrong.

**Every agent returns "User not found."** — your
`OPENROUTER_API_KEY` is invalid or revoked. Verify with:

```bash
key=$(grep '^OPENROUTER_API_KEY' examples/.env | cut -d'=' -f2-)
curl -H "Authorization: Bearer $key" https://openrouter.ai/api/v1/auth/key
```

If that returns 401, get a fresh key from openrouter.ai and update
both `examples/.env` and `gateway/.env.local`. Restart the fleet.

**Matrix case returns `error`** — open its `.sse` log file. The
event marked `event: error` contains the server-side message. Most
common causes:

- A provider (OpenRouter) returned 4xx — usually API-key or credit
  related.
- The request body didn't match the API schema — check the
  `invalid_request` error detail.

**Prompt caching is (or isn't) working** — look for
`cachedInputTokens` in the `event: final` data. It's 0 for short
requests (Anthropic only caches prompts over 2,048 tokens). It
goes positive when the planner makes multiple LLM calls within one
plan (like Q_MULTIHOP, which gets ~27% cache hits).

---

## Part 8 — Tearing it all down

```bash
./examples/gateway_test_fleet/stop_fleet.sh
```

Stops the five agents cleanly. The gateway you stop with Ctrl-C in
its terminal.

Hydra client registrations (for the gateway's DID) are left alone —
they're idempotent, safe to leave, safe to re-register next time.

---

## Glossary

**Agent** — a program that does one specific job (tell jokes, solve
math, etc.) when you send it a message.

**A2A** — the HTTP protocol all Bindu agents speak. Short for
"agent-to-agent." Details in `docs/`.

**DID** — a long cryptographic identifier unique to each agent (and
to the gateway). Like a passport — hard to forge, portable, not
issued by any central company.

**Hydra** — our OAuth 2.0 server. It hands out short-lived bearer
tokens the gateway uses to prove its identity when calling agents.

**OpenRouter** — a paid service that proxies to dozens of language
models (OpenAI, Anthropic, Google, etc.) under one API. We use it
so you don't need five separate model-provider accounts.

**Gateway** — the mayor. A TypeScript program on port 3774 that
coordinates multi-agent work.

**Planner** — the AI inside the gateway that decides which agents
to call, in what order. It's a language model with special
instructions.

**SSE** — "Server-Sent Events." The streaming format the gateway
uses to send you live updates as a plan runs. Each `event:` line
is one update.

**/plan** — the gateway's one HTTP endpoint. Send a JSON body with
your question + agent catalog. Get a live stream of events back.

**Tool** — in planner-speak, a function the AI can call. In our
setup, each agent's skill becomes one tool named
`call_{agentName}_{skillId}`.

---

## Where to go next

- Watch the `.sse` transcripts for each case — they're surprisingly
  readable and teach more than any doc.
- Read `agents/planner.md` in the `gateway/` directory. That's the
  instructions the planner AI follows.
- Change something in one of the fresh agents (`joke_agent.py`,
  `math_agent.py`, `poet_agent.py`) — make it answer differently,
  restart, re-run the matrix, see how the gateway handles the
  change. This is the fastest way to build intuition.
