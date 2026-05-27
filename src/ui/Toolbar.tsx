import { useStore, countBudgets } from '../state/store';
import type { TreeData } from '../data/types';
import { VERSIONS } from '../data/versions';
import BudgetChip from './BudgetChip';
import UndoRedoButtons from './UndoRedoButtons';
import ResetButton from './ResetButton';
import SearchInput from './SearchInput';
import ShareButton from './ShareButton';

/**
 * Top-left toolbar (INSTRUCTIONS.md §10):
 *   - Class dropdown (filters out PoE 1 placeholder classes, §2)
 *   - Ascendancy dropdown (filtered to playable ascendancies of the active class)
 *   - Passive budget chip (N / 123, editable cap)
 *   - Ascendancy budget chip (N / 8, only when an ascendancy is picked)
 *   - Undo / Redo
 *   - Reset (with confirm popover when allocated > 10, §9.1)
 *
 * Version dropdown, share button, and search input belong to later sub-phases.
 */
interface ToolbarProps {
  data: TreeData;
}

export default function Toolbar({ data }: Readonly<ToolbarProps>) {
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const allocated = useStore((s) => s.allocated);
  const passiveCap = useStore((s) => s.passiveCap);
  const ascendancyCap = useStore((s) => s.ascendancyCap);
  const activeVersion = useStore((s) => s.activeVersion);
  const setClass = useStore((s) => s.setClass);
  const setAscendancy = useStore((s) => s.setAscendancy);
  const setPassiveCap = useStore((s) => s.setPassiveCap);
  const setAscendancyCap = useStore((s) => s.setAscendancyCap);
  const setActiveVersion = useStore((s) => s.setActiveVersion);

  const playableClasses = data.playableClassIndices
    .map((i) => data.classes[i])
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const activeClass = playableClasses.find((c) => c.name === className);

  const counts = countBudgets(allocated, ascendancyId, data);

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <SearchInput data={data} />
        {VERSIONS.length > 1 && (
          <label style={labelStyle}>
            <span>Version</span>
            <select
              value={activeVersion ?? ''}
              onChange={(e) => setActiveVersion(e.target.value)}
              style={selectStyle}
            >
              {VERSIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <label style={labelStyle}>
          <span>Class</span>
          <select
            value={className ?? ''}
            onChange={(e) => setClass(e.target.value)}
            style={selectStyle}
          >
            {playableClasses.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          <span>Ascendancy</span>
          <select
            value={ascendancyId ?? ''}
            onChange={(e) => setAscendancy(e.target.value || null)}
            disabled={!activeClass || activeClass.ascendancies.length === 0}
            style={selectStyle}
          >
            <option value="">(none)</option>
            {activeClass?.ascendancies
              .filter((a) => data.playableAscendancyIds.has(a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
        </label>
      </div>

      <div style={rowStyle}>
        <BudgetChip
          kind="passive"
          label="Passives"
          count={counts.passive}
          cap={passiveCap}
          onCapChange={setPassiveCap}
          minCap={1}
          maxCap={200}
        />
        {ascendancyId && (
          <BudgetChip
            kind="ascendancy"
            label="Ascendancy"
            count={counts.ascendancy}
            cap={ascendancyCap}
            onCapChange={setAscendancyCap}
            minCap={1}
            maxCap={16}
          />
        )}
        <div style={spacerStyle} />
        <UndoRedoButtons />
        <ResetButton />
        <ShareButton data={data} />
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 12px',
  background: 'rgba(20, 16, 10, 0.85)',
  border: '1px solid #6b5a3a',
  borderRadius: 6,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  color: '#ddd',
  zIndex: 10,
  pointerEvents: 'auto',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 11,
  opacity: 0.7,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const selectStyle: React.CSSProperties = {
  background: '#1c1812',
  color: '#ddd',
  border: '1px solid #4a3f28',
  borderRadius: 3,
  padding: '4px 6px',
  fontSize: 13,
  minWidth: 140,
  cursor: 'pointer',
};

/** Pushes Undo/Reset to the right edge of the bottom row. */
const spacerStyle: React.CSSProperties = {
  flex: 1,
};
