import { loadTreeData } from '../data/loader';
import { copyToTreeVersion } from './buildActions';
import { useBuildLibrary } from './buildLibrary';
import { readSnapshot, reconcileSnapshot } from './persistence';
import { useStore, type BuildSnapshot } from './store';

interface VersionChangeSource {
  request: number;
  buildId: string | null;
  version: string;
  fingerprint: string;
}

export interface BuildVersionChange {
  source: VersionChangeSource;
  targetVersion: string;
  snapshot: Omit<BuildSnapshot, 'version'>;
  droppedKeys: string[];
  droppedAttributeChoices: number;
  ascendancyCleared: boolean;
  defaultAttributeCleared: boolean;
}

type StaleReason = 'superseded' | 'edited';
interface VersionChangeFeedback {
  reviewLosses?: (change: BuildVersionChange) => void;
  reportError?: (message: string) => void;
  reportEdit?: () => void;
}

let versionRequest = 0;

function staleReason(source: VersionChangeSource): StaleReason | null {
  if (source.request !== versionRequest || source.version !== useStore.getState().activeVersion ||
    source.buildId !== useBuildLibrary.getState().library.activeId) return 'superseded';
  return JSON.stringify(readSnapshot(source.version)) === source.fingerprint ? null : 'edited';
}

export async function changeBuildVersion(targetVersion: string, {
  reviewLosses,
  reportError = (message) => useStore.getState().setValidationMessage(message),
  reportEdit,
}: VersionChangeFeedback = {}): Promise<void> {
  // Both controls supersede prior requests, even when selecting the current version.
  const request = ++versionRequest;
  const { activeVersion } = useStore.getState();
  if (targetVersion === activeVersion) return;
  const before = activeVersion ? readSnapshot(activeVersion) : null;
  if (!before) {
    reportError('The current build could not be read.');
    return;
  }

  const source = {
    request,
    buildId: useBuildLibrary.getState().library.activeId,
    version: before.version,
    fingerprint: JSON.stringify(before),
  };
  let snapshot: BuildVersionChange['snapshot'] | null;
  try {
    const data = await loadTreeData(targetVersion);
    const stale = staleReason(source);
    if (stale === 'edited') reportEdit?.();
    if (stale) return;
    snapshot = reconcileSnapshot(before, data);
  } catch {
    const stale = staleReason(source);
    if (stale === 'edited') reportEdit?.();
    if (!stale) reportError('Could not load that tree version. Your current build has been kept.');
    return;
  }
  if (!snapshot) {
    reportError(`This build cannot be carried into tree ${targetVersion}.`);
    return;
  }

  const kept = new Set([...snapshot.shared, ...snapshot.set1, ...snapshot.set2]);
  const droppedKeys = [...before.shared, ...before.set1, ...before.set2].filter((key) => !kept.has(key));
  const droppedAttributeChoices = Object.entries(before.attributeChoices ?? {})
    .filter(([key, choice]) => snapshot.attributeChoices?.[key] !== choice).length;
  const ascendancyCleared = before.ascendancyId !== snapshot.ascendancyId;
  const defaultAttributeCleared = before.defaultAttribute !== snapshot.defaultAttribute;
  const change = {
    source, targetVersion, snapshot, droppedKeys, droppedAttributeChoices, ascendancyCleared, defaultAttributeCleared,
  };
  if (droppedKeys.length || droppedAttributeChoices || ascendancyCleared || defaultAttributeCleared) {
    if (reviewLosses) {
      reviewLosses(change);
      return;
    }
    if (!globalThis.confirm(`Create a copy for tree ${targetVersion}? Some allocations or attribute choices are unavailable and will be removed. Your original build will be kept.`)) return;
  }
  commitBuildVersionChange(change);
}

/** Recheck the source after confirmation, then save the conversion as a separate build. */
export function commitBuildVersionChange(change: BuildVersionChange): StaleReason | 'saved' | 'save-failed' {
  const { source, targetVersion, snapshot } = change;
  const stale = staleReason(source);
  if (stale) return stale;
  return copyToTreeVersion(targetVersion, snapshot) ? 'saved' : 'save-failed';
}
