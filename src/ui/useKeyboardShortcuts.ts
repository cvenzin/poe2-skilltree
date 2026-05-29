import { useEffect } from 'react';
import { useStore } from '../state/store';
import { allocationSize } from '../state/allocation';
import { RESET_CONFIRM_THRESHOLD } from './ResetButton';

/**
 * Global keyboard shortcuts (INSTRUCTIONS.md §10):
 *   - `Ctrl/Cmd+Z`        → undo
 *   - `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` → redo
 *   - `R`                 → reset (with confirm if allocated > 10; second `R`
 *                                  while popover open confirms)
 *   - `Ctrl/Cmd+F`        → focus search input (fires a custom `poe2:focus-search`
 *                                  event picked up by `SearchInput`)
 *   - `Escape`            → close the reset-confirm popover if open; OR clear
 *                                  the search if active (input handles Esc itself
 *                                  when focused; this is the canvas-focused case)
 *
 * Mount once at the App level. Most shortcuts suppress when an editable
 * element is focused (input/textarea/contentEditable) so typing in the cap
 * chip doesn't trigger shortcuts. `Ctrl/Cmd+F` is the exception: it works
 * everywhere so you can re-focus the search bar from anywhere.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      // Ctrl/Cmd+F works even when an input is focused.
      if (meta && k === 'f') { handleFocusSearch(e); return; }

      // Everything else suppresses inside editable elements.
      if (isEditableTarget(e.target)) return;

      if (meta && k === 'z' && !e.shiftKey) { handleUndo(e); return; }
      if ((meta && k === 'y') || (meta && k === 'z' && e.shiftKey)) { handleRedo(e); return; }
      if (!meta && !e.altKey && k === 'r') { handleReset(e); return; }
      if (k === 'escape') handleEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

function handleFocusSearch(e: KeyboardEvent): void {
  e.preventDefault();
  globalThis.dispatchEvent(new CustomEvent('poe2:focus-search'));
}

function handleUndo(e: KeyboardEvent): void {
  e.preventDefault();
  useStore.getState().undo();
}

function handleRedo(e: KeyboardEvent): void {
  e.preventDefault();
  useStore.getState().redo();
}

function handleReset(e: KeyboardEvent): void {
  e.preventDefault();
  const s = useStore.getState();
  if (s.resetConfirmOpen) {
    // Second R while popover open → confirm.
    s.resetAllocation();
    s.setResetConfirmOpen(false);
  } else if (allocationSize(s.allocation) > RESET_CONFIRM_THRESHOLD) {
    s.setResetConfirmOpen(true);
  } else if (allocationSize(s.allocation) > 0) {
    s.resetAllocation();
  }
}

/** Esc precedence: reset-confirm popover > active search > nothing. The
 *  search input handles Esc itself when focused; this branch covers
 *  canvas-focused Esc so the user can clear search without clicking back. */
function handleEscape(): void {
  const s = useStore.getState();
  if (s.resetConfirmOpen) {
    s.setResetConfirmOpen(false);
    return;
  }
  if (s.searchQuery !== '') s.clearSearch();
}
