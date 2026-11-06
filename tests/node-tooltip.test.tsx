import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NodeTooltip from '../src/ui/NodeTooltip';
import AttributeDialog from '../src/ui/AttributeDialog';
import RemovalConfirmation from '../src/ui/RemovalConfirmation';

import { useStore, type AppState } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { makeTree } from './fixtures/tree';

vi.mock('../src/state/store', async (original) => {
  const actual = await original<typeof import('../src/state/store')>();
  return { ...actual, useStore: Object.assign((select: (s: AppState) => unknown = (s) => s) =>
    select(actual.useStore.getState()), actual.useStore) };
});
const data = makeTree({ '2': { name: 'Attribute', isGenericAttribute: true }, '3': { name: 'Target' } });
beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState({ className: 'Witch', status: { kind: 'ready', version: 'test', data, atlases: {} as never } });
});
afterEach(() => vi.unstubAllGlobals());

it.each([['touch', 100, 'bottom'], ['touch', 700, 'top'], ['mouse', 100, null]] as const)(
  'uses actual %s input at y=%s for placement and hints', (inputType, clientY, edge) => {
    useStore.setState({ hovered: { nodeKey: '3', clientX: 100, clientY, inputType }, previewPath: ['2', '3'] });
    const html = renderToStaticMarkup(<NodeTooltip />);
    if (edge) expect(html).toContain(`data-mobile-tooltip-edge="${edge}"`);
    else expect(html).not.toContain('data-mobile-tooltip-edge');
    if (inputType === 'touch') {
      expect(html).toContain('Tap again to allocate');
      expect(html).toContain('Dismiss node inspection');
    } else {
      expect(html).not.toContain('<button');
      expect(html).not.toContain('Click node');
      expect(html).toContain('pointer-events:none');
    }
    expect(html).toContain('2 passive points');
    expect(html).not.toContain('nodes added');
    expect(html).not.toContain('nodes removed');
    expect(html).toContain('overflow-y:auto');
  });

it('uses touch placement on a wide screen too', () => {
  vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900 });
  useStore.setState({ hovered: { nodeKey: '3', clientX: 700, clientY: 100, inputType: 'touch' } });
  expect(renderToStaticMarkup(<NodeTooltip />)).toContain('data-mobile-tooltip-edge="bottom"');
});

it('shows a concise refund for destructive mouse hover without action buttons', () => {
  useStore.setState({ allocation: buildAllocation(['2', '3', '4'], [], []) });
  useStore.setState({ hovered: { nodeKey: '3', clientX: 100, clientY: 100, inputType: 'mouse' } });
  const html = renderToStaticMarkup(<NodeTooltip />);
  expect(html).toContain('2 passive points refunded');
  expect(html).not.toContain('<button');
  expect(html).not.toContain('nodes removed');
});

it('shows full path cost separately from the attribute count', () => {
  const html = renderToStaticMarkup(<AttributeDialog data={data} editor={{ kind: 'default', pending: buildAllocation(['2', '3'], [], []) }} />);
  expect(html).toContain('1 new attribute node');
  expect(html).toContain('New attribute nodes');
  expect(html).toContain('Path cost: 2 passive points');
  expect(html).not.toContain('points spent');
});

it('titles default settings contextually and preserves the future-only explanation', () => {
  const html = renderToStaticMarkup(<AttributeDialog data={data} editor={{ kind: 'default' }} />);
  expect(html).toContain('Default attribute');
  expect(html).not.toContain('New attribute nodes');
  expect(html).toContain('Your default applies to future allocations. Existing choices stay as they are.');
  expect(html).not.toContain('Path cost:');
});

it.each(['set1', 'set2'] as const)('shows prospective %s path cost using the existing budget counts', (mode) => {
  const pending = buildAllocation([], mode === 'set1' ? ['2', '3'] : [], mode === 'set2' ? ['2', '3'] : []);
  const html = renderToStaticMarkup(<AttributeDialog data={data} editor={{ kind: 'default', pending }} />);
  expect(html).toContain(`Path cost: 2 passive points (${mode === 'set1' ? 'Set 1' : 'Set 2'})`);
  expect(html).not.toContain('spent');
});

it('keeps prospective ascendancy cost separate and excludes free nodes', () => {
  const tree = makeTree({ '2': { isGenericAttribute: true, isFree: true } });
  useStore.setState({ ascendancyId: 'Witch1' });
  const html = renderToStaticMarkup(<AttributeDialog data={tree}
    editor={{ kind: 'default', pending: buildAllocation(['2', '11'], [], []) }} />);
  expect(html).toContain('Path cost: 1 ascendancy point');
  expect(html).not.toContain('passive point');
  expect(html).not.toContain('spent');
});

it('describes Main and both set cascades and offers explicit cancellation and confirmation', () => {
  useStore.setState({ allocation: buildAllocation(['2', '3'], ['4'], ['5']) });
  useStore.getState().requestRemoval('3', data);
  const html = renderToStaticMarkup(<RemovalConfirmation />);
  expect(html).toContain('Main: 1 · Set 1: 1 · Set 2: 1');
  expect(html).toContain('1 passive point refunded');
  expect(html).toContain('Cancel');
  expect(html).toContain('Remove</button>');
  expect(html).not.toContain('0 nodes');
  expect(html).not.toContain('<ul');
});

it('keeps keyboard details and actions separate from ordinary mouse inspection', () => {
  useStore.setState({ hovered: { nodeKey: '3', clientX: 0, clientY: 0, inputType: 'keyboard' } });
  const html = renderToStaticMarkup(<NodeTooltip />);
  expect(html).toContain('<dialog');
  expect(html).toContain('Allocate path');
  expect(html).toContain('Close');
});

it('shows the touch cue only for a valid pending preview', () => {
  useStore.setState({ hovered: { nodeKey: '3', clientX: 100, clientY: 100, inputType: 'touch' } });
  expect(renderToStaticMarkup(<NodeTooltip />)).not.toContain('Tap again');
});

it('omits zero-value and single-tree cascade breakdowns', () => {
  useStore.setState({ allocation: buildAllocation(['2', '3', '4'], [], []) });
  useStore.getState().requestRemoval('3', data);
  const html = renderToStaticMarkup(<RemovalConfirmation />);
  expect(html).toContain('Remove 2 nodes?');
  expect(html).not.toContain('Main:');
  expect(html).not.toContain('Set 1:');
  expect(html).not.toContain('nodes added');
});

it('renders attribute confirmation inside its editor without a floating confirmation', () => {
  useStore.setState({ allocation: buildAllocation(['2', '3', '4'], [], []) });
  const editor = { kind: 'node', nodeKey: '2' } as const;
  useStore.getState().openAttributeEditor(editor);
  useStore.getState().removeAttributeNode('2');
  expect(useStore.getState().attributeEditor).toBe(editor);
  const html = renderToStaticMarkup(<AttributeDialog data={data} editor={editor} />);
  expect(html).toContain('Choose this node');
  expect(html).toContain('Remove 3 nodes?');
  expect(html).toContain('3 passive points refunded');
  expect(html).toContain('Cancel</button>');
  expect(html).toContain('Remove</button>');
  expect(html).not.toContain('Remove node</button>');
  expect(renderToStaticMarkup(<RemovalConfirmation />)).toBe('');
});

it.each(['mouse', 'touch', 'keyboard'] as const)('shows anoint ingredients in order with no editing UI for %s', (inputType) => {
  const tree = makeTree({ '3': { name: 'Anoint', isBlighted: true,
    stats: ['+5% to Quality of all Skills'], recipe: ['PotentLiquidFerocity', 'LiquidDespair', 'LiquidDespair'] } });
  useStore.setState({ status: { kind: 'ready', version: 'test', data: tree, atlases: {} as never },
    weaponSetsEnabled: true });
  useStore.setState({ hovered: { nodeKey: '3', clientX: 100, clientY: 100, inputType }, previewPath: ['3'] });
  const html = renderToStaticMarkup(<NodeTooltip />);
  expect(html).toContain('Instilling only');
  expect(html).toContain('Cannot be allocated with passive points.');
  expect(html).toContain('+5% to Quality of all Skills');
  expect(html).toContain('aria-label="Instilling recipe"');
  expect(html.indexOf('Potent Liquid Ferocity')).toBeLessThan(html.indexOf('Liquid Despair'));
  expect(html.match(/<img /g)).toHaveLength(3);
  expect(html.match(/<span>Liquid Despair<\/span>/g)).toHaveLength(2);
  expect(html).toContain('/liquid-emotions/UniqueConstructsEmotion.webp');
  expect(html).not.toContain('Tap again');
  expect(html).not.toContain('Allocate path');
  expect(html).not.toContain('Editing:');
  expect(html).not.toContain('No reachable path');
  expect(html).not.toContain('Free');
  expect(html).not.toContain('1 passive point');
});

it('keeps recipes off ordinary notables and provides text for future unknown ingredients', () => {
  const tree = makeTree({ '3': { name: 'Normal notable', recipe: ['LiquidDespair'] },
    '5': { name: 'Future anoint', isBlighted: true, recipe: ['FutureLiquidEmotion'] } });
  useStore.setState({ status: { kind: 'ready', version: 'test', data: tree, atlases: {} as never } });
  useStore.setState({ hovered: { nodeKey: '3', clientX: 0, clientY: 0, inputType: 'keyboard' } });
  expect(renderToStaticMarkup(<NodeTooltip />)).not.toContain('Instilling recipe');
  useStore.setState({ hovered: { nodeKey: '5', clientX: 0, clientY: 0, inputType: 'keyboard' } });
  const html = renderToStaticMarkup(<NodeTooltip />);
  expect(html).toContain('Future Liquid Emotion');
  expect(html).not.toContain('<img');
});
