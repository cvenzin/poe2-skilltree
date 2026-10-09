import { describe, expect, it } from 'vitest';
import { decodeShareHash, encodeShareHash, reconcileShareHash } from '../src/state/shareHash';
import { makeTree } from './fixtures/tree';

describe('share links', () => {
  const raw = { version: '0.5.2', className: 'Witch', ascendancyId: 'Witch1',
    sharedKeys: ['65535', '128', '2'], set1Keys: ['255', '3'], set2Keys: ['4'] };

  it('round-trips all buckets with canonical sorted encoding', () => {
    const hash = encodeShareHash(raw);
    expect(decodeShareHash(hash)).toEqual({ ...raw, sharedKeys: ['2', '128', '65535'], set1Keys: ['3', '255'] });
    expect(encodeShareHash({ ...raw, sharedKeys: [...raw.sharedKeys].reverse() })).toBe(hash);
  });

  it('loads legacy n-only links as shared-only', () => {
    const decoded = decodeShareHash('#v=0.5.0&c=Witch&n=AgE&p=123&ap=8');
    expect(decoded).toEqual({ version: '0.5.0', className: 'Witch', ascendancyId: null,
      sharedKeys: ['2', '3'], set1Keys: [], set2Keys: [] });
  });

  it.each(['', 'v=0.5.2&c=Witch', '#c=Witch', '#v=0.5.2'])('ignores incomplete hashes: %s', (hash) => {
    expect(decodeShareHash(hash)).toBeNull();
  });

  it('fails closed for malformed node encodings', () => {
    expect(decodeShareHash('#v=0.5.2&c=Witch&n=***&w1=gA')!.sharedKeys).toEqual([]);
    expect(decodeShareHash('#v=0.5.2&c=Witch&n=***&w1=gA')!.set1Keys).toEqual([]);
  });

  it('drops unknown, overlapping and locked nodes when importing', () => {
    const data = makeTree({ '20': { unlockConstraint: { nodes: [11], ascendancy: 'Witch1' } } });
    expect(reconcileShareHash({ ...raw, ascendancyId: 'ForeignAscendancy',
      sharedKeys: ['2', '9999'], set1Keys: ['2', '3', '20'], set2Keys: ['3', '4'] }, data))
      .toEqual({ className: 'Witch', ascendancyId: null, shared: ['2'], set1: ['3'], set2: ['4'] });
    expect(reconcileShareHash({ ...raw, className: 'Unknown' }, data)).toBeNull();
  });
});
