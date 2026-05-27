import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { TreeData } from '../data/types';
import { buildSearchIndex, findMatches, filterConstraintHidden } from '../interaction/search';

const DEBOUNCE_MS = 120;

interface SearchInputProps {
  data: TreeData;
}

/**
 * Search input on the toolbar (INSTRUCTIONS.md §10.1).
 *
 *   `[🔍 input               ] [3/12] [×]`
 *
 * Debounces the keystroke → matches recompute by 120 ms so per-keystroke
 * scans coalesce. The search index itself is memoised on `data` — rebuilt
 * only when a different version is loaded.
 *
 * Keyboard handled here (not in the global hook): Enter / Shift+Enter step
 * through matches; Esc clears. Global Ctrl/Cmd+F focuses this input via a
 * custom `poe2:focus-search` window event.
 */
export default function SearchInput({ data }: Readonly<SearchInputProps>) {
  const query = useStore((s) => s.searchQuery);
  const matches = useStore((s) => s.searchMatches);
  const cursor = useStore((s) => s.searchCursor);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const allocated = useStore((s) => s.allocated);
  const setSearch = useStore((s) => s.setSearch);
  const clearSearch = useStore((s) => s.clearSearch);
  const stepSearch = useStore((s) => s.stepSearch);

  const index = useMemo(() => buildSearchIndex(data), [data]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(query);

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
    const timer = globalThis.setTimeout(() => {
      if (draft.trim().length === 0) {
        if (matches.length === 0 && draft === query) return;
        setSearch(draft, []);
        return;
      }
      const raw = findMatches(draft, index);
      const ms = filterConstraintHidden(raw, data, ascendancyId, allocated);
      setSearch(draft, ms);
    }, DEBOUNCE_MS);
    return () => { globalThis.clearTimeout(timer); };
  }, [draft, query, index, data, ascendancyId, allocated, matches.length, setSearch]);

  // Focus the input on global Ctrl/Cmd+F (dispatched by useKeyboardShortcuts).
  useEffect(() => {
    const handler = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    globalThis.addEventListener('poe2:focus-search', handler);
    return () => { globalThis.removeEventListener('poe2:focus-search', handler); };
  }, []);

  const hasQuery = draft.length > 0;
  const total = matches.length;
  const display1Based = computeDisplayIndex(cursor, total);

  return (
    <div style={containerStyle}>
      <span style={iconStyle} aria-hidden>🔍</span>
      <input
        ref={inputRef}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            stepSearch(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
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
        <span style={chipStyle} aria-live="polite">
          {total === 0 ? 'no matches' : `${display1Based}/${total}`}
        </span>
      )}
      {hasQuery && (
        <button
          type="button"
          onClick={() => { setDraft(''); clearSearch(); inputRef.current?.focus(); }}
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

/** 1-based index displayed in the count chip. With no specific cursor active
 *  (`cursor === -1`), the chip shows "1/total" if there are matches, else "0/0". */
function computeDisplayIndex(cursor: number, total: number): number {
  if (cursor >= 0) return cursor + 1;
  return total > 0 ? 1 : 0;
}

const containerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  background: '#1c1812',
  border: '1px solid #4a3f28',
  borderRadius: 3,
  height: 28,
};

const iconStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.55,
  paddingTop: 2,
};

const inputStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#ddd',
  border: 'none',
  outline: 'none',
  fontSize: 13,
  fontFamily: 'inherit',
  width: 160,
  padding: 0,
};

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#e4d8b8',
  opacity: 0.75,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const clearButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#ddd',
  border: 'none',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 2px',
  opacity: 0.7,
};
