import { useEffect, useRef, useState } from 'react';
import { useStore, countBudgets, effectiveBudgetCaps, ASCENDANCY_CAP } from '../state/store';
import type { TreeData } from '../data/types';
import { getPatchUpdateVersion, VERSIONS } from '../data/versions';
import BudgetChip from './BudgetChip';
import UndoRedoButtons from './UndoRedoButtons';
import ResetButton from './ResetButton';
import SearchInput from './SearchInput';
import ShareButton from './ShareButton';
import ExportBuildButton from './ExportBuildButton';
import AttributeControls from './AttributeControls';
import TreeVersionNotice from './TreeVersionNotice';
import { useIsMobile } from './useIsMobile';
import { palette, fontBody, fontDisplay, panelShadow } from './theme';
import './Toolbar.css';

/** Character setup, search, point counters, and build actions over the canvas. */
export default function Toolbar({ data }: Readonly<{ data: TreeData }>) {
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const allocation = useStore((s) => s.allocation);
  const allocationMode = useStore((s) => s.allocationMode);
  const weaponSetsEnabled = useStore((s) => s.weaponSetsEnabled);
  const activeVersion = useStore((s) => s.activeVersion);
  const setClass = useStore((s) => s.setClass);
  const setAscendancy = useStore((s) => s.setAscendancy);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const setAllocationMode = useStore((s) => s.setAllocationMode);
  const setWeaponSetsEnabled = useStore((s) => s.setWeaponSetsEnabled);
  const patchUpdateVersion = getPatchUpdateVersion(activeVersion);

  const isMobile = useIsMobile();
  // Use the initial viewport only: resizing must not discard an open panel.
  const [expanded, setExpanded] = useState(() => !isMobile);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (restoreFocus.current) {
      toggleRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [expanded]);
  const toggleExpanded = () => {
    restoreFocus.current = true;
    setExpanded((value) => !value);
  };

  const playableClasses = data.playableClassIndices
    .map((i) => data.classes[i])
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const activeClass = playableClasses.find((c) => c.name === className);
  const counts = countBudgets(allocation, ascendancyId, data);
  const caps = effectiveBudgetCaps(allocation, ascendancyId, data);

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
            <span>Tree version</span>
            <select aria-label="Version" value={activeVersion ?? ''}
              onChange={(e) => setActiveVersion(e.target.value)}>
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
        <SearchInput data={data} />
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

        <div className="toolbar-weapon-sets">
          <label className="toolbar-checkbox" title="Plan separate passives per weapon set">
            <input type="checkbox" checked={weaponSetsEnabled}
              onChange={(e) => setWeaponSetsEnabled(e.target.checked)} />
            <span>Weapon Sets</span>
          </label>
          {weaponSetsEnabled && (
            <fieldset className="toolbar-editing">
              <legend>Editing</legend>
              <div className="toolbar-segments">
                {([
                  ['shared', 'Main'], ['set1', 'Set 1'], ['set2', 'Set 2'],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={allocationMode === value}
                    onClick={() => setAllocationMode(value)}>{label}</button>
                ))}
              </div>
            </fieldset>
          )}
        </div>

        <div className="toolbar-row toolbar-budgets">
          <AttributeControls data={data} />
          {weaponSetsEnabled ? (
            <>
              <BudgetChip kind="passive" label="Shared" count={counts.shared} />
              <BudgetChip kind="weaponSet1" label="Set 1" count={counts.set1} cap={caps.weaponSet} />
              <BudgetChip kind="weaponSet2" label="Set 2" count={counts.set2} cap={caps.weaponSet} />
              <BudgetChip kind="passive" label="Active S1" count={counts.activeIn1}
                cap={caps.passive} note={unspentNote(caps.passive - counts.activeIn1)} />
              <BudgetChip kind="passive" label="Active S2" count={counts.activeIn2}
                cap={caps.passive} note={unspentNote(caps.passive - counts.activeIn2)} />
            </>
          ) : (
            <BudgetChip kind="passive" label="Passives" count={counts.shared} cap={caps.passive} />
          )}
          {ascendancyId && (
            <BudgetChip kind="ascendancy" label="Ascendancy" count={counts.ascendancy} cap={ASCENDANCY_CAP} />
          )}
        </div>

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

function unspentNote(unspent: number): string | undefined {
  if (unspent < 0) return undefined;
  return unspent === 0 ? 'full' : `${unspent} left`;
}

const themeVars = {
  '--toolbar-bg': palette.panelBg,
  '--toolbar-header': palette.headerBg,
  '--toolbar-field': palette.fieldBg,
  '--toolbar-border': palette.border,
  '--toolbar-divider': palette.divider,
  '--toolbar-text': palette.textPrimary,
  '--toolbar-title': palette.textTitle,
  '--toolbar-metal': palette.textMetal,
  '--toolbar-muted': palette.textMuted,
  '--toolbar-accent': palette.rune,
  '--toolbar-glow': palette.runeGlow,
  '--toolbar-shadow': panelShadow,
  '--toolbar-body-font': fontBody,
  '--toolbar-display-font': fontDisplay,
} as React.CSSProperties;
