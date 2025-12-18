"""Process management for vLLM/SGLang."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple

import psutil

from .config import settings
from .models import Backend, ProcessInfo, Recipe


def _extract_flag(cmdline: List[str], flag: str) -> Optional[str]:
    """Extract value of a CLI flag."""
    for i, arg in enumerate(cmdline):
        if arg == flag and i + 1 < len(cmdline):
            return cmdline[i + 1]
    return None


def _is_inference_process(cmdline: List[str]) -> Optional[str]:
    """Check if cmdline is vLLM or SGLang, return backend name."""
    if not cmdline:
        return None
    joined = " ".join(cmdline)
    if "vllm.entrypoints.openai.api_server" in joined:
        return "vllm"
    if len(cmdline) >= 2 and cmdline[0].endswith("vllm") and cmdline[1] == "serve":
        return "vllm"
    if "sglang.launch_server" in joined:
        return "sglang"
    return None


def find_inference_process(port: int) -> Optional[ProcessInfo]:
    """Find running inference process on given port."""
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            backend = _is_inference_process(cmdline)
            if not backend:
                continue
            p = _extract_flag(cmdline, "--port")
            if p is None or int(p) != port:
                continue
            # Extract model path
            model_path = _extract_flag(cmdline, "--model") or _extract_flag(cmdline, "--model-path")
            if not model_path and len(cmdline) >= 3 and cmdline[1] == "serve":
                model_path = cmdline[2] if not cmdline[2].startswith("-") else None
            return ProcessInfo(
                pid=proc.info["pid"],
                backend=backend,
                model_path=model_path,
                port=port,
                served_model_name=_extract_flag(cmdline, "--served-model-name"),
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError):
            continue
    return None


async def kill_process(pid: int, force: bool = False) -> bool:
    """Kill process and its children."""
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return True

    # Kill children first
    for child in proc.children(recursive=True):
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass

    # Terminate main process
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except psutil.TimeoutExpired:
        if force:
            proc.kill()
    except psutil.NoSuchProcess:
        pass

    await asyncio.sleep(1)
    return True


def build_vllm_command(recipe: Recipe) -> List[str]:
    """Build vLLM launch command."""
    if recipe.python_path:
        cmd = [recipe.python_path, "-m", "vllm.entrypoints.openai.api_server"]
    else:
        cmd = ["vllm", "serve"]

    cmd.extend([recipe.model_path, "--host", recipe.host, "--port", str(recipe.port)])

    if recipe.served_model_name:
        cmd.extend(["--served-model-name", recipe.served_model_name])
    if recipe.tensor_parallel_size > 1:
        cmd.extend(["--tensor-parallel-size", str(recipe.tensor_parallel_size)])
    if recipe.pipeline_parallel_size > 1:
        cmd.extend(["--pipeline-parallel-size", str(recipe.pipeline_parallel_size)])

    cmd.extend(["--max-model-len", str(recipe.max_model_len)])
    cmd.extend(["--gpu-memory-utilization", str(recipe.gpu_memory_utilization)])
    cmd.extend(["--max-num-seqs", str(recipe.max_num_seqs)])

    if recipe.kv_cache_dtype != "auto":
        cmd.extend(["--kv-cache-dtype", recipe.kv_cache_dtype])
    if recipe.trust_remote_code:
        cmd.append("--trust-remote-code")
    if recipe.tool_call_parser:
        cmd.extend(["--tool-call-parser", recipe.tool_call_parser, "--enable-auto-tool-choice"])
    if recipe.quantization:
        cmd.extend(["--quantization", recipe.quantization])
    if recipe.dtype:
        cmd.extend(["--dtype", recipe.dtype])

    # Extra args
    for key, value in recipe.extra_args.items():
        flag = f"--{key.replace('_', '-')}"
        if value is True:
            cmd.append(flag)
        elif value not in (False, None):
            if isinstance(value, (dict, list)):
                cmd.extend([flag, json.dumps(value)])
            else:
                cmd.extend([flag, str(value)])

    return cmd


def build_sglang_command(recipe: Recipe) -> List[str]:
    """Build SGLang launch command."""
    python = recipe.python_path or settings.sglang_python or "python"
    cmd = [python, "-m", "sglang.launch_server"]
    cmd.extend(["--model-path", recipe.model_path])
    cmd.extend(["--host", recipe.host, "--port", str(recipe.port)])

    if recipe.served_model_name:
        cmd.extend(["--served-model-name", recipe.served_model_name])
    if recipe.tensor_parallel_size > 1:
        cmd.extend(["--tp", str(recipe.tensor_parallel_size)])

    cmd.extend(["--context-length", str(recipe.max_model_len)])
    cmd.extend(["--mem-fraction-static", str(recipe.gpu_memory_utilization)])

    if recipe.trust_remote_code:
        cmd.append("--trust-remote-code")
    if recipe.quantization:
        cmd.extend(["--quantization", recipe.quantization])

    for key, value in recipe.extra_args.items():
        flag = f"--{key.replace('_', '-')}"
        if value is True:
            cmd.append(flag)
        elif value not in (False, None):
            cmd.extend([flag, str(value)])

    return cmd


async def launch_model(recipe: Recipe) -> Tuple[bool, Optional[int], str]:
    """Launch inference server with recipe config."""
    recipe.port = settings.inference_port  # Override with configured port

    if recipe.backend == Backend.SGLANG:
        cmd = build_sglang_command(recipe)
    else:
        cmd = build_vllm_command(recipe)

    log_file = Path(f"/tmp/vllm_{recipe.id}.log")
    env = os.environ.copy()

    try:
        with open(log_file, "w") as log:
            proc = subprocess.Popen(
                cmd,
                stdout=log,
                stderr=subprocess.STDOUT,
                env=env,
                start_new_session=True,
            )

        await asyncio.sleep(3)

        if proc.poll() is not None:
            tail = log_file.read_text()[-500:] if log_file.exists() else ""
            return False, None, f"Process exited early: {tail}"

        return True, proc.pid, str(log_file)
    except Exception as e:
        return False, None, str(e)


async def evict_model(force: bool = False) -> Optional[int]:
    """Stop current running model."""
    current = find_inference_process(settings.inference_port)
    if not current:
        return None
    await kill_process(current.pid, force=force)
    return current.pid


async def switch_model(recipe: Recipe, force: bool = False) -> Tuple[bool, Optional[int], str]:
    """Switch to a new model (evict current + launch new)."""
    await evict_model(force=force)
    await asyncio.sleep(2)
    return await launch_model(recipe)
