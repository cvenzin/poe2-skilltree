import { useEffect, useState } from 'react';
import type { BuildSnapshot } from '../state/store';
import { useStore } from '../state/store';
import { loadTreeData } from '../data/loader';
import { getPatchUpdateVersion } from '../data/versions';
import { readSnapshot, reconcileSnapshot } from '../state/persistence';
import type { TreeData } from '../data/types';
import { palette, fontBody, controlHeight } from './theme';

interface PendingUpdate {
  sourceVersion: string;
  targetVersion: string;
  snapshot: Omit<BuildSnapshot, 'version'>;
  droppedNames: string[];
  droppedAttributeChoices: number;
  ascendancyCleared: boolean;
  defaultAttributeCleared: boolean;
}

export default function TreeVersionNotice({ data }: Readonly<{ data: TreeData }>) {
  const activeVersion = useStore((s) => s.activeVersion);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const targetVersion = getPatchUpdateVersion(activeVersion);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpdate | null>(null);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPending(null);
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [pending]);

  if (!targetVersion || !activeVersion) return null;

  const checkUpdate = async () => {
    const sourceVersion = activeVersion;
    const source = readSnapshot(sourceVersion);
    if (!source) {
      setError('The current build could not be read.');
      return;
    }

    setChecking(true);
    setError(null);
    setPending(null);
    try {
      const targetData = await loadTreeData(targetVersion);
      if (useStore.getState().activeVersion !== sourceVersion) return;

      const snapshot = reconcileSnapshot(source, targetData);
      if (!snapshot) {
        setError(`This build cannot be carried into tree ${targetVersion}.`);
        return;
      }

      const kept = new Set([...snapshot.shared, ...snapshot.set1, ...snapshot.set2]);
      const droppedKeys = [...source.shared, ...source.set1, ...source.set2]
        .filter((key) => !kept.has(key));
      const droppedAttributeChoices = Object.entries(source.attributeChoices ?? {})
        .filter(([key, choice]) => snapshot.attributeChoices?.[key] !== choice).length;
      const ascendancyCleared = Boolean(source.ascendancyId && snapshot.ascendancyId !== source.ascendancyId);
      const defaultAttributeCleared = Boolean(source.defaultAttribute && snapshot.defaultAttribute !== source.defaultAttribute);
      if (droppedKeys.length === 0 && droppedAttributeChoices === 0 && !ascendancyCleared && !defaultAttributeCleared) {
        setActiveVersion(targetVersion, snapshot);
        return;
      }

      setPending({
        sourceVersion,
        targetVersion,
        snapshot,
        droppedNames: droppedKeys.map((key) => data.nodes[key]?.name ?? `Node ${key}`),
        droppedAttributeChoices,
        ascendancyCleared,
        defaultAttributeCleared,
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not check the new tree version.');
    } finally {
      setChecking(false);
    }
  };

  const confirmUpdate = () => {
    if (!pending || useStore.getState().activeVersion !== pending.sourceVersion) return;
    setActiveVersion(pending.targetVersion, pending.snapshot);
    setPending(null);
  };

  const visiblePending = pending?.sourceVersion === activeVersion ? pending : null;

  return (
    <>
      <div style={noticeStyle}>
        <span>Patch {targetVersion} available</span>
        <button type="button" onClick={checkUpdate} disabled={checking} style={updateButtonStyle}>
          {checking ? 'Checking…' : 'Update'}
        </button>
        {error && <span role="alert" style={errorStyle}>{error}</span>}
      </div>

      {visiblePending && (
        <div style={backdropStyle}>
          <section role="dialog" aria-modal="true" aria-labelledby="tree-update-title" style={dialogStyle}>
            <h2 id="tree-update-title" style={dialogTitleStyle}>Update to tree {visiblePending.targetVersion}?</h2>
            {visiblePending.droppedNames.length > 0 && (
              <>
                <p style={dialogTextStyle}>
                  {visiblePending.droppedNames.length} allocated {visiblePending.droppedNames.length === 1 ? 'node will' : 'nodes will'} be removed to keep the build valid in this tree version.
                </p>
                <ul style={nodeListStyle}>
                  {visiblePending.droppedNames.slice(0, 5).map((name, index) => (
                    <li key={`${name}-${index}`}>{name}</li>
                  ))}
                  {visiblePending.droppedNames.length > 5 && (
                    <li>And {visiblePending.droppedNames.length - 5} more</li>
                  )}
                </ul>
              </>
            )}
            {visiblePending.ascendancyCleared && (
              <p style={dialogTextStyle}>The selected ascendancy will be cleared.</p>
            )}
            {visiblePending.droppedAttributeChoices > 0 && (
              <p style={dialogTextStyle}>
                {visiblePending.droppedAttributeChoices} attribute {visiblePending.droppedAttributeChoices === 1 ? 'choice will' : 'choices will'} be cleared.
              </p>
            )}
            {visiblePending.defaultAttributeCleared && (
              <p style={dialogTextStyle}>The default attribute choice will be cleared.</p>
            )}
            <div style={dialogActionsStyle}>
              <button type="button" onClick={() => setPending(null)} style={cancelButtonStyle}>Cancel</button>
              <button type="button" onClick={confirmUpdate} style={confirmButtonStyle} autoFocus>
                Update tree
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const noticeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 7,
  height: controlHeight,
  minHeight: controlHeight,
  boxSizing: 'border-box',
  color: palette.textStat,
  fontSize: 12,
  fontFamily: fontBody,
};

const updateButtonStyle: React.CSSProperties = {
  height: controlHeight,
  padding: '0 9px',
  boxSizing: 'border-box',
  border: `1px solid ${palette.rune}`,
  borderRadius: 3,
  background: palette.fieldBg,
  color: palette.textTitle,
  fontSize: 12,
  fontFamily: fontBody,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  flexBasis: '100%',
  color: palette.dangerText,
  fontSize: 11,
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  boxSizing: 'border-box',
  background: 'rgba(0, 0, 0, 0.65)',
  zIndex: 200,
};

const dialogStyle: React.CSSProperties = {
  width: 'min(420px, 100%)',
  padding: 18,
  boxSizing: 'border-box',
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  background: palette.panelBgSolid,
  color: palette.textPrimary,
  fontFamily: fontBody,
  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.7)',
};

const dialogTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  color: palette.textTitle,
  fontSize: 17,
  fontWeight: 600,
};

const dialogTextStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 13,
  lineHeight: 1.5,
};

const nodeListStyle: React.CSSProperties = {
  margin: '0 0 16px',
  paddingLeft: 20,
  color: palette.textMetal,
  fontSize: 12,
  lineHeight: 1.6,
};

const dialogActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '5px 11px',
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  background: 'transparent',
  color: palette.textPrimary,
  fontSize: 13,
  fontFamily: fontBody,
  cursor: 'pointer',
};

const confirmButtonStyle: React.CSSProperties = {
  ...cancelButtonStyle,
  borderColor: palette.rune,
  background: palette.fieldBg,
  color: palette.textTitle,
};
