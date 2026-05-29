import { useEffect } from 'react';
import { useStore } from './state/store';
import { loadTreeData } from './data/loader';
import { VERSIONS, DEFAULT_VERSION, DEFAULT_CLASS } from './data/versions';
import {
  buildAtlasBundle,
  classBackgroundName,
  STATIC_ATLAS_NAMES,
  type AtlasBundle,
} from './render/atlas';
import { loadPersistedSnapshot, reconcileSnapshot, startPersistence } from './state/persistence';
import { decodeShareHash, reconcileShareHash } from './state/shareHash';
import type { TreeData } from './data/types';
import TreeCanvas from './render/TreeCanvas';
import Toolbar from './ui/Toolbar';
import NodeTooltip from './ui/NodeTooltip';
import Attribution from './ui/Attribution';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { palette, fontDisplay, fontBody } from './ui/theme';

export default function App() {
  const status = useStore((s) => s.status);
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const activeVersion = useStore((s) => s.activeVersion);
  const retryToken = useStore((s) => s.retryToken);
  const setStatus = useStore((s) => s.setStatus);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const setClass = useStore((s) => s.setClass);
  const loadSnapshot = useStore((s) => s.loadSnapshot);
  const retry = useStore((s) => s.retry);

  useKeyboardShortcuts();

  // Pick the initial version once on mount: hash version (if installed) > default.
  // Then setting `activeVersion` kicks off the version-keyed load effect.
  useEffect(() => {
    const hashRaw = decodeShareHash(globalThis.location.hash);
    const desired = (hashRaw && (VERSIONS as readonly string[]).includes(hashRaw.version))
      ? hashRaw.version
      : DEFAULT_VERSION;
    setActiveVersion(desired);
  }, [setActiveVersion]);

  // Load data + atlases for the active version. Re-runs on version change;
  // cleanup destroys the previous bundle so WebGL textures don't leak (§10.8).
  // Boot precedence: URL hash > localStorage > defaults (§10.5).
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
        applyBootSnapshot(activeVersion, data, loadSnapshot, setClass);

        // Auto-persist AFTER restore so the initial loadSnapshot doesn't
        // immediately re-write the same bytes.
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
  }, [activeVersion, retryToken, setStatus, setClass, loadSnapshot]);

  // External hash changes (back/forward navigation, manual edit, paste). If
  // the hash names a different version, switch to it — the load effect will
  // pick up the hash on remount. Otherwise, apply the snapshot to the
  // already-loaded data.
  useEffect(() => {
    const handler = () => {
      const raw = decodeShareHash(globalThis.location.hash);
      if (!raw) return;
      const s = useStore.getState();
      if (raw.version !== s.activeVersion) {
        setActiveVersion(raw.version);
        return;
      }
      if (s.status.kind === 'ready') {
        const reconciled = reconcileShareHash(raw, s.status.data);
        if (reconciled) loadSnapshot(reconciled);
      }
    };
    globalThis.addEventListener('hashchange', handler);
    return () => { globalThis.removeEventListener('hashchange', handler); };
  }, [setActiveVersion, loadSnapshot]);

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
        <Attribution />
      </>
    );
  }

  return (
    <div style={overlayStyle}>
      <h1 style={loadingTitleStyle}>PoE 2 Skill Tree</h1>
      <p style={loadingSubtitleStyle}>
        {status.kind === 'idle' && 'Initialising…'}
        {status.kind === 'loading' &&
          `Loading skill tree ${status.version}…`}
      </p>
    </div>
  );
}

/** Pick an initial allocation/class state for the just-loaded version.
 *  Order: URL hash → localStorage → first-playable-class defaults. */
function applyBootSnapshot(
  version: string,
  data: TreeData,
  loadSnapshot: ReturnType<typeof useStore.getState>['loadSnapshot'],
  setClass: ReturnType<typeof useStore.getState>['setClass'],
): void {
  const hashRaw = decodeShareHash(globalThis.location.hash);
  if (hashRaw && hashRaw.version === version) {
    const reconciled = reconcileShareHash(hashRaw, data);
    if (reconciled) { loadSnapshot(reconciled); return; }
  }
  const persisted = loadPersistedSnapshot(version);
  const reconciledLs = persisted ? reconcileSnapshot(persisted, data) : null;
  if (reconciledLs) { loadSnapshot(reconciledLs); return; }

  const firstPlayable = firstPlayableClass(data);
  if (firstPlayable) setClass(firstPlayable.name);
}

/** The class `applyBootSnapshot` will end up selecting, resolved *without*
 *  mutating store state — so the loader can eager-load that class's background
 *  before the first render. Must mirror `applyBootSnapshot`'s precedence
 *  (hash → localStorage → first playable). A wrong guess is harmless: the lazy
 *  swapContext path loads whatever class actually renders. */
function resolveBootClassName(version: string, data: TreeData): string | null {
  const hashRaw = decodeShareHash(globalThis.location.hash);
  if (hashRaw && hashRaw.version === version) {
    const reconciled = reconcileShareHash(hashRaw, data);
    if (reconciled) return reconciled.className;
  }
  const persisted = loadPersistedSnapshot(version);
  const reconciledLs = persisted ? reconcileSnapshot(persisted, data) : null;
  if (reconciledLs) return reconciledLs.className;

  return firstPlayableClass(data)?.name ?? null;
}

function firstPlayableClass(data: TreeData) {
  const idx = data.playableClassIndices[0];
  return idx === undefined ? undefined : data.classes[idx];
}

/** The boot class, resolved *without* the parsed data so its background can
 *  start loading before data.json arrives. Every case is now answerable
 *  pre-parse since the share hash carries the class *name* (not a numeric
 *  index). Precedence mirrors `resolveBootClassName`:
 *   - share hash → its class name (unvalidated; a bogus name just 404s the
 *     preload, and the post-parse path picks the real class);
 *   - returning visitor → the saved class name (localStorage);
 *   - fresh visitor → {@link DEFAULT_CLASS}. */
function bootClassNameWithoutData(version: string): string {
  const hashRaw = decodeShareHash(globalThis.location.hash);
  if (hashRaw?.version === version) return hashRaw.className;
  return loadPersistedSnapshot(version)?.className ?? DEFAULT_CLASS;
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

// Loader title — same carved display font, glyph-blue, and rune glow as the
// tooltip header, scaled up for the splash.
const loadingTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: fontDisplay,
  fontWeight: 700,
  fontSize: 30,
  letterSpacing: 1,
  color: palette.textTitle,
  textShadow: `0 0 12px ${palette.runeGlow}, 0 1px 2px rgba(0, 0, 0, 0.8)`,
};

const loadingSubtitleStyle: React.CSSProperties = {
  marginTop: '0.6rem',
  // The text stays fully drawn; its rune-blue glow breathes (keyframes in
  // index.css) so the splash reads as "working" rather than frozen. A pulsing
  // glow instead of a text-reveal sweep, so it still looks right when loading
  // finishes before a single cycle completes.
  color: palette.textPrimary,
  animation: 'poe2-glow-pulse 1.6s ease-in-out infinite',
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
