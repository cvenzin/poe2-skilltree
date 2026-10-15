import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TreeData } from '../data/types';
import ExportBuildDialog from './ExportBuildDialog';
import { controlHeight, palette } from './theme';

export default function ExportBuildButton({ data }: Readonly<{ data: TreeData }>) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onClose = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  return (
    <>
      <button ref={buttonRef} className="build-export-button" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} style={buttonStyle}>
        Export to PoE 2
      </button>
      {open && createPortal(<ExportBuildDialog data={data} onClose={onClose} />, document.body)}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  background: palette.runeDark, color: palette.textTitle,
  border: `1px solid ${palette.rune}`, borderRadius: 5,
  height: controlHeight, padding: '0 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
