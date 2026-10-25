import { useEffect, useRef, useState } from 'react';
import { useBuildLibrary } from '../state/buildLibrary';
import { deleteSavedBuild, newBuild, saveBuildName, switchSavedBuild } from '../state/buildActions';
import BuildNameDialog from './BuildNameDialog';
import BuildActionsMenu from './BuildActionsMenu';
import BuildNamePreview from './BuildNamePreview';
import './BuildLibraryControls.css';
import type { TreeData } from '../data/types';

export default function BuildLibraryControls({ data }: Readonly<{ data: TreeData }>) {
  const library = useBuildLibrary((s) => s.library);
  const saveStatus = useBuildLibrary((s) => s.saveStatus);
  const error = useBuildLibrary((s) => s.error);
  const [dialog, setDialog] = useState<'name' | 'duplicate' | 'delete' | null>(null);
  const root = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!dialog && restoreFocus.current) {
      root.current?.querySelector<HTMLButtonElement>('[aria-label="Build actions"], .build-library__save')?.focus();
      restoreFocus.current = false;
    }
  }, [dialog]);
  const active = library.builds.find((b) => b.id === library.activeId);
  const builds = [...library.builds].sort((a, b) => b.updatedAt - a.updatedAt);
  const ascendancyNames = new Map(data.classes.flatMap((c) => c.ascendancies.map((a) => [a.id, a.name] as const)));

  return (
    <section ref={root} className="build-library" aria-label="My builds">
      <div className="toolbar-field">
        <span>My builds</span>
        <div className="build-library__selection">
        <select aria-label="Saved builds" value={library.activeId ?? ''}
          onChange={(e) => { if (e.target.value) switchSavedBuild(e.target.value); }}>
          {!active && <option value="">Unsaved draft</option>}
          {builds.map((b) => <option key={b.id} value={b.id}>
            {b.name} · {b.snapshot.className}{b.snapshot.ascendancyId ? ` / ${ascendancyNames.get(b.snapshot.ascendancyId) ?? b.snapshot.ascendancyId}` : ''} · {b.snapshot.version}
          </option>)}
        </select>
        {active && <BuildNamePreview key={active.id} name={active.name}
          details={`${active.snapshot.className}${active.snapshot.ascendancyId ? ` / ${ascendancyNames.get(active.snapshot.ascendancyId) ?? active.snapshot.ascendancyId}` : ''} · ${active.snapshot.version}`} />}
        </div>
      </div>
      <div className="build-library__actions">
        {!active && <button type="button" className="build-library__save" onClick={() => setDialog('name')}>Save to my builds</button>}
        <button type="button" onClick={() => newBuild()}>New Build</button>
        {active && <BuildActionsMenu onAction={setDialog} />}
      </div>
      <p className={`build-library__status${error ? ' build-library__status--error' : ''}`} role={error ? 'alert' : 'status'}>
        {error ?? (saveStatus === 'saving' ? 'Saving…' : active ? 'Saved in this browser' : 'Draft autosaved · Name it to keep it in My builds')}
      </p>
      {dialog && <BuildNameDialog key={`${dialog}-${active?.id ?? 'draft'}`}
        mode={dialog} name={active?.name ?? 'My build'} onClose={() => { restoreFocus.current = true; setDialog(null); }}
        onConfirm={(name) => dialog === 'delete' ? Boolean(active && deleteSavedBuild(active.id))
          : saveBuildName(name, dialog === 'duplicate')} />}
    </section>
  );
}
