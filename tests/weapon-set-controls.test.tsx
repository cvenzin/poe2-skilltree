import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import WeaponSetControls from '../src/ui/WeaponSetControls';
import { useStore } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { makeTree } from './fixtures/tree';

vi.mock('../src/state/store', async (original) => {
  const actual = await original<typeof import('../src/state/store')>();
  return { ...actual, useStore: Object.assign((select: (state: ReturnType<typeof actual.useStore.getState>) => unknown) =>
    select(actual.useStore.getState()), actual.useStore) };
});
const data = makeTree();
const markup = () => renderToStaticMarkup(<WeaponSetControls data={data} />);
beforeEach(() => useStore.setState(useStore.getInitialState(), true));

it('keeps unequal active totals and retained allocations visible when editing controls are hidden', () => {
  const allocation = buildAllocation(['2', '3'], ['4', '5'], ['6']);
  useStore.setState({ allocation, weaponSetsEnabled: true, allocationMode: 'set1' });
  useStore.getState().setWeaponSetsEnabled(false);
  expect(useStore.getState().allocation).toBe(allocation);
  expect(useStore.getState().allocationMode).toBe('shared');
  const html = markup();
  expect(html).toContain('Set 1 passives');
  expect(html).toContain('119 remaining'); // shared 2 + set 1's 2
  expect(html).toContain('120 remaining'); // shared 2 + set 2's 1
  expect(html).toContain('Set allocations retained');
  expect(html).not.toContain('<fieldset');
  useStore.getState().setWeaponSetsEnabled(true);
  expect(markup()).toContain('<fieldset');
  expect(useStore.getState().allocation).toBe(allocation);
});

it('uses the single passive counter for shared-only builds', () => {
  useStore.setState({ allocation: buildAllocation(['2', '3'], [], []) });
  expect(markup()).toContain('Passives');
  expect(markup()).not.toContain('Set 1 passives');
});
