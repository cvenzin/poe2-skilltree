import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawTreeData } from '../src/data/types';
import { normalizeTreeData } from '../src/data/normalize';
import { VERSIONS } from '../src/data/versions';
import type { BuildSnapshot } from '../src/state/store';
import { createGggBuild, gggBuildFilename } from '../src/state/gggBuild';
import { decodeShareHash } from '../src/state/shareHash';
import { makeTree } from './fixtures/tree';

const snapshot: BuildSnapshot = {
  version: '0.5.2', className: 'Witch', ascendancyId: 'Witch1',
  shared: ['2', '11'], set1: ['3'], set2: ['4'],
};
const url = 'https://cvenzin.github.io/poe2-skilltree/';
const data = makeTree({
  '2': { id: 'lightning14' }, '3': { id: 'strength89' },
  '4': { id: 'intelligence4' }, '11': { id: 'AscendancyWitch1Small1' },
});

describe('GGG build export', () => {
  it('uses stable PassiveSkills IDs and preserves both exclusive weapon sets', () => {
    expect(createGggBuild(snapshot, data, ' My Witch ', url)).toMatchObject({
      name: 'My Witch', ascendancy: 'Witch1',
      description: 'Witch passive tree planned for Path of Exile 2 0.5.2.',
      passives: ['lightning14', 'AscendancyWitch1Small1',
        { id: 'strength89', weapon_set: 1 }, { id: 'intelligence4', weapon_set: 2 }],
    });
    expect(snapshot.shared).toEqual(['2', '11']);
  });

  it('links back to this exact build and preserves the hosted base path', () => {
    const build = createGggBuild(snapshot, data, 'My Witch', url);
    const link = new URL(build.link);
    expect(link.origin + link.pathname).toBe(url);
    expect(decodeShareHash(link.hash)).toEqual({ version: snapshot.version,
      className: snapshot.className, ascendancyId: snapshot.ascendancyId,
      sharedKeys: snapshot.shared, set1Keys: snapshot.set1, set2Keys: snapshot.set2 });
  });

  it('deduplicates buckets, skips implicit roots and keeps ascendancy passives shared', () => {
    const build = createGggBuild({ ...snapshot, shared: ['root', '1', '2', '10'],
      set1: ['2', '3', '11'], set2: ['3', '4'] }, data, 'Witch', url);
    expect(build.passives).toEqual(['lightning14', 'AscendancyWitch1Small1',
      { id: 'strength89', weapon_set: 1 }, { id: 'intelligence4', weapon_set: 2 }]);
  });

  it('supports a tree without an ascendancy and omits optional ascendancy metadata', () => {
    const build = createGggBuild({ ...snapshot, ascendancyId: null, shared: ['2'] }, data, 'Witch', url);
    expect(build).not.toHaveProperty('ascendancy');
    expect(build.passives[0]).toBe('lightning14');
  });

  it.each([
    [{ shared: ['999'] }, 'unavailable'],
    [{ shared: ['5'] }, 'cannot be exported'],
    [{ ascendancyId: 'ForeignAscendancy' }, 'belongs to your class'],
    [{ className: 'Unknown' }, 'playable class'],
    [{ ascendancyId: null }, 'another ascendancy'],
    [{ shared: [], set1: [], set2: [] }, 'at least one passive'],
  ] satisfies Array<[Partial<BuildSnapshot>, string]>)('rejects incomplete or incompatible exports: %j', (change, message) => {
    expect(() => createGggBuild({ ...snapshot, ...change }, data, 'Build', url)).toThrow(message);
  });

  it('rejects locked nodes instead of silently losing planned allocations', () => {
    const gated = makeTree({ '20': { id: 'forbidden1', unlockConstraint: { nodes: [11], ascendancy: 'Witch1' } } });
    expect(() => createGggBuild({ ...snapshot, shared: ['20'], set1: [], set2: [] }, gated, 'Build', url))
      .toThrow('locked');
  });

  it('requires a nonblank name', () => {
    expect(() => createGggBuild(snapshot, data, '   ', url)).toThrow('Enter a build name');
  });

  it.each(['isKeystone', 'isJewelSocket'] as const)('rejects exclusive %s exports instead of emitting invalid weapon_set entries', (flag) => {
    const tree = makeTree({ '3': { id: 'special', [flag]: true }, '2': { id: 'normal' },
      '11': { id: 'asc' }, '4': { id: 'other' } });
    expect(() => createGggBuild(snapshot, tree, 'Build', url)).toThrow('must be allocated in Main');
  });

  it('creates a safe, bounded .build filename with tree version', () => {
    expect(gggBuildFilename(' My Witch / Lightning:*? ', '0.5.2')).toBe('my-witch-lightning-0.5.2.build');
    expect(gggBuildFilename('⚡', '0.5.2')).toBe('poe2-build-0.5.2.build');
    expect(gggBuildFilename('a'.repeat(200), '0.5.2')).toBe('a'.repeat(80) + '-0.5.2.build');
  });
});

describe.each(VERSIONS)('GGG export for bundled tree %s', (version) => {
  const raw = JSON.parse(readFileSync(resolve('public', 'trees', version, 'data.json'), 'utf8')) as RawTreeData;
  const tree = normalizeTreeData(raw);

  it('maps actual passives, weapon sets and ascendancy IDs into the documented format', () => {
    const main = Object.entries(tree.nodes).filter(([key, node]) =>
      /^\d+$/.test(key) && node.id && node.icon && !node.ascendancyId && !node.classStartIndex &&
      !node.isMastery && !node.isKeystone && !node.isJewelSocket && !node.unlockConstraint).slice(0, 3);
    const ascId = tree.classes.find((cls) => cls.name === 'Witch')!.ascendancies
      .find((asc) => tree.playableAscendancyIds.has(asc.id))!.id;
    const asc = Object.entries(tree.nodes).find(([, node]) =>
      node.ascendancyId === ascId && node.id && !node.isAscendancyStart)!;
    const descriptor = { version, className: 'Witch', ascendancyId: ascId,
      shared: [main[0]![0], asc[0]], set1: [main[1]![0]], set2: [main[2]![0]] };
    const build = createGggBuild(descriptor, tree, 'Witch', url);
    expect(build.ascendancy).toBe(ascId);
    expect(build.passives).toContain(main[0]![1].id);
    expect(build.passives).toContain(asc[1].id);
    expect(build.passives).toContainEqual({ id: main[1]![1].id, weapon_set: 1 });
    expect(build.passives).toContainEqual({ id: main[2]![1].id, weapon_set: 2 });
    expect(JSON.parse(JSON.stringify(build))).toEqual(build);
  });
});
