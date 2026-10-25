import { useStore } from '../state/store';
import type { TreeData } from '../data/types';
import { allAllocated } from '../state/allocation';
import { attributeOptions } from '../state/attributes';
import AttributeDialog from './AttributeDialog';
import { controlHeight, fontBody, fontDisplay, palette, panelShadow } from './theme';
import './AttributeControls.css';

export default function AttributeControls({ data, showTrigger = true }: Readonly<{ data: TreeData; showTrigger?: boolean }>) {
  const allocation = useStore((s) => s.allocation);
  const choices = useStore((s) => s.attributeChoices);
  const defaultChoice = useStore((s) => s.defaultAttribute);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const editor = useStore((s) => s.attributeEditor);
  const openEditor = useStore((s) => s.openAttributeEditor);
  const selected = attributeOptions(data, allocation, ascendancyId).find((option) => option.choice === defaultChoice);
  const unspecified = [...allAllocated(allocation)].filter((key) => data.nodes[key]?.isGenericAttribute && !choices[key]).length;

  return (
    <div className="attribute-controls" style={themeVars}>
      {showTrigger && <div className="attribute-controls__area">
        <span className="attribute-controls__label">Default for new attribute nodes</span>
        <button type="button" className="attribute-controls__trigger" onClick={() => openEditor({ kind: 'default' })}
        aria-haspopup="dialog"
        aria-label={`Default for new attribute nodes: ${selected?.override.name ?? 'Choose'}`}>
        <strong>{selected?.override.name ?? 'Choose bonus'}</strong><span aria-hidden="true">▾</span>
        </button>
        {unspecified > 0 && <button type="button" className="attribute-controls__unspecified"
          aria-haspopup="dialog" onClick={() => openEditor({ kind: 'default' })}>
          <span>Unspecified allocated nodes</span><strong>{unspecified}</strong>
        </button>}
      </div>}
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
  '--attribute-control-height': controlHeight,
} as React.CSSProperties;
