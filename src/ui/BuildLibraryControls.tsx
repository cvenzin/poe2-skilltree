import { useState } from 'react';
import { useBuildLibrary } from '../state/buildLibrary';
import { deleteSavedBuild, newBuild, saveBuildName, switchSavedBuild } from '../state/buildActions';
import BuildNameDialog from './BuildNameDialog';
import './BuildLibraryControls.css';
import type { TreeData } from '../data/types';

export default function BuildLibraryControls({ data }: Readonly<{ data: TreeData }>) {
  const library = useBuildLibrary((s) => s.library);
  const saveStatus = useBuildLibrary((s) => s.saveStatus);
  const error = useBuildLibrary((s) => s.error);
  const [dialog, setDialog] = useState<'name' | 'duplicate' | 'delete' | null>(null);
  const active = library.builds.find((b) => b.id === library.activeId);
  const builds = [...library.builds].sort((a, b) => b.updatedAt - a.updatedAt);
  const ascendancyNames = new Map(data.classes.flatMap((c) => c.ascendancies.map((a) => [a.id, a.name] as const)));

  return (
    <section className="build-library" aria-label="My builds">
      <label className="toolbar-field">
        <span>My builds</span>
        <select aria-label="Saved builds" value={library.activeId ?? ''}
          onChange={(e) => { if (e.target.value) switchSavedBuild(e.target.value); }}>
          {!active && <option value="">Unsaved draft</option>}
          {builds.map((b) => <option key={b.id} value={b.id}>
            {b.name} · {b.snapshot.className}{b.snapshot.ascendancyId ? ` / ${ascendancyNames.get(b.snapshot.ascendancyId) ?? b.snapshot.ascendancyId}` : ''} · {b.snapshot.version}
          </option>)}
        </select>
      </label>
      <div className="build-library__actions">
        <button type="button" onClick={() => newBuild()}>New</button>
        <button type="button" onClick={() => setDialog('name')}>{active ? 'Rename' : 'Save to my builds'}</button>
        {active && <button type="button" onClick={() => setDialog('duplicate')}>Duplicate</button>}
        {active && <button type="button" className="build-library__delete" onClick={() => setDialog('delete')}>Delete</button>}
      </div>
      <p className="build-library__status" role="status">
        {error ?? (saveStatus === 'saving' ? 'Saving…' : active ? 'Saved in this browser' : 'Draft saved in this browser · Name it to keep it in My builds')}
      </p>
      {dialog && <BuildNameDialog key={`${dialog}-${active?.id ?? 'draft'}`}
        mode={dialog} name={active?.name ?? 'My build'} onClose={() => setDialog(null)}
        onConfirm={(name) => dialog === 'delete' ? Boolean(active && deleteSavedBuild(active.id))
          : saveBuildName(name, dialog === 'duplicate')} />}
    </section>
  );
}
