import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { TreeData } from '../data/types';
import { getPatchUpdateVersion, VERSIONS } from '../data/versions';
import WeaponSetControls from './WeaponSetControls';
import UndoRedoButtons from './UndoRedoButtons';
import ResetButton from './ResetButton';
import SearchInput from './SearchInput';
import ShareButton from './ShareButton';
import ExportBuildButton from './ExportBuildButton';
import AttributeControls from './AttributeControls';
import TreeVersionNotice from './TreeVersionNotice';
import BuildLibraryControls from './BuildLibraryControls';
import { changeBuildVersion } from '../state/buildActions';
import { useIsMobile } from './useIsMobile';
import { palette, fontBody, fontDisplay, panelShadow } from './theme';
import './Toolbar.css';

/** Character setup, search, point counters, and build actions over the canvas. */
export default function Toolbar({ data }: Readonly<{ data: TreeData }>) {
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const activeVersion = useStore((s) => s.activeVersion);
  const setClass = useStore((s) => s.setClass);
  const setAscendancy = useStore((s) => s.setAscendancy);
  const patchUpdateVersion = getPatchUpdateVersion(activeVersion);

  const isMobile = useIsMobile();
  // Use the initial viewport only: resizing must not discard an open panel.
  const [expanded, setExpanded] = useState(() => !isMobile);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnExpand = useRef(false);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (focusSearchOnExpand.current) {
      searchRef.current?.focus();
      searchRef.current?.select();
      focusSearchOnExpand.current = false;
    } else if (restoreFocus.current) {
      toggleRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [expanded]);
  // The toolbar stays mounted when collapsed; the search input does not.
  useEffect(() => {
    const handler = () => {
      restoreFocus.current = false;
      if (searchRef.current) {
        searchRef.current.focus();
        searchRef.current.select();
      } else {
        focusSearchOnExpand.current = true;
        setExpanded(true);
      }
    };
    globalThis.addEventListener('poe2:focus-search', handler);
    return () => { globalThis.removeEventListener('poe2:focus-search', handler); };
  }, []);
  const toggleExpanded = () => {
    restoreFocus.current = true;
    setExpanded((value) => !value);
  };

  const playableClasses = data.playableClassIndices
    .map((i) => data.classes[i])
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const activeClass = playableClasses.find((c) => c.name === className);

  if (!expanded) {
    return (
      <>
        <button ref={toggleRef} type="button" className="toolbar-toggle" style={themeVars}
          aria-label={patchUpdateVersion ? `Open build controls. Patch ${patchUpdateVersion} is available.` : 'Open build controls'}
          aria-expanded={false} aria-controls="tree-toolbar-content" onClick={toggleExpanded}>
          <span>Build</span>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {patchUpdateVersion && <span className="toolbar-update">Update</span>}
        </button>
        {/* Keep node and first-allocation dialogs available with the menu closed. */}
        <AttributeControls data={data} showTrigger={false} />
      </>
    );
  }

  return (
    <div className="tree-toolbar" style={themeVars} role="region" aria-label="Build planner">
      <header className="toolbar-header">
        <span className="toolbar-title">Build planner</span>
        {VERSIONS.length > 1 && (
          <label className="toolbar-version">
            <span>Game patch</span>
            <select aria-label="Game patch" value={activeVersion ?? ''}
              onChange={(e) => { void changeBuildVersion(e.target.value); }}>
              {VERSIONS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        )}
        <button ref={toggleRef} type="button" className="toolbar-close" aria-label="Collapse toolbar"
          aria-expanded={true} aria-controls="tree-toolbar-content" onClick={toggleExpanded}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div id="tree-toolbar-content" className="toolbar-content">
        <BuildLibraryControls data={data} />
        <TreeVersionNotice data={data} />
        <div className="toolbar-character">
          <label className="toolbar-field">
            <span>Class</span>
            <select value={className ?? ''} onChange={(e) => setClass(e.target.value)}>
              {playableClasses.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="toolbar-field">
            <span>Ascendancy</span>
            <select value={ascendancyId ?? ''} onChange={(e) => setAscendancy(e.target.value || null)}
              disabled={!activeClass || activeClass.ascendancies.length === 0}>
              <option value="">(none)</option>
              {activeClass?.ascendancies.filter((a) => data.playableAscendancyIds.has(a.id))
                .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>

        <SearchInput data={data} inputRef={searchRef} />
        <WeaponSetControls data={data} />
        <AttributeControls data={data} />

        <div className="toolbar-actions">
          <div className="toolbar-row toolbar-history">
            <UndoRedoButtons />
            <ResetButton />
          </div>
          <div className="toolbar-row toolbar-output">
            <ShareButton />
            <ExportBuildButton data={data} />
          </div>
        </div>
      </div>
    </div>
  );
}

const themeVars = {
  '--toolbar-bg': palette.panelBg,
  '--toolbar-header': palette.headerBg,
  '--toolbar-dialog': palette.panelBgSolid,
  '--toolbar-field': palette.fieldBg,
  '--toolbar-border': palette.border,
  '--toolbar-divider': palette.divider,
  '--toolbar-text': palette.textPrimary,
  '--toolbar-title': palette.textTitle,
  '--toolbar-metal': palette.textMetal,
  '--toolbar-muted': palette.textMuted,
  '--toolbar-danger': palette.dangerText,
  '--toolbar-danger-bg': palette.dangerBg,
  '--toolbar-accent': palette.rune,
  '--toolbar-glow': palette.runeGlow,
  '--toolbar-shadow': panelShadow,
  '--toolbar-body-font': fontBody,
  '--toolbar-display-font': fontDisplay,
} as React.CSSProperties;
