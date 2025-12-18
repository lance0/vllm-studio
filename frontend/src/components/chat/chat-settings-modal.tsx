'use client';

import { useState, useEffect } from 'react';
import { X, Settings, Trash2, Info } from 'lucide-react';

interface ChatSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  availableModels?: Array<{ id: string }>;
  selectedModel?: string;
  onSelectedModelChange?: (modelId: string) => void;
  onForkModels?: (modelIds: string[]) => void;
}

const STORAGE_KEY = 'vllm-studio-system-prompt';

export function ChatSettingsModal({
  isOpen,
  onClose,
  systemPrompt,
  onSystemPromptChange,
  availableModels = [],
  selectedModel = '',
  onSelectedModelChange,
  onForkModels,
}: ChatSettingsModalProps) {
  const [localPrompt, setLocalPrompt] = useState(systemPrompt);
  const [forkSelection, setForkSelection] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLocalPrompt(systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && !systemPrompt) {
      onSystemPromptChange(saved);
    }
  }, []);

  if (!isOpen) return null;

  const handleSave = () => {
    onSystemPromptChange(localPrompt);
    localStorage.setItem(STORAGE_KEY, localPrompt);
    onClose();
  };

  const handleClear = () => {
    setLocalPrompt('');
  };

  const toggleForkModel = (id: string) => {
    setForkSelection((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const forkSelected = () => {
    if (!onForkModels) return;
    const selected = Object.entries(forkSelection)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .filter((id) => id && id !== selectedModel);
    if (selected.length === 0) return;
    onForkModels(selected);
    setForkSelection({});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[var(--muted)]" />
            <h2 className="font-medium">Chat Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Model Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Chat Model</label>
            <p className="text-xs text-[var(--muted)]">
              Each chat can target a different model. Sending a message will auto-switch the backend if needed.
            </p>
            <select
              value={selectedModel}
              onChange={(e) => onSelectedModelChange?.(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            >
              <option value="" disabled>
                Select a model…
              </option>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </div>

          {/* System Prompt Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">System Prompt</label>
              <button
                onClick={handleClear}
                className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--error)] transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            </div>
            <p className="text-xs text-[var(--muted)]">
              The system prompt is sent at the start of every conversation to guide the model&apos;s behavior.
            </p>
            <textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              placeholder="Enter a system prompt... (e.g., You are a helpful coding assistant.)"
              className="w-full h-64 px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg resize-none focus:outline-none focus:border-[var(--foreground)] font-mono"
            />
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Info className="h-3 w-3" />
              <span>{localPrompt.length} characters</span>
            </div>
          </div>

          {/* Forking Section */}
          {onForkModels && availableModels.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Fork Chat (Split)</label>
              <p className="text-xs text-[var(--muted)]">
                Create parallel chats with the same history, each using a different model.
              </p>
              <div className="max-h-40 overflow-y-auto border border-[var(--border)] rounded-lg bg-[var(--background)]">
                {availableModels.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm border-b border-[var(--border)] last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={!!forkSelection[m.id]}
                      onChange={() => toggleForkModel(m.id)}
                      disabled={m.id === selectedModel}
                    />
                    <span className={`font-mono text-xs ${m.id === selectedModel ? 'text-[var(--muted)]' : ''}`}>
                      {m.id}
                    </span>
                  </label>
                ))}
              </div>
              <button
                onClick={forkSelected}
                disabled={Object.values(forkSelection).every((v) => !v)}
                className="px-3 py-2 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-90 disabled:opacity-30"
              >
                Create fork(s)
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
