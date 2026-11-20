import { useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, X, Download, ImageOff } from 'lucide-react';
import { MAX_FILES } from '../messaging';

// =====================================================================
// ATTACHMENTS IN MESSAGES (staff Messages page and the parent portal)
// A photo (e.g. of a medical certificate or an excuse letter) or a PDF. Each file is saved as ONE Firestore
// document (attachments/{id}, see src/messaging.js), because Firebase Storage needs the paid Blaze plan.
// A Firestore document holds at most 1 MiB, so:
//   * photos are made smaller here before sending (longest side 1600 px, JPEG), which keeps them readable
//   * PDFs must already be small (up to 700 KB); otherwise take a photo of the paper instead
// A file is downloaded only when its message is shown (1 read each), not with the conversation list.
// =====================================================================
const MAX_BYTES = 700 * 1024; // raw size; as base64 it is about 933 KB, under the 1 MiB document limit
const MAX_SIDE = 1600;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPT = 'image/*,application/pdf';

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });

// A photo made smaller: longest side at most 1600 px, JPEG, lower quality until it fits.
async function shrinkImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: this picture type can't be opened here. Take a screenshot of it, or save it as JPG.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.82, 0.7, 0.58, 0.45]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error(`${file.name} is too large even after making it smaller.`);
}

/** A chosen file -> { name, type, size, data (base64) }, ready for sendMessage / startThread. Throws a plain message. */
export async function prepareFile(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is ${kb(file.size)}. PDFs can be up to 700 KB: take a photo of the page instead.`);
    return { name: file.name, type: file.type, size: file.size, data: await toBase64(file) };
  }
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: only photos and PDF files can be attached.`);
  const blob = await shrinkImage(file);
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { name, type: 'image/jpeg', size: blob.size, data: await toBase64(blob) };
}

/** The paperclip button and the chosen files (with remove). files: prepared files; onChange(newList). */
export function AttachButton({ files, onChange, onError, disabled, className = 'btn', label = false }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = ''; // choosing the same file again still works
    if (!chosen.length) return;
    if (files.length + chosen.length > MAX_FILES) return onError?.(`Up to ${MAX_FILES} files in one message.`);
    setBusy(true);
    try {
      const ready = [];
      for (const f of chosen) ready.push(await prepareFile(f));
      onChange([...files, ...ready]);
      onError?.(null);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={pick} />
      <button
        type="button"
        className={className}
        onClick={() => input.current?.click()}
        disabled={disabled || busy || files.length >= MAX_FILES}
        aria-label="Attach a photo or PDF"
        title="Attach a photo or PDF"
      >
        <Paperclip size={18} aria-hidden="true" />
        {label && <span>{busy ? 'Preparing…' : 'Attach photo or PDF'}</span>}
      </button>
    </>
  );
}

/** The files chosen for the message being written, each with a remove button. */
export function PendingFiles({ files, onChange }) {
  if (!files.length) return null;
  return (
    <ul className="att-pending">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`}>
          {IMAGE_TYPES.includes(f.type) ? <img src={`data:${f.type};base64,${f.data}`} alt="" /> : <FileText size={18} aria-hidden="true" />}
          <span>
            {f.name}
            <small>{kb(f.size)}</small>
          </span>
          <button type="button" className="att-remove" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
            <X size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// The files of a sent message. load(id) -> the attachment document (engine.fetchAttachment or fetchParentAttachment).
export function MessageFiles({ files, load }) {
  if (!files?.length) return null;
  return (
    <div className="att-list">
      {files.map((f) => (
        <OneFile key={f.id} file={f} load={load} />
      ))}
    </div>
  );
}

const urlOf = (a) => {
  const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: a.type }));
};

function OneFile({ file, load }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const isImage = IMAGE_TYPES.includes(file.type);
  // Photos are shown right away; a PDF is downloaded only when tapped.
  useEffect(() => {
    if (!isImage) return undefined;
    let made = null;
    let live = true;
    load(file.id)
      .then((a) => {
        if (!live) return;
        if (!a) return setFailed(true);
        made = urlOf(a);
        setUrl(made);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.id, isImage, load]);
  const openPdf = async () => {
    try {
      const a = await load(file.id);
      if (!a) return setFailed(true);
      const u = urlOf(a);
      const link = document.createElement('a');
      link.href = u;
      link.target = '_blank';
      link.rel = 'noopener';
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch {
      setFailed(true);
    }
  };
  if (failed)
    return (
      <span className="att-file att-failed">
        <ImageOff size={16} aria-hidden="true" /> {file.name} could not be opened
      </span>
    );
  if (isImage)
    return (
      <>
        <button type="button" className="att-photo" onClick={() => url && setZoom(true)} aria-label={`Open photo ${file.name}`}>
          {url ? <img src={url} alt={file.name} /> : <span className="att-loading">Loading photo…</span>}
        </button>
        {zoom && (
          <div className="att-zoom" role="dialog" aria-label={file.name} onClick={() => setZoom(false)}>
            <img src={url} alt={file.name} />
            <a href={url} download={file.name} className="btn btn-sm" onClick={(e) => e.stopPropagation()}>
              <Download size={15} /> Save
            </a>
          </div>
        )}
      </>
    );
  return (
    <button type="button" className="att-file" onClick={openPdf}>
      <FileText size={18} aria-hidden="true" />
      <span>
        {file.name}
        <small>PDF · {kb(file.size)}</small>
      </span>
      <Download size={15} aria-hidden="true" />
    </button>
  );
}
