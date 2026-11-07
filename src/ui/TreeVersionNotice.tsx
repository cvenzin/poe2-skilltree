import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { getPatchUpdateVersion } from '../data/versions';
import { changeBuildVersion, commitBuildVersionChange, type BuildVersionChange } from '../state/buildVersionChange';
import { useBuildLibrary } from '../state/buildLibrary';
import type { TreeData } from '../data/types';
import { palette, fontBody, controlHeight } from './theme';

export default function TreeVersionNotice({ data }: Readonly<{ data: TreeData }>) {
  const activeVersion = useStore((s) => s.activeVersion);
  const activeId = useBuildLibrary((s) => s.library.activeId);
  const targetVersion = getPatchUpdateVersion(activeVersion);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<BuildVersionChange | null>(null);

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
    setChecking(true);
    setError(null);
    setPending(null);
    try {
      await changeBuildVersion(targetVersion, {
        reviewLosses: setPending,
        reportError: setError,
        reportEdit: () => setError('The build changed while checking. Check the update again.'),
      });
    } finally {
      setChecking(false);
    }
  };

  const confirmUpdate = () => {
    if (!pending) return;
    if (commitBuildVersionChange(pending) === 'edited') {
      setError('The build changed. Check the update again.');
    }
    setPending(null);
  };

  const visiblePending = pending?.source.version === activeVersion && pending.source.buildId === activeId ? pending : null;
  const droppedNames = visiblePending?.droppedKeys.map((key) => data.nodes[key]?.name ?? `Node ${key}`) ?? [];

  return (
    <>
      <div style={noticeStyle}>
        <span>Patch {targetVersion} available</span>
        <button type="button" onClick={() => { void checkUpdate(); }} disabled={checking} style={updateButtonStyle}>
          {checking ? 'Checking…' : 'Update a copy'}
        </button>
        {error && <span role="alert" style={errorStyle}>{error}</span>}
      </div>

      {visiblePending && (
        <div style={backdropStyle}>
          <section role="dialog" aria-modal="true" aria-labelledby="tree-update-title" style={dialogStyle}>
            <h2 id="tree-update-title" style={dialogTitleStyle}>Copy to tree {visiblePending.targetVersion}?</h2>
            <p style={dialogTextStyle}>Your original build will be kept.</p>
            {droppedNames.length > 0 && (
              <>
                <p style={dialogTextStyle}>
                  {droppedNames.length} allocated {droppedNames.length === 1 ? 'node will' : 'nodes will'} be removed to keep the build valid in this tree version.
                </p>
                <ul style={nodeListStyle}>
                  {droppedNames.slice(0, 5).map((name, index) => (
                    <li key={`${name}-${index}`}>{name}</li>
                  ))}
                  {droppedNames.length > 5 && (
                    <li>And {droppedNames.length - 5} more</li>
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
                Update a copy
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
  minHeight: controlHeight,
  boxSizing: 'border-box',
  color: palette.textStat,
  fontSize: 'var(--font-hint)',
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
  fontSize: 'var(--font-ui)',
  fontFamily: fontBody,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  flexBasis: '100%',
  color: palette.dangerText,
  fontSize: 'var(--font-hint)',
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
  maxHeight: 'calc(100dvh - 32px)',
  overflowY: 'auto',
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
  fontSize: 'var(--font-node-title)',
  fontWeight: 600,
};

const dialogTextStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 'var(--font-body)',
  lineHeight: 1.5,
};

const nodeListStyle: React.CSSProperties = {
  margin: '0 0 16px',
  paddingLeft: 20,
  color: palette.textMetal,
  fontSize: 'var(--font-hint)',
  lineHeight: 1.6,
};

const dialogActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '5px 11px',
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  background: 'transparent',
  color: palette.textPrimary,
  fontSize: 'var(--font-ui)',
  fontFamily: fontBody,
  cursor: 'pointer',
};

const confirmButtonStyle: React.CSSProperties = {
  ...cancelButtonStyle,
  borderColor: palette.rune,
  background: palette.fieldBg,
  color: palette.textTitle,
};
