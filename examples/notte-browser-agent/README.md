# Notte Browser Agent

A Bindu agent that uses [Notte](https://notte.cc) for real-browser automation — navigates JavaScript-rendered pages, fills forms, handles authenticated sessions, solves captchas, and returns Pydantic-validated structured output.

Notte is unusual among agent building blocks in that it ships both the runtime (a cloud/local Chromium browser with stealth, proxies, and Vault-backed auth) **and** the agent loop. This example wraps that combined runtime as a Bindu microservice with one call to `bindufy(...)`.

## 🌐 Features

### Core Capabilities
- **Real browser**: Cloud Chromium/Firefox session per request — JavaScript renders, forms submit, cookies persist. Not HTTP scraping.
- **Structured output**: Pass a Pydantic `BaseModel` as `response_format` and get schema-validated JSON back.
- **Authenticated flows**: `client.Vault()` for safe credential handling; `session.set_cookies(...)` for pre-auth sessions. Credentials never enter the task string.
- **Captcha solving**: `solve_captchas=True` on the Session handles captchas automatically.
- **Proxies**: Built-in proxy support, including geolocated proxies via `NotteProxy.from_country(...)`.
- **Multi-step workflows**: Natural-language task routed through a configurable agent loop (`max_steps`, `reasoning_model`).

### 🔧 Technical Features
- **Runtime**: Notte hosted cloud (default) or local Chromium via `patchright`.
- **Agent loop**: Built into the Notte SDK — no external framework required.
- **Reasoning model**: Any LiteLLM-style string. Default `gemini/gemini-2.5-flash`; escalate to `anthropic/claude-sonnet-4-5` or `openai/gpt-4.1` for harder flows.
- **Bindu integration**: `bindufy(...)` wraps the handler with A2A protocol, DID identity, and skill routing.
- **Skill**: [`skills/notte-browser-skill`](./skills/notte-browser-skill/skill.yaml) advertises browser-automation capability so other agents can discover and delegate to this one.

## 🚀 Quick Start

### Prerequisites
- Python 3.12+
- Notte API key ([get one at console.notte.cc](https://console.notte.cc))
- UV package manager

### Installation & Setup

1. **Navigate to Bindu root**:
   ```bash
   cd /path/to/bindu
   ```

2. **Install Notte alongside Bindu**:
   ```bash
   uv add notte
   # or, inside a project venv:
   # pip install notte
   ```

3. **Configure environment**:
   ```bash
   cp examples/notte-browser-agent/.env.example examples/notte-browser-agent/.env
   # Edit examples/notte-browser-agent/.env and set NOTTE_API_KEY
   ```

4. **Run the agent**:
   ```bash
   uv run python examples/notte-browser-agent/notte_browser_agent.py
   ```

   The Bindu service starts on `http://localhost:3773` by default. Set `BINDU_DEPLOYMENT_URL` or `BINDU_PORT` to override.

## 📡 Usage Examples

### Direct invocation
```python
messages = [
    {
        "role": "user",
        "content": (
            "Go to news.ycombinator.com and return the top 5 posts as JSON "
            "with title, url, points, and author."
        ),
    }
]
```

### Supported query types
- **Data extraction from dynamic pages**: "Extract product listings from [URL]" — pages that won't respond to `curl` or `requests`.
- **Authenticated flows**: "Log in to [URL] and download the latest invoice." Pair with `client.Vault()` for real credentials.
- **Multi-step workflows**: "Search [query] on [site], apply [filter], and return the top result as JSON."
- **Captcha / proxy-gated sites**: Set `NOTTE_SOLVE_CAPTCHAS=true` or `NOTTE_USE_PROXIES=true` in `.env`.
- **E-commerce**: "Find [product] on [shop], select the right variant, and return the final price."

## ⚙️ Configuration

All runtime options are read from `.env`:

| Variable | Default | What it does |
|---|---|---|
| `NOTTE_API_KEY` | *(required)* | Hosted-mode API key from console.notte.cc |
| `NOTTE_REASONING_MODEL` | `gemini/gemini-2.5-flash` | LiteLLM-style model string used by the Notte agent |
| `NOTTE_MAX_STEPS` | `15` | Hard cap on agent iterations per task |
| `NOTTE_SOLVE_CAPTCHAS` | `false` | Enable automatic captcha solving on the Session |
| `NOTTE_USE_PROXIES` | `false` | Route traffic through Notte's managed proxies |
| `BINDU_DEPLOYMENT_URL` | `http://localhost:3773` | Where the Bindu service binds |

## 🗂️ Project Structure

```
notte-browser-agent/
├── notte_browser_agent.py      # Main agent implementation
├── .env                        # Environment variables (API keys)
├── .env.example                # Environment variables template
├── skills/
│   └── notte-browser-skill/
│       └── skill.yaml          # Skill metadata — browser automation capability
└── README.md                   # This file
```

## 🔍 Troubleshooting

#### `NOTTE_API_KEY not set`
Ensure `.env` exists in `examples/notte-browser-agent/` with a real key from https://console.notte.cc. `load_dotenv()` reads the local `.env`.

#### `ModuleNotFoundError: No module named 'notte_sdk'`
Run `uv add notte` (or `pip install notte` inside your venv).

#### Agent returns no answer / "ran out of steps"
Raise `NOTTE_MAX_STEPS` in `.env`, or switch `NOTTE_REASONING_MODEL` to a stronger model (e.g. `anthropic/claude-sonnet-4-5`). Don't just retry with the same config — it will fail identically.

#### Captcha / bot-detection blocks the run
Set `NOTTE_SOLVE_CAPTCHAS=true` and optionally `NOTTE_USE_PROXIES=true` in `.env`.

#### Credentials in logs
Never paste raw credentials into the task string — route them through `client.Vault()` instead. See the [Notte auth docs](https://docs.notte.cc) and the hosted skill at [`agent-skill-notte`](https://github.com/nottelabs/agent-skill-notte).

## 🔗 References

- **Notte SDK source**: https://github.com/nottelabs/notte
- **Notte docs**: https://docs.notte.cc
- **Notte console (API keys)**: https://console.notte.cc
- **Notte Agent Skill (Claude Code / Cursor / Goose / 30+ clients)**: https://github.com/nottelabs/agent-skill-notte

---

**Built with ❤️ using the Bindu Agent Framework + Notte**
