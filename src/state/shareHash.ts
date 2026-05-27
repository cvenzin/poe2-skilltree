import type { TreeData } from '../data/types';
import type { BuildSnapshot } from './store';
import { pruneConstraintLocked } from '../data/normalize';

/**
 * URL share-hash format (INSTRUCTIONS.md §10.4):
 *
 *   #v=<version>&c=<classIdx>&a=<ascIdx>&n=<base64url(varint deltas)>
 *
 *   v   version string (e.g. "0.5.0")
 *   c   integer index into data.classes[] — robust to renames
 *   a   integer index into the selected class's ascendancies[], or -1 for none
 *   n   sorted-ascending list of numeric allocated node keys, delta-encoded
 *       LEB128 varints, base64url
 *
 * Legacy `p=` / `ap=` cap params from earlier builds are silently ignored —
 * caps are fixed at game-rule values now (see PASSIVE_CAP / ASCENDANCY_CAP).
 * Masteries (`m`) are out of scope — PoE 2 doesn't have a mastery system.
 */

export interface ShareHashRaw {
  version: string;
  classIdx: number;
  ascendancyIdx: number; // -1 = no ascendancy
  allocatedKeys: string[];
}

export function encodeShareHash(s: Readonly<ShareHashRaw>): string {
  const parts: string[] = [];
  parts.push(`v=${encodeURIComponent(s.version)}`);
  parts.push(`c=${s.classIdx}`);
  parts.push(`a=${s.ascendancyIdx}`);
  if (s.allocatedKeys.length > 0) parts.push(`n=${encodeNodeKeys(s.allocatedKeys)}`);
  return `#${parts.join('&')}`;
}

export function decodeShareHash(hash: string): ShareHashRaw | null {
  if (hash.length === 0 || hash[0] !== '#') return null;
  const params = new URLSearchParams(hash.slice(1));

  const version = params.get('v');
  if (!version) return null;
  const classIdx = parseIntOr(params.get('c'), NaN);
  if (!Number.isFinite(classIdx)) return null;

  return {
    version,
    classIdx,
    ascendancyIdx: parseIntOr(params.get('a'), -1),
    allocatedKeys: decodeNodeKeys(params.get('n') ?? ''),
  };
}

/** Map a decoded share-hash into a snapshot the store can `loadSnapshot()`.
 *  Validates indices against the live data; drops allocated keys that no
 *  longer exist (version drift). Returns null if the class index is invalid. */
export function reconcileShareHash(
  raw: ShareHashRaw,
  data: TreeData,
): Omit<BuildSnapshot, 'version'> | null {
  const cls = data.classes[raw.classIdx];
  if (!cls || cls.ascendancies.length === 0) return null;

  const asc = raw.ascendancyIdx >= 0 ? cls.ascendancies[raw.ascendancyIdx] : undefined;
  const ascendancyId =
    asc && data.playableAscendancyIds.has(asc.id) ? asc.id : null;

  const allocatedKeys = raw.allocatedKeys.filter((k) => data.nodes[k] !== undefined);
  // Drop constraint-locked nodes that the imported `(ascendancyId, allocated)`
  // pair doesn't satisfy — a hash crafted with mismatched gates would otherwise
  // leak hidden nodes into the build.
  const pruned = pruneConstraintLocked(new Set(allocatedKeys), ascendancyId, data);

  return {
    className: cls.name,
    ascendancyId,
    allocated: [...pruned],
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

function parseIntOr(s: string | null, fallback: number): number {
  if (s === null) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}
