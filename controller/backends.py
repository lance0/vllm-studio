"""Command builders for vLLM and SGLang backends."""

from __future__ import annotations

import json
from typing import List

from .config import settings
from .models import Recipe


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

    _append_extra_args(cmd, recipe.extra_args)
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

    _append_extra_args(cmd, recipe.extra_args)
    return cmd


def _append_extra_args(cmd: List[str], extra_args: dict) -> None:
    """Append extra CLI arguments to command."""
    for key, value in extra_args.items():
        flag = f"--{key.replace('_', '-')}"
        if value is True:
            cmd.append(flag)
        elif value not in (False, None):
            if isinstance(value, (dict, list)):
                cmd.extend([flag, json.dumps(value)])
            else:
                cmd.extend([flag, str(value)])
