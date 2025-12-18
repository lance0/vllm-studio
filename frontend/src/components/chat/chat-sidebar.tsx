'use client';

import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import type { ChatSession } from '@/lib/types';

interface ChatSidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isLoading?: boolean;
  isMobile?: boolean;
}

export function ChatSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isCollapsed,
  onToggleCollapse,
  isLoading,
  isMobile = false,
}: ChatSidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // On mobile, if collapsed, don't render anything (toggle button is in header)
  if (isCollapsed && isMobile) {
    return null;
  }

  // Desktop collapsed state
  if (isCollapsed && !isMobile) {
    return (
      <div className="w-8 h-full border-r border-[var(--border)] flex flex-col items-center py-2 gap-0.5">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
          title="Expand"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            onNewSession();
          }}
          className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
          title="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Mobile overlay
  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onToggleCollapse}
        />
        {/* Sidebar */}
        <div className="fixed left-0 top-0 bottom-0 w-64 bg-[var(--background)] border-r border-[var(--border)] flex flex-col z-50 animate-slide-in-left">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-sm font-medium">Chat History</span>
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* New Chat Button */}
          <div className="px-2 py-2 border-b border-[var(--border)]">
            <button
              onClick={() => {
                onNewSession();
                onToggleCollapse();
              }}
              className="w-full flex items-center justify-center gap-2 text-sm bg-[var(--accent)] hover:bg-[var(--accent)]/80 px-3 py-2 rounded-lg transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New Chat</span>
            </button>
          </div>

          {/* Sessions */}
          <div className="flex-1 overflow-y-auto py-2">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--muted)]">
                No chat history
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group relative mx-2 mb-1 rounded-lg ${
                    currentSessionId === session.id
                      ? 'bg-[var(--accent)]'
                      : 'hover:bg-[var(--accent)]/50'
                  }`}
                >
                  <button
                    onClick={() => {
                      onSelectSession(session.id);
                      onToggleCollapse();
                    }}
                    className="w-full px-3 py-2 text-left"
                  >
                    <span className="text-sm truncate block">{session.title}</span>
                    {session.model && (
                      <span className="text-xs text-[var(--muted)] font-mono truncate block">
                        {session.parent_id ? '↳ ' : ''}{session.model}
                      </span>
                    )}
                    <span className="text-xs text-[var(--muted)]">
                      {new Date(session.updated_at).toLocaleDateString()}
                    </span>
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-[var(--error)]/20 text-[var(--muted)] hover:text-[var(--error)] transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </>
    );
  }

  // Desktop expanded state
  return (
    <div className="w-44 h-full border-r border-[var(--border)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border)]">
        <button
          onClick={() => {
            onNewSession();
          }}
          className="flex items-center gap-1 text-xs hover:text-[var(--foreground)] hover:bg-[var(--accent)] px-2 py-1 rounded transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New</span>
        </button>
        <button
          onClick={onToggleCollapse}
          className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <div className="flex gap-1">
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-4 text-xs text-[var(--muted)]">
            No chats
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onMouseEnter={() => setHoveredId(session.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`group relative mx-1 mb-0.5 rounded cursor-pointer ${
                currentSessionId === session.id
                  ? 'bg-[var(--accent)]'
                  : 'hover:bg-[var(--accent)]/50'
              }`}
            >
              <button
                onClick={() => onSelectSession(session.id)}
                className="w-full px-2 py-1 text-left"
              >
                <span className="text-xs truncate block">{session.title}</span>
                {session.model && (
                  <span className="text-[10px] text-[var(--muted)] font-mono truncate block">
                    {session.parent_id ? '↳ ' : ''}{session.model}
                  </span>
                )}
              </button>

              {hoveredId === session.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--error)]/20 text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
