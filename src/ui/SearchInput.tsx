import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useStore } from '../state/store';
import { allAllocated } from '../state/allocation';
import type { TreeData } from '../data/types';
import { buildSearchIndex, findMatches, filterConstraintHidden } from '../interaction/search';
import { palette, controlHeight } from './theme';

const DEBOUNCE_MS = 120;

interface SearchInputProps {
  data: TreeData;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Search input on the toolbar.
 *
 *   `[🔍 input                         ] [×]`
 *
 * Debounces the keystroke → matches recompute by 120 ms so per-keystroke
 * scans coalesce. The search index itself is memoised on `data` — rebuilt
 * only when a different version is loaded.
 *
 * Keyboard handled here (not in the global hook): Enter / Shift+Enter step
 * through matches; Esc clears. Global Ctrl/Cmd+F focuses this input via a
 * custom `poe2:focus-search` window event handled by the toolbar.
 */
export default function SearchInput({ data, inputRef }: Readonly<SearchInputProps>) {
  const query = useStore((s) => s.searchQuery);
  const matches = useStore((s) => s.searchMatches);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const allocation = useStore((s) => s.allocation);
  const setSearch = useStore((s) => s.setSearch);
  const clearSearch = useStore((s) => s.clearSearch);
  const stepSearch = useStore((s) => s.stepSearch);

  const index = useMemo(() => buildSearchIndex(data), [data]);
  const [draft, setDraft] = useState(query);
  const pendingTimer = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(undefined);

  // Sync the visible draft to external clears (Esc hotkey, context switch)
  // via the "set state during render" pattern. The conditional guards against
  // infinite re-render — we only update when `query` actually moved. Doing
  // this in render (not useEffect) avoids an extra commit pass.
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    if (query === '') setDraft('');
  }

  // Debounced commit: every time `draft` changes, schedule a commit; clear
  // any pending one so only the last keystroke wins. Also re-runs when the
  // constraint-gate state changes (`ascendancyId`, `allocated`) so toggling
  // "The Unseen Path" reveals/hides matching gated nodes without forcing the
  // user to retype.
  useEffect(() => {
    const timer = pendingTimer.current = globalThis.setTimeout(() => {
      if (draft.trim().length === 0) {
        if (matches.length === 0 && draft === query) return;
        setSearch(draft, []);
        return;
      }
      const raw = findMatches(draft, index);
      // Filter against all allocated nodes so constraint-gated nodes hidden by
      // the current build aren't offered as matches.
      const ms = filterConstraintHidden(raw, data, ascendancyId, allAllocated(allocation));
      setSearch(draft, ms);
    }, DEBOUNCE_MS);
    return () => { globalThis.clearTimeout(timer); };
  }, [draft, query, index, data, ascendancyId, allocation, matches.length, setSearch]);

  const hasQuery = draft.length > 0;

  return (
    <div className="tree-search" style={containerStyle}>
      <input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            // Enter is an explicit navigation request for the text on screen.
            // Flush it now; neither an old result set nor its pending timer
            // may select a different target after this key press.
            globalThis.clearTimeout(pendingTimer.current);
            const state = useStore.getState();
            setSearch(draft, filterConstraintHidden(findMatches(draft, index), data,
              state.ascendancyId, allAllocated(state.allocation)));
            stepSearch(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            globalThis.clearTimeout(pendingTimer.current);
            setDraft('');
            clearSearch();
            inputRef.current?.blur();
          }
        }}
        placeholder="Search passive tree"
        aria-label="Search passive tree"
        style={inputStyle}
      />
      {hasQuery && (
        <button
          type="button"
          onClick={() => { globalThis.clearTimeout(pendingTimer.current); setDraft(''); clearSearch(); inputRef.current?.focus(); }}
          style={clearButtonStyle}
          title="Clear search (Esc)"
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  // Full-width search at the top of the toolbar content.
  display: 'flex',
  flexShrink: 0,
  minWidth: 0,
  alignItems: 'center',
  gap: 4,
  padding: '0 8px',
  background: palette.fieldBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 5,
  height: controlHeight,
  boxSizing: 'border-box',
};

const inputStyle: React.CSSProperties = {
  background: 'transparent',
  color: palette.textPrimary,
  border: 'none',
  outline: 'none',
  fontSize: 'var(--toolbar-input-font-size, 13px)',
  fontFamily: 'inherit',
  flex: 1,
  minWidth: 0,
  padding: 0,
};

const clearButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: palette.textMuted,
  border: 'none',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 2px',
};
