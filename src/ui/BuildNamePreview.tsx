import { useState } from 'react';
import { autoUpdate, flip, FloatingPortal, offset, safePolygon, shift, useClick, useDismiss,
  useFloating, useFocus, useHover, useInteractions, useRole } from '@floating-ui/react';
import { fontBody, palette, panelShadow } from './theme';

/** Full build details without expanding the closed native selector. */
export default function BuildNamePreview({ name, details }: Readonly<{ name: string; details: string }>) {
  const [open, setOpen] = useState(false);
  const { refs: { setReference, setFloating }, floatingStyles, context } = useFloating({
    open, onOpenChange: setOpen, placement: 'bottom-end', whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 16 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { mouseOnly: true, handleClose: safePolygon() }), useFocus(context), useClick(context),
    useDismiss(context), useRole(context, { role: 'tooltip' }),
  ]);
  return <>
    <button ref={setReference} type="button" className="build-name-preview__trigger"
      aria-label="Show full build name" aria-expanded={open} {...getReferenceProps()}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 9v5M10 6v.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </button>
    {open && <FloatingPortal>
      <div ref={setFloating} className="build-name-preview" {...getFloatingProps()}
        style={{ ...floatingStyles, background: palette.panelBgSolid, color: palette.textPrimary,
          border: `1px solid ${palette.border}`, boxShadow: panelShadow, fontFamily: fontBody }}>
        <strong>{name}</strong><span>{details}</span>
      </div>
    </FloatingPortal>}
  </>;
}
