import type { TreeData } from '../data/types';
import type { BuildSnapshot } from './store';
import { buildAllocation, pruneAllocation } from './allocation';

/**
 * URL share-hash format (INSTRUCTIONS.md §10.4):
 *
 *   #v=<version>&c=<className>&a=<ascendancyId>&n=<…>&w1=<…>&w2=<…>&ws=<1|2>
 *
 *   v   version string (e.g. "0.5.0")
 *   c   class name (e.g. "Witch"). Position-independent (survives export
 *       reorders) and resolvable without parsing data.json — so a shared link's
 *       class is known before the data loads (App.tsx eager background load).
 *   a   ascendancy id (e.g. "Witch3"), omitted when none is selected. The
 *       internal id — not the display name — so it survives ascendancy reworks.
 *   n   shared allocations — sorted-ascending numeric node keys, delta-encoded
 *       LEB128 varints, base64url
 *   w1  Weapon Set 1-only allocations (same encoding), omitted when empty
 *   w2  Weapon Set 2-only allocations (same encoding), omitted when empty
 *   ws  active weapon set (1 or 2), omitted when 1
 *
 * Backward compatibility: pre-weapon-set links carry only `n=` (the full
 * allocation). Those decode as shared-only — `n` → shared, `w1`/`w2` empty,
 * Weapon Set 1 active.
 *
 * Names/ids instead of indices: class names + ascendancy ids are the app's own
 * stable identifiers (the store keys off them), so they don't shift when the
 * export reorders or renames display labels. Legacy `p=` / `ap=` cap params
 * from earlier builds are ignored — caps are fixed at game-rule values now (see
 * PASSIVE_CAP / ASCENDANCY_CAP). Masteries (`m`) are out of scope — PoE 2 has none.
 */

export interface ShareHashRaw {
  version: string;
  className: string;
  ascendancyId: string | null; // null = no ascendancy
  sharedKeys: string[];
  set1Keys: string[];
  set2Keys: string[];
}

export function encodeShareHash(s: Readonly<ShareHashRaw>): string {
  const parts = [
    `v=${encodeURIComponent(s.version)}`,
    `c=${encodeURIComponent(s.className)}`,
  ];
  if (s.ascendancyId) parts.push(`a=${encodeURIComponent(s.ascendancyId)}`);
  if (s.sharedKeys.length > 0) parts.push(`n=${encodeNodeKeys(s.sharedKeys)}`);
  if (s.set1Keys.length > 0) parts.push(`w1=${encodeNodeKeys(s.set1Keys)}`);
  if (s.set2Keys.length > 0) parts.push(`w2=${encodeNodeKeys(s.set2Keys)}`);
  return `#${parts.join('&')}`;
}

export function decodeShareHash(hash: string): ShareHashRaw | null {
  if (!hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.slice(1));

  const version = params.get('v');
  if (!version) return null;
  const className = params.get('c');
  if (!className) return null;

  const ascendancyId = params.get('a');
  return {
    version,
    className,
    ascendancyId: ascendancyId || null, // '' or absent → no ascendancy
    sharedKeys: decodeNodeKeys(params.get('n') ?? ''),
    set1Keys: decodeNodeKeys(params.get('w1') ?? ''),
    set2Keys: decodeNodeKeys(params.get('w2') ?? ''),
  };
}

/** Map a decoded share-hash into a snapshot the store can `loadSnapshot()`.
 *  Validates the class name + ascendancy id against the live data and drops
 *  allocated keys that no longer exist (version drift). Returns null if the
 *  class is unknown/unplayable. An ascendancy that doesn't belong to the class
 *  (or isn't playable) is dropped to "no ascendancy" rather than failing. */
export function reconcileShareHash(
  raw: ShareHashRaw,
  data: TreeData,
): Omit<BuildSnapshot, 'version'> | null {
  const cls = data.classes.find((c) => c.name === raw.className);
  if (!cls || cls.ascendancies.length === 0) return null;

  const ascValid =
    raw.ascendancyId !== null &&
    cls.ascendancies.some((a) => a.id === raw.ascendancyId) &&
    data.playableAscendancyIds.has(raw.ascendancyId);
  const ascendancyId = ascValid ? raw.ascendancyId : null;

  const exists = (k: string) => data.nodes[k] !== undefined;
  // Normalize the three buckets (a key lives in exactly one), then drop
  // constraint-locked nodes the imported `(ascendancyId, allocation)` pair
  // doesn't satisfy — a hash crafted with mismatched gates would otherwise leak
  // hidden nodes into the build.
  const alloc = pruneAllocation(
    buildAllocation(
      raw.sharedKeys.filter(exists),
      raw.set1Keys.filter(exists),
      raw.set2Keys.filter(exists),
    ),
    ascendancyId,
    data,
  );

  return {
    className: cls.name,
    ascendancyId,
    shared: [...alloc.shared],
    set1: [...alloc.set1],
    set2: [...alloc.set2],
  };
}

// ---------- varint / delta / base64url plumbing ----------

function encodeNodeKeys(keys: readonly string[]): string {
  const nums = keys
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
  const bytes: number[] = [];
  let prev = 0;
  for (const n of nums) {
    writeVarint(bytes, n - prev);
    prev = n;
  }
  return base64urlEncode(new Uint8Array(bytes));
}

function decodeNodeKeys(encoded: string): string[] {
  if (encoded.length === 0) return [];
  try {
    const bytes = base64urlDecode(encoded);
    const out: string[] = [];
    let i = 0;
    let acc = 0;
    while (i < bytes.length) {
      const r = readVarint(bytes, i);
      acc += r.value;
      i = r.next;
      out.push(String(acc));
    }
    return out;
  } catch {
    return [];
  }
}

/** LEB128 unsigned varint write — 7 data bits per byte, high bit = "more". */
function writeVarint(out: number[], n: number): void {
  let v = n >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v & 0x7f);
}

function readVarint(bytes: Uint8Array, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = start;
  while (i < bytes.length) {
    const b = bytes[i++] ?? 0;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: value >>> 0, next: i };
    shift += 7;
    if (shift > 35) throw new Error('Varint too long');
  }
  throw new Error('Truncated varint');
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return globalThis.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  // Restore base64 padding and reverse URL-safe substitutions.
  const padding = '==='.slice((s.length + 3) % 4);
  const padded = (s + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = globalThis.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
