import { useEffect } from 'react';
import { useStore } from './state/store';
import { loadTreeData } from './data/loader';
import { VERSIONS } from './data/versions';
import { resolveBootVersion } from './state/bootVersion';
import {
  buildAtlasBundle,
  classBackgroundName,
  STATIC_ATLAS_NAMES,
  type AtlasBundle,
} from './render/atlas';
import { reconcileSnapshot, startPersistence } from './state/persistence';
import { initializeBuildLibrary } from './state/buildLibrary';
import { applyBootSnapshot, bootClassNameWithoutData, handleSharedHashChange, resolveBootClassName } from './state/buildRestore';
import TreeCanvas from './render/TreeCanvas';
import Toolbar from './ui/Toolbar';
import NodeTooltip from './ui/NodeTooltip';
import ValidationToast from './ui/ValidationToast';
import Attribution from './ui/Attribution';
import LoadingScreen from './ui/LoadingScreen';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { palette, fontBody } from './ui/theme';

export default function App() {
  const status = useStore((s) => s.status);
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const activeVersion = useStore((s) => s.activeVersion);
  const retryToken = useStore((s) => s.retryToken);
  const setStatus = useStore((s) => s.setStatus);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const loadSnapshot = useStore((s) => s.loadSnapshot);
  const retry = useStore((s) => s.retry);

  useKeyboardShortcuts();

  // Pick the initial version once: installed hash > saved build > default.
  // Then setting `activeVersion` kicks off the version-keyed load effect.
  useEffect(() => {
    initializeBuildLibrary();
    setActiveVersion(resolveBootVersion(globalThis.location.hash));
  }, [setActiveVersion]);

  // Load data + atlases for the active version. Re-runs on version change;
  // cleanup destroys the previous bundle so WebGL textures don't leak.
  // Boot precedence: URL hash > localStorage > defaults.
  useEffect(() => {
    if (!activeVersion) return;
    let cancelled = false;
    let loadedBundle: AtlasBundle | null = null;
    let stopPersist: (() => void) | null = null;
    (async () => {
      try {
        setStatus({ kind: 'loading', version: activeVersion });

        // Build the bundle now and load every atlas through it, so the bundle
        // owns all texture lifecycle — cleanup below just calls destroy(), and
        // in-flight loads that land after teardown free themselves. Nothing
        // reads the bundle until `ready`, so starting empty is safe.
        const atlases = buildAtlasBundle(activeVersion, []);
        loadedBundle = atlases;

        // Static atlases don't depend on the data — load them in parallel with
        // `data.json` so the slow WebP decode overlaps the JSON fetch/parse.
        // Critical: a failure here means we can't render, so it propagates.
        const staticReady = Promise.all(STATIC_ATLAS_NAMES.map((n) => atlases.ensure(n)));
        staticReady.catch(() => { /* real handling at the await below */ });

        // The boot class is known without the parsed data — the share hash now
        // carries the class name, localStorage the saved name, else the default
        // — so start its background (the single biggest asset) right now, before
        // data.json even downloads. Best-effort; the authoritative ensure after
        // parse corrects any mismatch (e.g. a hash with a bogus class name).
        const earlyClass = bootClassNameWithoutData(activeVersion);
        atlases.ensure(classBackgroundName(earlyClass)).catch(() => { /* covered below */ });

        const data = await loadTreeData(activeVersion);
        if (cancelled) return; // cleanup's destroy() frees the bundle + in-flight loads

        await staticReady; // throws → error screen if a static atlas failed
        if (cancelled) return;

        // Authoritative boot class (covers hash + first-playable). Dedupes with
        // the early load when they agree; otherwise the lazy swapContext path
        // repaints the backdrop once this lands.
        const bootClass = resolveBootClassName(activeVersion, data);
        if (bootClass) {
          atlases.ensure(classBackgroundName(bootClass)).catch(() => { /* lazy path retries */ });
        }

        setStatus({ kind: 'ready', version: activeVersion, data, atlases });
        const migration = useStore.getState().pendingVersionMigration;
        if (migration?.version === activeVersion) {
          const migrated = reconcileSnapshot({ version: activeVersion, ...migration.snapshot }, data);
          useStore.getState().clearPendingVersionMigration();
          if (migrated) {
            loadSnapshot(migrated);
          } else {
            applyBootSnapshot(activeVersion, data, loadSnapshot);
            useStore.getState().setValidationMessage('The build could not be carried into this tree version.');
          }
        } else {
          applyBootSnapshot(activeVersion, data, loadSnapshot);
        }

        // Start AFTER restore so the saved build includes the loaded version
        // and reconciled allocation. Unchanged saved builds are not rewritten.
        stopPersist = startPersistence(activeVersion);
      } catch (e: unknown) {
        if (cancelled) return;
        setStatus({
          kind: 'error',
          version: activeVersion,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
      stopPersist?.();
      loadedBundle?.destroy();
    };
  }, [activeVersion, retryToken, setStatus, loadSnapshot]);

  // External hash changes (back/forward navigation, manual edit, paste). If
  // the hash names a different version, switch to it — the load effect will
  // pick up the hash on remount. Otherwise, apply the snapshot to the
  // already-loaded data.
  useEffect(() => {
    globalThis.addEventListener('hashchange', handleSharedHashChange);
    return () => { globalThis.removeEventListener('hashchange', handleSharedHashChange); };
  }, []);

  if (status.kind === 'error') {
    return (
      <div style={overlayStyle}>
        <div style={errCardStyle} role="alert">
          <h2 style={{ margin: 0, fontWeight: 500, fontSize: 18 }}>Couldn't load the skill tree</h2>
          <pre style={errMsgStyle}>{status.message}</pre>
          {status.version && (
            <p style={{ opacity: 0.6, margin: 0, fontSize: 12 }}>
              Expected files under <code>app/public/trees/{status.version}/</code>.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={retry} style={retryButtonStyle}>
              Retry
            </button>
            {VERSIONS.length > 1 && (
              <select
                value={activeVersion ?? ''}
                onChange={(e) => setActiveVersion(e.target.value)}
                style={retrySelectStyle}
                aria-label="Try a different version"
              >
                {VERSIONS.map((v) => (
                  <option key={v} value={v}>Try {v}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status.kind === 'ready' && className) {
    return (
      <>
        <TreeCanvas
          data={status.data}
          atlases={status.atlases}
          className={className}
          ascendancyId={ascendancyId}
        />
        <Toolbar data={status.data} />
        <NodeTooltip />
        <ValidationToast />
        <Attribution />
      </>
    );
  }

  return <LoadingScreen key={`${activeVersion}:${retryToken}`} version={activeVersion} />;
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  fontFamily: fontBody,
  color: palette.textPrimary,
  background: palette.panelBgSolid,
};

const errCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  maxWidth: 520,
  padding: '20px 24px',
  background: 'rgba(30, 18, 18, 0.95)',
  border: '1px solid #8a4a4a',
  borderRadius: 6,
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
};

const errMsgStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  background: '#0f0808',
  border: '1px solid #4a2a2a',
  borderRadius: 3,
  whiteSpace: 'pre-wrap',
  fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  fontSize: 12,
  color: '#f88',
};

const retryButtonStyle: React.CSSProperties = {
  background: '#1c1812',
  color: '#ddd',
  border: '1px solid #6b5a3a',
  borderRadius: 3,
  padding: '5px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

const retrySelectStyle: React.CSSProperties = {
  background: '#1c1812',
  color: '#ddd',
  border: '1px solid #4a3f28',
  borderRadius: 3,
  padding: '5px 6px',
  fontSize: 13,
  cursor: 'pointer',
};
