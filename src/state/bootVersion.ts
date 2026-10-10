import { VERSIONS, DEFAULT_VERSION } from '../data/versions';
import { decodeShareHash } from './shareHash';
import { loadPersistedSnapshot } from './persistence';

/** Select the version before loading assets, using URL > saved build > defaults. */
export function resolveBootVersion(hash: string): string {
  const hashVersion = decodeShareHash(hash)?.version;
  const installed = (version: string | undefined): version is string =>
    version !== undefined && (VERSIONS as readonly string[]).includes(version);
  if (installed(hashVersion)) return hashVersion;
  const savedVersion = loadPersistedSnapshot()?.version;
  return installed(savedVersion) ? savedVersion : DEFAULT_VERSION;
}
