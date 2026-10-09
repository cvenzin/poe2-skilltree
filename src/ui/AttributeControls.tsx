import { useStore } from '../state/store';
import type { TreeData } from '../data/types';
import { allAllocated } from '../state/allocation';
import { attributeOptions } from '../state/attributes';
import AttributeDialog from './AttributeDialog';
import { controlHeight, fontBody, fontDisplay, palette, panelShadow } from './theme';
import './AttributeControls.css';

export default function AttributeControls({ data, inline = false }: Readonly<{ data: TreeData; inline?: boolean }>) {
  const allocation = useStore((s) => s.allocation);
  const choices = useStore((s) => s.attributeChoices);
  const defaultChoice = useStore((s) => s.defaultAttribute);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const editor = useStore((s) => s.attributeEditor);
  const openEditor = useStore((s) => s.openAttributeEditor);
  const selected = attributeOptions(data, allocation, ascendancyId).find((option) => option.choice === defaultChoice);
  const unspecified = [...allAllocated(allocation)].filter((key) => data.nodes[key]?.isGenericAttribute && !choices[key]).length;

  return (
    <div className={`attribute-controls${inline ? ' attribute-controls--inline' : ''}`} style={themeVars}>
      <button type="button" className="attribute-controls__trigger" onClick={() => openEditor({ kind: 'default' })}
        aria-label={`Default for new attribute nodes: ${selected?.override.name ?? 'Choose'}`}>
        <span>New attributes: <strong>{selected?.override.name ?? 'Choose'}</strong> ▾</span>
        {!inline && unspecified > 0 && <small>{unspecified} unspecified</small>}
      </button>
      {inline && unspecified > 0 && <small className="attribute-controls__unspecified">{unspecified} unspecified</small>}
      {editor && <AttributeDialog key={editor.kind === 'node' ? editor.nodeKey : 'default'} data={data} editor={editor} />}
    </div>
  );
}

const themeVars = {
  '--attribute-bg': palette.panelBgSolid, '--attribute-field': palette.fieldBg,
  '--attribute-border': palette.border, '--attribute-text': palette.textPrimary,
  '--attribute-muted': palette.textMuted, '--attribute-title': palette.textTitle,
  '--attribute-accent': palette.rune, '--attribute-danger': palette.dangerText,
  '--attribute-body-font': fontBody, '--attribute-title-font': fontDisplay,
  '--attribute-shadow': panelShadow,
  '--attribute-control-height': `${controlHeight}px`,
} as React.CSSProperties;
