import { useEffect, useId, useRef, useState } from 'react';

type Action = 'name' | 'duplicate' | 'delete';

/** Build actions stay local so menu keys never reach the tree shortcuts. */
export default function BuildActionsMenu({ onAction }: Readonly<{ onAction: (action: Action) => void }>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const startAtEnd = useRef(false);

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[startAtEnd.current ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        // Restore only when the click did not move focus to another control.
        if (menu.current?.contains(document.activeElement)) trigger.current?.focus();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const dismiss = () => { setOpen(false); trigger.current?.focus(); };
  return (
    <div className="build-menu" ref={root} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} type="button" className="build-menu__trigger" aria-label="Build actions"
        title="Build actions" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { startAtEnd.current = false; setOpen(!open); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); startAtEnd.current = event.key === 'ArrowUp'; setOpen(true);
          }
        }}><span aria-hidden="true">•••</span></button>
      {open && <div ref={menu} id={menuId} role="menu" aria-label="Build actions" className="build-menu__items"
        onKeyDown={(event) => {
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          let next: number | undefined;
          if (event.key === 'ArrowDown') next = (index + 1) % items.length;
          if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = items.length - 1;
          const letter = event.key.toLowerCase();
          if (!event.ctrlKey && !event.metaKey && !event.altKey && letter.length === 1 && /[a-z]/.test(letter)) {
            const match = items.findIndex((item) => item.textContent?.toLowerCase().startsWith(letter));
            if (match >= 0) next = match;
          }
          if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
        }}>
        {([['name', 'Rename'], ['duplicate', 'Duplicate'], ['delete', 'Delete']] as const).map(([action, label]) => (
          <button key={action} type="button" role="menuitem" tabIndex={-1}
            className={action === 'delete' ? 'build-library__delete' : undefined}
            onClick={() => { dismiss(); onAction(action); }}>{label}</button>
        ))}
      </div>}
    </div>
  );
}
