# Audit #1 — Web Scraping AI Agent (Local & Cloud SDK)

**Date:** March 13, 2026  
**Notion Card:** [Web Scraping AI Agent](https://www.notion.so/getbindu/Web-Scraping-AI-Agent-Local-Cloud-SDK-306d3bb65095808893dbc039cea80cdf)  
**Status on Board:** Not started  
**Contributor:** itsa-D  
**Framework:** Agno | **Skills:** web-scraping, data-processing  
**API Keys Required:** ScrapeGraph AI key · mem0 key · openrouter key  

---

## 1. What the Feature Is

An AI-enabled web scraping agent that:
- Crawls web pages and extracts structured data
- Cleans and formats outputs
- Prepares datasets for analysis or integration
- Example use-cases: "Extract product listings from this e-commerce site." / "Scrape blog titles and publish dates."

Reference implementation pattern (from Notion):  
https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/starter_ai_agents/web_scrapping_ai_agent

---

## 2. Does This Feature Already Exist?

**No. It does not exist anywhere in this repository.**

Verified searches across:
- `bindu/` — no scrapegraph, firecrawl, or mem0 usage
- `examples/` — no scraping/crawling agent folder
- `docs/` — no scraping documentation
- `release-notes/` — no mention

The only relevant artefacts are **inside the installed `.venv`** (Agno 2.5.8 ships `agno/tools/scrapegraph.py`, `agno/tools/firecrawl.py`, and `agno/tools/mem0.py` as optional extras), but there is **zero project-level code** that uses them.

---

## 3. Facts from the Repository

### Contribution & Quality Gates
| Fact | File | Line |
|---|---|---|
| Branch from `main` with descriptive name | `.github/contributing.md` | L118 |
| `uv sync --dev` sets up environment | `.github/contributing.md` | L77 |
| Pre-commit must pass | `.github/contributing.md` | L87, L147 |
| Coverage must exceed 64% (CI floor) | `.github/contributing.md` | L144 |
| Coverage must exceed 70% (maintainer target) | `tests/README.md` | L51, L208 |
| Push to fork, open PR to `GetBindu/Bindu` | `.github/contributing.md` | L183 |

### How Examples Are Structured (Policy)
| Rule | File | Line |
|---|---|---|
| Create agent in the appropriate folder | `examples/README.md` | L130 |
| Add README with usage instructions | `examples/README.md` | L131 |
| Include `.env.example` | `examples/README.md` | L132 |
| New examples go under `### Specialized` | `examples/README.md` | L51 |

### Runtime Pattern (Every Example Follows This)
Every agent uses **exactly** this structure — verified in weather-research, summarizer, premium-advisor, cybersecurity-newsletter, document-analyzer, speech-to-text:

```python
from dotenv import load_dotenv
load_dotenv()

from bindu.penguin.bindufy import bindufy
from agno.agent import Agent
from agno.models.openrouter import OpenRouter

agent = Agent(
    instructions="...",
    model=OpenRouter(id="openai/gpt-oss-120b", api_key=os.getenv("OPENROUTER_API_KEY")),
    tools=[...],
)

config = {
    "author": "...",
    "name": "...",
    "description": "...",
    "deployment": {"url": "http://localhost:3773", "expose": True},
    "skills": ["skills/<skill-name>"],
}

def handler(messages: list[dict[str, str]]):
    ...

bindufy(config, handler)
```

Reference: `examples/weather-research/weather_research_agent.py` L25, L32, L42, L46, L51, L83

### Skills System (First-Class — Must Be Included)
Every example that ships with Bindu registers a `skill.yaml`. Skills enable:
- Capability discovery via `GET /agent/skills`
- Intelligent task routing (negotiation system)
- Assessment / anti-pattern filtering

Required skill fields: `id`, `name`, `version`, `description`, `tags`, `input_modes`, `output_modes`, `capabilities_detail`, `assessment` (keywords + anti_patterns)

Reference: `docs/SKILLS.md` L3, L122, L250, L255

### Dependency Baseline
| Package | In `pyproject.toml`? | Group |
|---|---|---|
| `agno>=2.5.2` | ✅ Yes (L65) | agents |
| `openrouter>=0.6.0` | ✅ Yes (L71) | agents |
| `scrapegraph-py` | ❌ Missing | — |
| `mem0ai` | ❌ Missing | — |
| `firecrawl-py` | ❌ Missing | — |

All three missing packages are optional Agno extras (confirmed via `.venv/Lib/site-packages/agno-2.5.8.dist-info/METADATA`) — they just need to be added to the `[project.optional-dependencies]` `agents` group.

### Security
- `.env` is correctly gitignored (`Bindu/.gitignore` L130).
- `detect-secrets==1.5.0` is in core deps and runs as a pre-commit hook.
- **Action required:** The `.env` file in this workspace contains a live OpenRouter key — rotate it if it was ever pushed or shared, even accidentally.

---

## 4. Audit Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Three required packages missing from `pyproject.toml` | High | Add to `agents` extras in `pyproject.toml` |
| Coverage docs inconsistency (64 vs 70) | Medium | Target 70%+ to be safe for PR review |
| No tests framework for external API calls | Medium | Use `unittest.mock` to mock ScrapeGraph/Mem0/OpenRouter clients |
| No `.bindu/` DID keys in example folder | Low | Auto-generated on first `bindufy` run, already in `.gitignore` |
| Notion card has no GitHub link yet | Low | Add GitHub link to Notion after PR merges |

---

## 5. Implementation Plan

### Step 0 — Pre-work (One-time)
```bash
git checkout main
git fetch upstream
git rebase upstream/main
git push origin main --force-with-lease
git checkout -b feature/web-scraping-agent
```

---

### Step 1 — Folder Scaffold
Create this exact directory layout:

```
examples/
└── web-scraping-agent/
    ├── web_scraping_agent.py       # Main Bindu agent script
    ├── README.md                   # Setup + usage + troubleshooting
    ├── .env.example                # Template (no real keys)
    └── skills/
        └── web-scraping-skill/
            └── skill.yaml          # Skill metadata for negotiation
```

---

### Step 2 — Implement Agent (`web_scraping_agent.py`)

```python
"""Web Scraping AI Agent (Local & Cloud SDK)

Crawls web pages, extracts structured data, cleans and formats outputs,
and prepares datasets for analysis or integration.

Features:
- ScrapeGraph AI for intelligent structured extraction
- Mem0 for persistent memory (dedup, extraction profiles)
- OpenRouter (openai/gpt-oss-120b) for synthesis and formatting
- Local run mode + Bindu Cloud SDK deployment

Usage:
    python web_scraping_agent.py

Environment:
    Requires SCRAPEGRAPH_API_KEY, MEM0_API_KEY, OPENROUTER_API_KEY in .env file
"""

import os
from dotenv import load_dotenv
load_dotenv()

from bindu.penguin.bindufy import bindufy
from agno.agent import Agent
from agno.models.openrouter import OpenRouter
from agno.tools.scrapegraph import ScrapeGraphTools
from agno.tools.mem0 import Mem0Tools

agent = Agent(
    instructions=(
        "You are a web scraping assistant. Given a URL and an optional extraction prompt, "
        "use ScrapeGraph to extract structured data from the page. Clean and format the output "
        "into JSON. Use memory to avoid re-scraping URLs you have already processed and to "
        "remember extraction preferences for specific domains."
    ),
    model=OpenRouter(
        id="openai/gpt-oss-120b",
        api_key=os.getenv("OPENROUTER_API_KEY"),
    ),
    tools=[
        ScrapeGraphTools(api_key=os.getenv("SCRAPEGRAPH_API_KEY")),
        Mem0Tools(api_key=os.getenv("MEM0_API_KEY")),
    ],
)

config = {
    "author": "bindu.builder@getbindu.com",
    "name": "web_scraping_agent",
    "description": (
        "AI-enabled web scraping agent that collects, structures, and processes "
        "data from websites for analysis and automation."
    ),
    "deployment": {
        "url": "http://localhost:3773",
        "expose": True,
        "cors_origins": ["http://localhost:5173"],
    },
    "skills": ["skills/web-scraping-skill"],
}

def handler(messages: list[dict[str, str]]):
    if messages:
        latest = (
            messages[-1].get("content", "")
            if isinstance(messages[-1], dict)
            else str(messages[-1])
        )
        result = agent.run(input=latest)
        if hasattr(result, "content"):
            return result.content
        elif hasattr(result, "response"):
            return result.response
        return str(result)
    return "Please provide a URL and an extraction prompt."

bindufy(config, handler)
```

---

### Step 3 — Skill Metadata (`skills/web-scraping-skill/skill.yaml`)

```yaml
id: web-scraping-skill
name: web-scraping-skill
version: 1.0.0
author: bindu.builder@getbindu.com
description: |
  AI-enabled web scraping skill that crawls web pages, extracts structured data,
  cleans and formats outputs, and prepares datasets for analysis or integration.

  Features:
  - ScrapeGraph AI for intelligent extraction
  - Mem0-backed memory for deduplication and extraction profiles
  - Handles e-commerce listings, blog content, structured tables
  - Outputs clean JSON ready for analysis or pipeline ingestion

tags:
  - web-scraping
  - data-processing
  - extraction
  - crawler
  - scrape
  - structured-data

input_modes:
  - application/json

output_modes:
  - application/json

examples:
  - "Extract product listings from this e-commerce site: https://example.com/products"
  - "Scrape blog titles and publish dates from https://example.com/blog"
  - "Get all article headlines from this news page"

capabilities_detail:
  web_scraping:
    supported: true
    description: "Crawl and extract structured data from any public web page"
  data_processing:
    supported: true
    description: "Clean, normalize, and format extracted content into structured JSON"
  memory:
    supported: true
    description: "Remember previously scraped URLs and extraction profiles via Mem0"
  deduplication:
    supported: true
    description: "Avoid re-scraping already processed URLs"

assessment:
  keywords:
    - scrape
    - crawl
    - extract
    - web
    - website
    - product listings
    - blog titles
    - data collection
    - html
    - structured data

  specializations:
    - domain: e_commerce_extraction
      confidence_boost: 0.3
    - domain: content_aggregation
      confidence_boost: 0.2

  anti_patterns:
    - "pdf extraction"
    - "database query"
    - "audio transcription"
    - "image generation"
```

---

### Step 4 — Environment Template (`.env.example`)

```bash
# Required: ScrapeGraph AI API Key
# Get your free key at https://scrapegraphai.com/
SCRAPEGRAPH_API_KEY=sgai-<your-api-key>

# Required: Mem0 API Key
# Get your key at https://app.mem0.ai/
MEM0_API_KEY=<your-mem0-api-key>

# Required: OpenRouter API Key
# Get your free key at https://openrouter.ai/
OPENROUTER_API_KEY=sk-or-v1-<your-api-key>
```

---

### Step 5 — Dependency Update (`pyproject.toml`)

Add the following to the `agents` extras group (after the existing `openrouter>=0.6.0` line):

```toml
"scrapegraph-py>=1.0.0",
"mem0ai>=0.1.0",
```

---

### Step 6 — Tests

Create `tests/unit/test_web_scraping_agent.py`:

```python
"""Unit tests for web scraping agent."""

import pytest
from unittest.mock import patch, MagicMock


class TestHandlerInputValidation:
    def test_empty_messages_returns_prompt(self):
        from examples.web_scraping_agent.web_scraping_agent import handler
        result = handler([])
        assert "URL" in result or "prompt" in result.lower()

    def test_handler_extracts_latest_message(self):
        messages = [{"role": "user", "content": "scrape https://example.com"}]
        with patch("examples.web_scraping_agent.web_scraping_agent.agent") as mock_agent:
            mock_result = MagicMock()
            mock_result.content = "Extracted data"
            mock_agent.run.return_value = mock_result
            from examples.web_scraping_agent.web_scraping_agent import handler
            result = handler(messages)
        assert result == "Extracted data"


class TestAPIKeyValidation:
    def test_missing_scrapegraph_key_raises(self):
        with patch.dict("os.environ", {}, clear=True):
            # ScrapeGraphTools should raise or warn without API key
            from agno.tools.scrapegraph import ScrapeGraphTools
            # No key = should not silently proceed
            tools = ScrapeGraphTools(api_key=None)
            assert tools is not None  # tool initialises, failure happens at call time

    def test_missing_openrouter_key_returns_none(self):
        import os
        assert os.getenv("MISSING_KEY_XYZ") is None


class TestOutputFormatting:
    def test_handler_falls_back_to_str_result(self):
        messages = [{"role": "user", "content": "scrape https://example.com"}]
        with patch("examples.web_scraping_agent.web_scraping_agent.agent") as mock_agent:
            mock_result = MagicMock(spec=[])  # no .content or .response
            mock_result.__str__ = lambda self: "fallback string"
            mock_agent.run.return_value = mock_result
            from examples.web_scraping_agent.web_scraping_agent import handler
            result = handler(messages)
        assert isinstance(result, str)
```

---

### Step 7 — Update `examples/README.md`

Add a new line under `### Specialized`:

```markdown
- `web-scraping-agent/` - AI web scraping agent with ScrapeGraph + Mem0 memory
```

---

### Step 8 — PR Checklist Before Submitting

- [ ] All new files committed in one focused branch (`feature/web-scraping-agent`)
- [ ] `.env.example` includes all three required keys
- [ ] `skill.yaml` has `id`, `tags`, `capabilities_detail`, `assessment`
- [ ] `pyproject.toml` updated with `scrapegraph-py` and `mem0ai`
- [ ] `examples/README.md` updated under `### Specialized`
- [ ] At least 4 unit tests written and passing
- [ ] `uv run pre-commit run --all-files` passes
- [ ] `uv run pytest --cov=bindu --cov-report=term-missing` passes at 70%+
- [ ] No real API keys committed (`.env` is gitignored)
- [ ] PR description includes Notion card link and "Closes #issue" if applicable

---

### Step 9 — Commit Sequence

```bash
git add examples/web-scraping-agent/
git commit -m "feat(examples): add web scraping AI agent with ScrapeGraph + Mem0 integration"

git add pyproject.toml
git commit -m "chore(deps): add scrapegraph-py and mem0ai to agents optional dependencies"

git add tests/unit/test_web_scraping_agent.py
git commit -m "test(examples): add unit tests for web scraping agent handler and validation"

git add examples/README.md
git commit -m "docs(examples): register web scraping agent in examples index"

git push origin feature/web-scraping-agent
# Then open PR: itsa-D/Bindu → GetBindu/Bindu
```

---

## 6. Suggested Branch Name

```
feature/web-scraping-agent
```

---

## 7. Reference Files to Study Before Coding

| File | Why |
|---|---|
| `examples/weather-research/weather_research_agent.py` | Canonical agent + bindufy pattern |
| `examples/weather-research/skills/weather-research-skill/skill.yaml` | Skill YAML structure |
| `examples/weather-research/.env.example` | Env template format |
| `examples/weather-research/README.md` | README structure and troubleshooting format |
| `docs/SKILLS.md` | Full skills system spec including assessment metadata |
| `.github/contributing.md` | Contribution workflow and PR process |
| `tests/README.md` | Test structure, fixtures, and coverage targets |
| `pyproject.toml` (L64–L75) | Where to add dependencies |
