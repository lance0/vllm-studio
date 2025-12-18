"""FastAPI application - minimal controller API."""

from __future__ import annotations

import asyncio
from typing import Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import Settings, settings
from .models import HealthResponse, LaunchResult, Recipe
from .process import evict_model, find_inference_process, switch_model
from .store import RecipeStore

app = FastAPI(
    title="vLLM Studio Controller",
    version=__version__,
    description="Minimal model lifecycle management for vLLM/SGLang",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
_store: Optional[RecipeStore] = None
_switch_lock = asyncio.Lock()


def get_store() -> RecipeStore:
    global _store
    if _store is None:
        _store = RecipeStore(settings.db_path)
    return _store


# --- Authentication middleware ---
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not settings.api_key:
        return await call_next(request)

    if request.url.path in {"/health", "/docs", "/openapi.json", "/redoc"}:
        return await call_next(request)

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth.split(" ", 1)[1] != settings.api_key:
        return JSONResponse(status_code=401, content={"error": "Invalid or missing API key"})

    return await call_next(request)


# --- Health ---
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    """Health check."""
    current = find_inference_process(settings.inference_port)
    inference_ready = False

    if current:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                inference_ready = r.status_code == 200
        except Exception:
            pass

    return HealthResponse(
        status="ok",
        version=__version__,
        inference_ready=inference_ready,
        running_model=current.served_model_name or current.model_path if current else None,
    )


@app.get("/status", tags=["System"])
async def status():
    """Detailed status."""
    current = find_inference_process(settings.inference_port)
    return {
        "running": current is not None,
        "process": current.model_dump() if current else None,
        "inference_port": settings.inference_port,
    }


# --- Recipes ---
@app.get("/recipes", tags=["Recipes"])
async def list_recipes(store: RecipeStore = Depends(get_store)):
    """List all recipes."""
    recipes = store.list()
    current = find_inference_process(settings.inference_port)
    result = []
    for r in recipes:
        status = "stopped"
        if current and current.model_path and r.model_path in current.model_path:
            status = "running"
        result.append({**r.model_dump(), "status": status})
    return result


@app.get("/recipes/{recipe_id}", tags=["Recipes"])
async def get_recipe(recipe_id: str, store: RecipeStore = Depends(get_store)):
    """Get a recipe by ID."""
    recipe = store.get(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@app.post("/recipes", tags=["Recipes"])
async def create_recipe(recipe: Recipe, store: RecipeStore = Depends(get_store)):
    """Create or update a recipe."""
    store.save(recipe)
    return {"success": True, "id": recipe.id}


@app.delete("/recipes/{recipe_id}", tags=["Recipes"])
async def delete_recipe(recipe_id: str, store: RecipeStore = Depends(get_store)):
    """Delete a recipe."""
    if not store.delete(recipe_id):
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"success": True}


# --- Model lifecycle ---
@app.post("/launch/{recipe_id}", response_model=LaunchResult, tags=["Lifecycle"])
async def launch(recipe_id: str, force: bool = False, store: RecipeStore = Depends(get_store)):
    """Launch a model by recipe ID."""
    recipe = store.get(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    async with _switch_lock:
        success, pid, message = await switch_model(recipe, force=force)

    return LaunchResult(
        success=success,
        pid=pid,
        message=message,
        log_file=f"/tmp/vllm_{recipe_id}.log" if success else None,
    )


@app.post("/evict", tags=["Lifecycle"])
async def evict(force: bool = False):
    """Stop the running model."""
    async with _switch_lock:
        pid = await evict_model(force=force)
    return {"success": True, "evicted_pid": pid}


@app.get("/wait-ready", tags=["Lifecycle"])
async def wait_ready(timeout: int = 300):
    """Wait for inference backend to be ready."""
    import time

    start = time.time()
    while time.time() - start < timeout:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"http://localhost:{settings.inference_port}/health")
                if r.status_code == 200:
                    return {"ready": True, "elapsed": int(time.time() - start)}
        except Exception:
            pass
        await asyncio.sleep(2)

    return {"ready": False, "elapsed": timeout, "error": "Timeout waiting for backend"}
