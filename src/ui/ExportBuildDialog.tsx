import { useEffect, useId, useRef, useState } from 'react';
import type { TreeData } from '../data/types';
import { useStore } from '../state/store';
import { readSnapshot } from '../state/persistence';
import { createGggBuild, gggBuildFilename } from '../state/gggBuild';
import { allocationSize } from '../state/allocation';
import { downloadBuildFile } from './buildDownload';
import { fontBody, fontDisplay, palette, panelShadow } from './theme';
import './ExportBuildDialog.css';

const UPLOAD_URL = 'https://pathofexile2.com/my-account/builds/upload';

export default function ExportBuildDialog({ data, onClose }: Readonly<{ data: TreeData; onClose: () => void }>) {
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const version = useStore((s) => s.activeVersion);
  const allocation = useStore((s) => s.allocation);
  const ascendancy = data.classes.flatMap((cls) => cls.ascendancies).find((asc) => asc.id === ascendancyId);
  const [name, setName] = useState(() => `${ascendancy?.name ?? className ?? 'My'} passive tree`);
  const [downloadedFile, setDownloadedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const count = allocationSize(allocation);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    // Focus the close action without opening the phone's keyboard on entry.
    return () => dialog?.close();
  }, []);

  const dismiss = () => {
    // Close before unmounting so the toolbar is no longer inert when focus returns.
    dialogRef.current?.close();
    onClose();
  };

  const onDownload = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setDownloadedFile(null);
    try {
      const snapshot = version ? readSnapshot(version) : null;
      if (!snapshot) throw new Error('Your tree is still loading. Try again in a moment.');
      const build = createGggBuild(snapshot, data, name, new URL(import.meta.env.BASE_URL, location.origin).href);
      const filename = gggBuildFilename(build.name, snapshot.version);
      downloadBuildFile(build, filename);
      setDownloadedFile(filename);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The download could not start. Please try again.');
    }
  };

  return (
    <dialog ref={dialogRef} className="build-export" style={themeVars} aria-labelledby={titleId}
      aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onKeyDown={(event) => event.stopPropagation()}>
      <header className="build-export__header">
        <h2 id={titleId}>Export to PoE 2</h2>
        <button type="button" className="build-export__close" aria-label="Close export" onClick={dismiss}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <p id={descriptionId}>Take your passive tree into the in-game Build Planner.</p>
      <p className="build-export__summary">{className}{ascendancy?.name ? ` · ${ascendancy.name}` : ''} · Tree {version}</p>
      <form onSubmit={onDownload}>
        <label className="build-export__label">Build name
          <input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} />
        </label>
        <section aria-label="Download your build">
          <h3>1. Save your build</h3>
          <p>Download the file to Files or Downloads on your device. Shared passives and both weapon sets are included.</p>
          <p>Chosen attribute bonuses appear as recommendations on nodes in-game. Unspecified nodes have no recommendation.</p>
          {count === 0 && <p>Allocate at least one passive to download a build.</p>}
          <button className="build-export__action build-export__primary" type="submit" disabled={!name.trim() || count === 0}>
            Download build
          </button>
        </section>
        {error && <p role="alert" className="build-export__error">{error}</p>}
        <div role="status" className="build-export__status">
          {downloadedFile && <>Download started: <strong>{downloadedFile}</strong></>}
        </div>
      </form>
      <section aria-label="Upload to your account">
        <h3>2. Upload to your account</h3>
        <p>Sign in on GGG’s website, select the file you just downloaded, and upload it.</p>
        <a className="build-export__action" href={UPLOAD_URL} target="_blank" rel="noopener noreferrer">
          Open GGG upload page ↗
        </a>
      </section>
      <p className="build-export__hint">Then select the guide in the game’s Build Planner. You still allocate your points in-game.</p>
    </dialog>
  );
}

const themeVars = {
  '--export-bg': palette.panelBgSolid, '--export-field': palette.fieldBg,
  '--export-border': palette.border, '--export-text': palette.textPrimary,
  '--export-title': palette.textTitle, '--export-accent': palette.rune,
  '--export-error': palette.dangerText, '--export-success': palette.successText,
  '--export-body-font': fontBody, '--export-title-font': fontDisplay, boxShadow: panelShadow,
} as React.CSSProperties;
