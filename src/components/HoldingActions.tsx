// Row actions for holdings tables: a visible chart button plus a "⋯" menu with
// labelled actions. Shared by every holdings table so they offer the same actions.
// The menu renders in a portal with fixed positioning, so scrolling table
// containers can't clip it.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Edit2, FileText, LineChart, MoreHorizontal, Target, Trash2, Zap } from 'lucide-react';

export interface HoldingActionHandlers {
  onChart?: () => void;
  onAnalyze?: () => void;
  onThesis?: () => void;
  thesisLabel?: string;
  onEdit?: () => void;
  onHistory?: () => void;
  historyLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

export function HoldingActions({ ticker, ...h }: HoldingActionHandlers & { ticker: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items: MenuItem[] = [
    h.onAnalyze && { label: 'Analyze with AI', icon: <Zap className="w-4 h-4" />, onSelect: h.onAnalyze },
    h.onThesis && { label: h.thesisLabel || 'Thesis', icon: <Target className="w-4 h-4" />, onSelect: h.onThesis },
    h.onEdit && { label: 'Edit holding', icon: <Edit2 className="w-4 h-4" />, onSelect: h.onEdit },
    h.onHistory && { label: h.historyLabel || 'History', icon: <FileText className="w-4 h-4" />, onSelect: h.onHistory },
    h.onDelete && { label: h.deleteLabel || 'Delete', icon: <Trash2 className="w-4 h-4" />, onSelect: h.onDelete, danger: true },
  ].filter(Boolean) as MenuItem[];

  // Place the menu under the button, right-aligned, flipping up near the bottom edge.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 180;
    const below = r.bottom + 4 + menuHeight <= window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : r.top - 4 - menuHeight, left: r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="flex items-center justify-end gap-1" onClick={stop}>
      {h.onChart && (
        <button
          onClick={h.onChart}
          className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          title={`Chart for ${ticker}`}
          aria-label={`Chart for ${ticker}`}
        >
          <LineChart className="w-4 h-4" />
        </button>
      )}
      {items.length > 0 && (
        <button
          ref={buttonRef}
          onClick={() => setOpen((o) => !o)}
          className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
          title={`More actions for ${ticker}`}
          aria-label={`More actions for ${ticker}`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          onClick={stop}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, transform: 'translateX(-100%)' }}
          className="z-[160] min-w-[190px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1.5 shadow-xl"
        >
          {items.map((item, i) => (
            <React.Fragment key={item.label}>
              {item.danger && i > 0 && <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />}
              <button
                role="menuitem"
                onClick={() => { setOpen(false); item.onSelect(); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${item.danger ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950' : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
              >
                <span className={item.danger ? 'text-rose-500' : 'text-zinc-400'}>{item.icon}</span>
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
