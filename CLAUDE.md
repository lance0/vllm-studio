<!-- CRITICAL -->
# CLAUDE.md

## Project Overview

vLLM Studio - Model lifecycle management for vLLM, SGLang, and TabbyAPI inference servers, with LiteLLM as the API gateway. Features a Next.js frontend with real-time SSE updates, MCP tool integration, and comprehensive analytics.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              Frontend (3000)            │
                    │  Next.js + React + TypeScript           │
                    └─────────────────┬───────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  Controller (8080)  │  │   LiteLLM (4100)    │  │  Prometheus (9090)  │
│  Bun + SQLite       │  │   API Gateway       │  │   Metrics Store     │
└──────────┬──────────┘  └──────────┬──────────┘  └─────────────────────┘
           │                        │
           │                        ▼
           │             ┌─────────────────────┐
           │             │  vLLM/SGLang (8000) │
           │             │  Inference Backend  │
           │             └─────────────────────┘
           │
           ├────────────────────────────────────┐
           │                                    │
           ▼                                    ▼
┌─────────────────────┐              ┌─────────────────────┐
│   PostgreSQL (5432) │              │    Redis (6379)     │
│   Usage Analytics   │              │   Response Cache    │
└─────────────────────┘              └─────────────────────┘
```

## Commands

```bash
# Install and run controller (IMPORTANT: use start.sh or native bun, NOT snap bun)
cd controller && bun install
./start.sh                                    # Recommended - uses native bun
./start.sh --dev                              # Development with auto-reload
~/.bun/bin/bun run controller/src/main.ts     # Direct with native bun

# DO NOT use snap bun directly - it has sandbox restrictions that block nvidia-smi
# If you see "nvidia-smi not found" errors, you're using snap bun

# Install native bun if needed:
curl -fsSL https://bun.sh/install | bash

# Run all services
docker compose up -d

# Run frontend
cd frontend && npm run dev
```

## Configuration

Environment variables (prefix `VLLM_STUDIO_`):
- `PORT` - Controller port (default: 8080)
- `INFERENCE_PORT` - vLLM/SGLang port (default: 8000)
- `API_KEY` - Optional authentication
- `DATA_DIR` - Data directory (default: ./data)
- `DB_PATH` - SQLite database path (default: ./data/controller.db)
- `MODELS_DIR` - Model weights directory (default: /models)
- `SGLANG_PYTHON` - Python path for SGLang venv
- `TABBY_API_DIR` - TabbyAPI installation directory

## Project Structure

```
vllm-studio/
├── controller/           # Bun + TypeScript backend
│   └── src/
│       ├── main.ts           # Entry point
│       ├── http/app.ts       # Hono server
│       ├── config/env.ts     # Environment settings
│       ├── types/models.ts   # Data models (Recipe, MCPServer, etc.)
│       ├── services/
│       │   ├── backends.ts       # Command builders for vLLM/SGLang
│       │   ├── process-manager.ts # Process management (launch/evict)
│       │   ├── event-manager.ts  # SSE event manager
│       │   ├── gpu.ts            # GPU detection
│       │   └── model-browser.ts  # Model directory discovery
│       ├── stores/           # SQLite stores (Recipe, Chat, MCP, Metrics)
│       └── routes/           # API route handlers
│           ├── system.ts     # /health, /status, /gpus, /config
│           ├── lifecycle.ts  # /recipes, /launch, /evict
│           ├── models.ts     # /v1/models, /v1/studio/models
│           ├── chats.ts      # /chats CRUD
│           ├── logs.ts       # /logs, /events (SSE)
│           ├── monitoring.ts # /metrics, /peak-metrics
│           ├── usage.ts      # /usage analytics
│           ├── proxy.ts      # Chat completions proxy
│           └── mcp.ts        # /mcp/servers, /mcp/tools
├── cli/                  # Bun CLI app
├── frontend/             # Next.js frontend
│   └── src/
│       ├── app/         # Pages (chat, recipes, configs, logs, discover, usage)
│       ├── components/  # React components
│       ├── hooks/       # Custom hooks (useSSE, useContextManager)
│       └── lib/         # API client, types, utilities
├── config/               # Service configurations
│   ├── litellm.yaml          # LiteLLM routing config
│   ├── tool_call_handler.py  # LiteLLM callback (Python)
│   └── prometheus.yml        # Prometheus scrape config
├── data/                 # Runtime data (SQLite DB, logs)
└── docker-compose.yml    # Service orchestration
```

## Database Schema

```sql
-- Recipes (model launch configurations)
CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,  -- JSON-serialized Recipe
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Chat sessions
CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    model TEXT,
    parent_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Chat messages
CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    model TEXT,
    tool_calls TEXT,  -- JSON array
    request_prompt_tokens INTEGER,
    request_completion_tokens INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- MCP servers
CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    command TEXT NOT NULL,
    args TEXT DEFAULT '[]',
    env TEXT DEFAULT '{}',
    description TEXT,
    url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Peak metrics (benchmark results)
CREATE TABLE peak_metrics (
    model_id TEXT PRIMARY KEY,
    prefill_tps REAL,
    generation_tps REAL,
    ttft_ms REAL,
    total_tokens INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0
);

-- Lifetime metrics (cumulative)
CREATE TABLE lifetime_metrics (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL DEFAULT 0
);
```

## API Endpoints

### System
- `GET /health` - Health check with inference readiness
- `GET /status` - Detailed status + launching recipe
- `GET /gpus` - GPU list with memory/utilization
- `GET /config` - System topology and service discovery

### Model Lifecycle
- `GET /recipes` - List recipes with status
- `POST /recipes` - Create recipe
- `PUT /recipes/{id}` - Update recipe
- `DELETE /recipes/{id}` - Delete recipe
- `POST /launch/{recipe_id}` - Launch model (with SSE progress)
- `POST /evict` - Stop running model
- `GET /wait-ready` - Poll until model ready

### OpenAI Compatibility
- `GET /v1/models` - List models (OpenAI format)
- `GET /v1/studio/models` - Local model discovery

### Chat
- `GET /chats` - List sessions
- `POST /chats` - Create session
- `GET /chats/{id}` - Get session with messages
- `POST /chats/{id}/messages` - Add message
- `POST /chats/{id}/fork` - Fork session

### MCP
- `GET /mcp/servers` - List MCP servers
- `POST /mcp/servers` - Add server
- `GET /mcp/tools` - List all tools
- `POST /mcp/tools/{server}/{tool}` - Call tool

### Monitoring
- `GET /events` - SSE stream (status, gpu, metrics, logs)
- `GET /metrics` - Prometheus metrics
- `GET /usage` - Usage analytics

## Key Files

- `controller/src/services/backends.ts` - vLLM/SGLang command construction with auto-detection of reasoning/tool parsers
- `controller/src/services/process-manager.ts` - Process detection, launch with stability checks, eviction
- `controller/src/routes/lifecycle.ts` - Launch state machine with preemption, cancellation, progress events
- `controller/src/services/event-manager.ts` - SSE event broadcasting to multiple subscribers
- `controller/src/stores/` - SQLite stores with migrations and seeding
- `config/litellm.yaml` - Model routing, callbacks, caching configuration
