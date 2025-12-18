# CLAUDE.md

## Project Overview

vLLM Studio - Minimal model lifecycle management for vLLM and SGLang inference servers, with LiteLLM as the API gateway.

## Architecture

```
Client → LiteLLM (4000) → vLLM/SGLang (8000)
              ↓
        Controller (8080)
```

- **LiteLLM**: API gateway, routing, format translation
- **Controller**: Model lifecycle (launch/evict/switch)
- **vLLM/SGLang**: Inference backend

## Commands

```bash
# Install
pip install -e .

# Run controller
./start.sh          # Production
./start.sh --dev    # Development with reload

# Run LiteLLM
docker compose up litellm
```

## Configuration

Environment variables (prefix `VLLM_STUDIO_`):
- `PORT` - Controller port (default: 8080)
- `INFERENCE_PORT` - vLLM/SGLang port (default: 8000)
- `API_KEY` - Optional authentication

## Structure

```
controller/
├── app.py      # FastAPI application
├── config.py   # Settings
├── models.py   # Pydantic models (Recipe)
├── process.py  # Process management
├── store.py    # SQLite recipe storage
└── cli.py      # Entry point
```

## Key Files

- `controller/process.py` - vLLM/SGLang process detection and launch
- `controller/models.py` - Recipe model with all launch parameters
- `config/litellm.yaml` - LiteLLM configuration
