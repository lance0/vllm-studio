'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  Copy,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Play,
  Trash2,
} from 'lucide-react';
import api from '@/lib/api';
import type { ModelInfo, Recipe, RecipeWithStatus, VRAMCalculation, ProcessInfo } from '@/lib/types';
import { parseCommand, recipeToCommand, slugifyRecipeId } from '@/lib/recipe-command';

type Tab = 'recipes' | 'tools';

const DEFAULT_RECIPE: Recipe = {
  id: '',
  name: '',
  model_path: '',
  backend: 'vllm',
  tp: 1,
  pp: 1,
  port: 8000,
  host: '0.0.0.0',
  gpu_memory_utilization: 0.9,
  extra_args: {},
};

function RecipesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editRecipeId = searchParams.get('edit');
  const startNew = searchParams.get('new') === '1';
  const [tab, setTab] = useState<Tab>('recipes');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [runningProcess, setRunningProcess] = useState<ProcessInfo | null>(null);
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null);

  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Recipe>({ ...DEFAULT_RECIPE });
  const [isDirty, setIsDirty] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [commandMode, setCommandMode] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [commandParseError, setCommandParseError] = useState<string | null>(null);
  const [extraArgsText, setExtraArgsText] = useState('{}');
  const [envVarsText, setEnvVarsText] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // VRAM Tool
  const [vramModel, setVramModel] = useState('');
  const [contextLength, setContextLength] = useState(32768);
  const [tpSize, setTpSize] = useState(8);
  const [kvDtype, setKvDtype] = useState<'auto' | 'fp16' | 'fp8'>('auto');
  const [vramResult, setVramResult] = useState<VRAMCalculation | null>(null);
  const [calculating, setCalculating] = useState(false);

  const loadData = useCallback(async () => {
    const [modelsData, recipesData, statusData] = await Promise.all([
      api.getModels().catch(() => ({ models: [] as ModelInfo[] })),
      api.getRecipes().catch(() => ({ recipes: [] as RecipeWithStatus[] })),
      api.getStatus().catch(() => ({ running: false, process: null as ProcessInfo | null, inference_port: 8000 })),
    ]);

    setModels(modelsData.models || []);
    const recipesList = recipesData.recipes || [];
    setRecipes(recipesList);
    setRunningProcess(statusData.process || null);
    const running = recipesList.find((r) => r.status === 'running')?.id || null;
    setRunningRecipeId(running);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadData();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData]);

  const selectRecipe = useCallback((recipe: RecipeWithStatus) => {
    setSelectedId(recipe.id);
    setDraft({ ...recipe });
    setIsDirty(false);
    setCommandParseError(null);
    const cmd = recipeToCommand(recipe);
    setCommandText(cmd);
    setExtraArgsText(JSON.stringify(recipe.extra_args || {}, null, 2));
    setEnvVarsText(JSON.stringify(recipe.env_vars || {}, null, 2));
    setJsonError(null);
  }, []);

  const startNewRecipe = useCallback(() => {
    setSelectedId(null);
    setDraft({ ...DEFAULT_RECIPE });
    setIsDirty(false);
    setCommandParseError(null);
    setCommandText(`# Paste a vLLM command here (optional)\n# Or fill in the fields below.\n\nvllm serve /mnt/llm_models/YourModel \\\n  --tensor-parallel-size 8 \\\n  --max-model-len 32768 \\\n  --gpu-memory-utilization 0.9 \\\n  --trust-remote-code \\\n  --host 0.0.0.0 \\\n  --port 8000`);
    setExtraArgsText('{}');
    setEnvVarsText('{}');
    setJsonError(null);
  }, []);

  useEffect(() => {
    if (startNew) startNewRecipe();
  }, [startNew, startNewRecipe]);

  useEffect(() => {
    if (!editRecipeId) return;
    const recipe = recipes.find((r) => r.id === editRecipeId);
    if (recipe) selectRecipe(recipe);
  }, [editRecipeId, recipes, selectRecipe]);

  const filteredRecipes = useMemo(() => {
    if (!filter.trim()) return recipes;
    const q = filter.toLowerCase();
    return recipes.filter((r) => {
      return (
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.model_path.toLowerCase().includes(q)
      );
    });
  }, [filter, recipes]);

  const setDraftField = <K extends keyof Recipe>(key: K, value: Recipe[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const ensureIdAndName = (recipe: Recipe): Recipe => {
    let id = recipe.id;
    let name = recipe.name;
    if (!id && recipe.model_path) id = slugifyRecipeId(recipe.model_path.split('/').pop() || 'new-recipe');
    if (!name && recipe.model_path) name = recipe.model_path.split('/').pop() || 'New Recipe';
    return { ...recipe, id, name };
  };

  const parseAdvancedJson = (): { extra_args: Record<string, unknown>; env_vars: Record<string, string> } | null => {
    try {
      const extra = extraArgsText.trim() ? JSON.parse(extraArgsText) : {};
      const env = envVarsText.trim() ? JSON.parse(envVarsText) : {};
      if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) throw new Error('extra_args must be a JSON object');
      if (typeof env !== 'object' || env === null || Array.isArray(env)) throw new Error('env_vars must be a JSON object');
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== 'string') throw new Error(`env_vars.${k} must be a string`);
      }
      setJsonError(null);
      return { extra_args: extra as Record<string, unknown>, env_vars: env as Record<string, string> };
    } catch (e) {
      setJsonError((e as Error).message);
      return null;
    }
  };

  const saveRecipe = useCallback(async () => {
    const normalized = ensureIdAndName(draft);
    if (!normalized.id || !normalized.name || !normalized.model_path) {
      alert('Please provide: model path, recipe id, and name.');
      return null;
    }

    const advanced = parseAdvancedJson();
    if (!advanced) return null;

    const recipeToSave: Recipe = {
      ...normalized,
      extra_args: advanced.extra_args,
      env_vars: advanced.env_vars,
      tp: normalized.tp || normalized.tensor_parallel_size || 1,
      pp: normalized.pp || normalized.pipeline_parallel_size || 1,
      backend: normalized.backend || 'vllm',
    };

    setSaving(true);
    try {
      const exists = recipes.some((r) => r.id === recipeToSave.id);
      if (exists) await api.updateRecipe(recipeToSave.id, recipeToSave);
      else await api.createRecipe(recipeToSave);

      await loadData();
      const updated = await api.getRecipe(recipeToSave.id).catch(() => recipeToSave as unknown as RecipeWithStatus);
      setSelectedId(recipeToSave.id);
      setDraft({ ...updated });
      setIsDirty(false);
      setCommandText(recipeToCommand(updated));
      setExtraArgsText(JSON.stringify(recipeToSave.extra_args || {}, null, 2));
      setEnvVarsText(JSON.stringify(recipeToSave.env_vars || {}, null, 2));
      return recipeToSave.id;
    } catch (e) {
      alert('Failed to save: ' + (e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, loadData, recipes, extraArgsText, envVarsText]);

  const launchSelected = useCallback(async () => {
    const id = await saveRecipe();
    if (!id) return;
    setLaunching(true);
    try {
      await api.switchModel(id, true);
      await loadData();
    } catch (e) {
      alert('Failed to launch: ' + (e as Error).message);
    } finally {
      setLaunching(false);
    }
  }, [loadData, saveRecipe]);

  const stopRunning = useCallback(async () => {
    if (!confirm('Stop the currently running model?')) return;
    try {
      await api.evictModel(true);
      await loadData();
    } catch (e) {
      alert('Failed to stop: ' + (e as Error).message);
    }
  }, [loadData]);

  const deleteSelected = useCallback(async () => {
    const id = selectedId || draft.id;
    if (!id) return;
    if (!confirm(`Delete recipe "${id}"?`)) return;
    try {
      await api.deleteRecipe(id);
      await loadData();
      startNewRecipe();
    } catch (e) {
      alert('Failed to delete: ' + (e as Error).message);
    }
  }, [draft.id, loadData, selectedId, startNewRecipe]);

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const parseCommandIntoDraft = () => {
    setCommandParseError(null);
    try {
      const parsed = parseCommand(commandText, { id: draft.id, name: draft.name });
      const merged = ensureIdAndName({ ...draft, ...parsed });
      setDraft(merged);
      setIsDirty(true);
      setExtraArgsText(JSON.stringify(merged.extra_args || {}, null, 2));
      setEnvVarsText(JSON.stringify(merged.env_vars || {}, null, 2));
      setJsonError(null);
    } catch (e) {
      setCommandParseError((e as Error).message);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const commandPreview = useMemo(() => {
    const normalized = ensureIdAndName(draft);
    if (!normalized.model_path) return '';
    return recipeToCommand(normalized);
  }, [draft]);

  const selectedIsRunning = !!runningRecipeId && (selectedId === runningRecipeId || draft.id === runningRecipeId);

  const calculateVRAM = async () => {
    if (!vramModel) return;
    setCalculating(true);
    try {
      const data = await api.calculateVRAM({
        model_path: vramModel,
        context_length: contextLength,
        batch_size: 1,
        tp_size: tpSize,
        kv_cache_dtype: kvDtype,
      });
      setVramResult(data);
    } catch (e) {
      alert('Failed to calculate VRAM: ' + (e as Error).message);
    } finally {
      setCalculating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <RefreshCw className="h-8 w-8 animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Recipes</h1>
          <div className="text-sm text-[var(--muted-foreground)]">
            {runningProcess
              ? `Running: ${runningRecipeId || runningProcess.model_path?.split('/').pop() || 'Unknown'} (PID ${runningProcess.pid})`
              : 'No model running'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('recipes')}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
              tab === 'recipes'
                ? 'bg-[var(--card-hover)] border-[var(--border)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--card-hover)]'
            }`}
          >
            Recipes
          </button>
          <button
            onClick={() => setTab('tools')}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
              tab === 'tools'
                ? 'bg-[var(--card-hover)] border-[var(--border)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--card-hover)]'
            }`}
          >
            Tools
          </button>
          <button
            onClick={refresh}
            className="p-2 border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {tab === 'tools' ? (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg">
          <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
            <Calculator className="h-5 w-5 text-[var(--accent)]" />
            <h2 className="font-medium">VRAM Calculator</h2>
          </div>
          <div className="p-4 grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--muted-foreground)] mb-1">Model</label>
              <input
                value={vramModel}
                onChange={(e) => setVramModel(e.target.value)}
                placeholder="/mnt/llm_models/..."
                className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
                list="models-list"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-1">Context</label>
                <input
                  type="number"
                  value={contextLength}
                  onChange={(e) => setContextLength(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-1">TP</label>
                <select
                  value={tpSize}
                  onChange={(e) => setTpSize(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  {[1, 2, 4, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[var(--muted-foreground)] mb-1">KV</label>
                <select
                  value={kvDtype}
                  onChange={(e) => setKvDtype(e.target.value as 'auto' | 'fp16' | 'fp8')}
                  className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="auto">auto</option>
                  <option value="fp16">fp16</option>
                  <option value="fp8">fp8</option>
                </select>
              </div>
            </div>

            <div className="md:col-span-2 flex gap-2">
              <button
                onClick={calculateVRAM}
                disabled={!vramModel || calculating}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
              >
                {calculating ? 'Calculating...' : 'Calculate'}
              </button>
              {vramResult && (
                <div className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                  vramResult.fits ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--error)]/10 text-[var(--error)]'
                }`}>
                  {vramResult.fits ? 'Fits' : 'May not fit'} • {vramResult.breakdown.per_gpu_gb.toFixed(2)} GB/GPU • {Math.round(vramResult.utilization_percent)}% util
                </div>
              )}
            </div>

            {vramResult && (
              <div className="md:col-span-2 bg-[var(--background)] rounded-lg p-4 text-sm">
                <div className="grid sm:grid-cols-2 gap-2">
                  <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">Weights</span><span className="font-mono">{vramResult.breakdown.model_weights_gb.toFixed(2)} GB</span></div>
                  <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">KV Cache</span><span className="font-mono">{vramResult.breakdown.kv_cache_gb.toFixed(2)} GB</span></div>
                  <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">Activations</span><span className="font-mono">{vramResult.breakdown.activations_gb.toFixed(2)} GB</span></div>
                  <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">Total</span><span className="font-mono">{vramResult.breakdown.total_gb.toFixed(2)} GB</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          <section className="lg:col-span-1 bg-[var(--card)] border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="p-3 border-b border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">Recipe List</div>
                <button
                  onClick={() => {
                    router.replace('/recipes?new=1');
                    startNewRecipe();
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]"
                >
                  <Plus className="h-3 w-3" /> New
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search recipes..."
                  className="w-full pl-10 pr-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            <div className="max-h-[calc(100vh-14rem)] overflow-auto divide-y divide-[var(--border)]">
              {filteredRecipes.length === 0 ? (
                <div className="p-6 text-sm text-center text-[var(--muted-foreground)]">No recipes found</div>
              ) : (
                filteredRecipes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      router.replace(`/recipes?edit=${encodeURIComponent(r.id)}`);
                      selectRecipe(r);
                    }}
                    className={`w-full text-left p-3 hover:bg-[var(--card-hover)] transition-colors ${
                      (selectedId || draft.id) === r.id ? 'bg-[var(--card-hover)]' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-xs text-[var(--muted-foreground)] truncate">{r.id}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {r.status === 'running' && (
                          <span className="px-2 py-0.5 bg-[var(--success)]/10 text-[var(--success)] rounded text-xs">
                            Running
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          r.backend === 'vllm' ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                        }`}>
                          {r.backend}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mt-1 truncate">{r.model_path}</div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="lg:col-span-2 bg-[var(--card)] border border-[var(--border)] rounded-lg">
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {draft.name || (draft.model_path ? draft.model_path.split('/').pop() : 'New Recipe')}
                </div>
                <div className="text-xs text-[var(--muted-foreground)] truncate">
                  {draft.id ? `ID: ${draft.id}` : 'Not saved yet'}
                  {selectedIsRunning ? ' • running' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {runningProcess ? (
                  <button
                    onClick={stopRunning}
                    className="flex items-center gap-1 px-3 py-2 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)]"
                    title="Stop running model"
                  >
                    <Square className="h-4 w-4" /> Stop
                  </button>
                ) : null}
                <button
                  onClick={launchSelected}
                  disabled={launching || saving || !draft.model_path}
                  className="flex items-center gap-1 px-3 py-2 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 disabled:opacity-50"
                  title="Save (if needed) and launch"
                >
                  <Play className="h-4 w-4" /> {launching ? 'Launching…' : 'Launch'}
                </button>
                <button
                  onClick={async () => {
                    await saveRecipe();
                  }}
                  disabled={saving || !isDirty}
                  className="flex items-center gap-1 px-3 py-2 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--muted-foreground)] mb-1">Model path</label>
                  <input
                    value={draft.model_path}
                    onChange={(e) => setDraftField('model_path', e.target.value)}
                    placeholder="/mnt/llm_models/..."
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
                    list="models-list"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-[var(--muted-foreground)] mb-1">Backend</label>
                    <select
                      value={draft.backend}
                      onChange={(e) => setDraftField('backend', e.target.value as 'vllm' | 'sglang')}
                      className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                    >
                      <option value="vllm">vLLM</option>
                      <option value="sglang">SGLang</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--muted-foreground)] mb-1">Port</label>
                    <input
                      type="number"
                      value={draft.port || 8000}
                      onChange={(e) => setDraftField('port', parseInt(e.target.value) || 8000)}
                      className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--muted-foreground)] mb-1">Recipe name</label>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraftField('name', e.target.value)}
                    placeholder="Human-friendly name"
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--muted-foreground)] mb-1">Recipe id</label>
                  <input
                    value={draft.id}
                    onChange={(e) => setDraftField('id', slugifyRecipeId(e.target.value))}
                    placeholder="e.g. glm-4-6v-awq"
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-[var(--muted-foreground)] mb-1">TP</label>
                  <input
                    type="number"
                    value={draft.tp || draft.tensor_parallel_size || 1}
                    onChange={(e) => setDraftField('tp', Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--muted-foreground)] mb-1">Max context</label>
                  <input
                    type="number"
                    value={draft.max_model_len || ''}
                    onChange={(e) => setDraftField('max_model_len', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="e.g. 32768"
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--muted-foreground)] mb-1">GPU util</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="1"
                    value={draft.gpu_memory_utilization ?? 0.9}
                    onChange={(e) => setDraftField('gpu_memory_utilization', Math.max(0.1, Math.min(1, parseFloat(e.target.value) || 0.9)))}
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Advanced
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCommandMode((v) => !v)}
                    className="px-3 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)]"
                  >
                    {commandMode ? 'Guided fields' : 'Command mode'}
                  </button>
                  <button
                    onClick={() => copyText(commandPreview)}
                    disabled={!commandPreview}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] disabled:opacity-50"
                    title="Copy launch command"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy command
                  </button>
                </div>
              </div>

              {commandMode ? (
                <div className="space-y-2">
                  <textarea
                    value={commandText}
                    onChange={(e) => setCommandText(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={parseCommandIntoDraft}
                      className="px-3 py-2 text-sm bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]"
                    >
                      Parse into fields
                    </button>
                    {commandParseError && <div className="text-sm text-[var(--error)]">{commandParseError}</div>}
                  </div>
                </div>
              ) : (
                <div className="bg-[var(--background)] rounded-lg p-3 text-xs font-mono whitespace-pre-wrap break-words">
                  {commandPreview || 'Fill the model path to see the command preview.'}
                </div>
              )}

              {advancedOpen && (
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-[var(--muted-foreground)] mb-1">Tool call parser</label>
                      <input
                        value={draft.tool_call_parser || ''}
                        onChange={(e) => setDraftField('tool_call_parser', e.target.value || undefined)}
                        placeholder="e.g. glm4, hermes"
                        className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
                      />
                      <label className="mt-2 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                        <input
                          type="checkbox"
                          checked={!!draft.enable_auto_tool_choice}
                          onChange={(e) => setDraftField('enable_auto_tool_choice', e.target.checked)}
                        />
                        Enable auto tool choice
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm text-[var(--muted-foreground)] mb-1">Served model name</label>
                      <input
                        value={draft.served_model_name || ''}
                        onChange={(e) => setDraftField('served_model_name', e.target.value || undefined)}
                        placeholder="Optional (overrides model name)"
                        className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-[var(--muted-foreground)] mb-1">env_vars (JSON)</label>
                      <textarea
                        value={envVarsText}
                        onChange={(e) => {
                          setEnvVarsText(e.target.value);
                          setIsDirty(true);
                        }}
                        rows={6}
                        className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[var(--muted-foreground)] mb-1">extra_args (JSON)</label>
                      <textarea
                        value={extraArgsText}
                        onChange={(e) => {
                          setExtraArgsText(e.target.value);
                          setIsDirty(true);
                        }}
                        rows={6}
                        className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  </div>

                  {jsonError && <div className="text-sm text-[var(--error)]">{jsonError}</div>}

                  <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                    <button
                      onClick={deleteSelected}
                      className="flex items-center gap-1 px-3 py-2 text-sm text-[var(--error)] border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)]"
                      disabled={selectedIsRunning}
                      title={selectedIsRunning ? 'Stop the model before deleting this recipe.' : 'Delete recipe'}
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {isDirty ? 'Unsaved changes' : 'Saved'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <datalist id="models-list">
        {models.map((m) => (
          <option key={m.path} value={m.path}>
            {m.name}
          </option>
        ))}
      </datalist>
    </div>
  );
}

export default function RecipesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <RefreshCw className="h-8 w-8 animate-spin text-[var(--muted)]" />
        </div>
      }
    >
      <RecipesContent />
    </Suspense>
  );
}

