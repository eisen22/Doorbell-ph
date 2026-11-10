import { Info, Printer, Search } from 'lucide-react';
import {
  useLive,
  Card,
  Skeleton,
  Empty,
  useRepo,
  textOn,
  Logo,
} from '../ui';
import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

// =====================================================================
// ID CARDS (/admin/cards): printable QR and barcode cards for scanning at the gate.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// ID CARDS: printable cards or stickers with a QR code or barcode. The code holds only a
// random token (never the child's name). "Print this card" prints one card for a lost card.
// ---------------------------------------------------------------------
/** Printable ID cards / stickers. Codes hold only a random token, never personal data. */
export function QrCards() {
  const repo = useRepo();
  const [sectionId, setSectionId] = useState(null);
  const [layout, setLayout] = useState('card');
  const [format, setFormat] = useState('qr');
  const [printId, setPrintId] = useState(null);
  const [find, setFind] = useState('');
  const { data } = useLive(async (r) => ({
    rows: await r.listStudentRows(),
    sections: (await r.listSections()).filter((s) => !s.archived),
    settings: await r.getSettings(),
  }));
  // Print just one card: mark it, print, then go back to normal.
  useEffect(() => {
    if (!printId) return;
    const done = () => setPrintId(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 300); // let the code image render first
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printId]);
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const sec = data.sections.find((s) => s.id === (sectionId ?? data.sections[0]?.id));
  const enrolled = data.rows.filter((r) => r.enrollment?.status === 'active');
  const rows = enrolled.filter((r) => r.enrollment.sectionId === sec?.id);
  const matches =
    find.trim().length >= 2
      ? enrolled.filter((r) => `${r.student.firstName} ${r.student.lastName}`.toLowerCase().includes(find.toLowerCase())).slice(0, 6)
      : [];
  const printOne = async (r) => {
    if (r.enrollment && r.enrollment.sectionId !== sec?.id) setSectionId(r.enrollment.sectionId);
    await repo.logAudit('cards.print_one', `${r.student.firstName} ${r.student.lastName}`, layout);
    setFind('');
    setPrintId(r.student.id);
  };
  return (
    <div className="page">
      <div className="page-head no-print">
        <div>
          <h1>ID Cards</h1>
          <p className="page-sub">A code is created automatically for every student</p>
        </div>
        <button
          className="btn btn-ink"
          onClick={async () => {
            await repo.logAudit('cards.print', sec?.name ?? '', `${rows.length} ${layout}s`);
            window.print();
          }}
          disabled={!rows.length}
        >
          <Printer size={17} /> Print all {rows.length}
        </button>
      </div>
      <Card className="no-print">
        <div className="find-one">
          <label className="field">
            <span>Print one student's card (new student, lost or damaged card)</span>
            <div className="search-box">
              <Search size={16} />
              <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a name" />
            </div>
          </label>
          {matches.length > 0 && (
            <ul className="find-results">
              {matches.map((r) => (
                <li key={r.student.id}>
                  <button onClick={() => printOne(r)}>
                    <strong>
                      {r.student.lastName}, {r.student.firstName}
                    </strong>
                    <span className="muted small">{r.section?.name}</span>
                    <span className="link">
                      <Printer size={14} /> Print
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="chips">
          {data.sections.map((s) => (
            <button key={s.id} className={`fchip ${s.id === sec?.id ? 'fchip-on' : ''}`} onClick={() => setSectionId(s.id)}>
              <span className="sec-dot sm" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
        <div className="form-row">
          <div className="field">
            <span>Layout</span>
            <div className="chips">
              <button className={`fchip ${layout === 'card' ? 'fchip-on' : ''}`} onClick={() => setLayout('card')}>
                ID card (85.6 x 54 mm)
              </button>
              <button className={`fchip ${layout === 'sticker' ? 'fchip-on' : ''}`} onClick={() => setLayout('sticker')}>
                A4 stickers (3 x 8)
              </button>
            </div>
          </div>
          <div className="field">
            <span>Code type</span>
            <div className="chips">
              <button className={`fchip ${format === 'qr' ? 'fchip-on' : ''}`} onClick={() => setFormat('qr')}>
                QR code
              </button>
              <button className={`fchip ${format === 'code128' ? 'fchip-on' : ''}`} onClick={() => setFormat('code128')}>
                Barcode (Code 128)
              </button>
            </div>
          </div>
        </div>
        <p className="muted small note-row">
          <Info size={14} /> Print at 100% scale (not "fit to page"), black on white, matte lamination. A lost card: press "Reissue" on the Students
          page first, then print the new one here.
        </p>
      </Card>
      {rows.length === 0 ? (
        <Card>
          <Empty title="No students in this section" />
        </Card>
      ) : (
        <div className={`print-sheet sheet-${layout} ${printId ? 'print-single' : ''}`}>
          {rows.map((r) => (
            <div key={r.student.id} className={`card-slot ${printId === r.student.id ? 'print-target' : ''}`}>
              <IdCard row={r} layout={layout} format={format} color={sec.color} school={data.settings.schoolName} />
              <button className="btn btn-sm no-print slot-print" onClick={() => printOne(r)}>
                <Printer size={14} /> Print this card
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// One printable card. QR codes are drawn by the 'qrcode' package, barcodes (CODE128) by 'jsbarcode'.
function IdCard({ row, layout, format, color, school }) {
  const [qr, setQr] = useState('');
  const svg = useRef(null);
  const token = row.student.qrToken;
  useEffect(() => {
    if (format === 'qr') QRCode.toDataURL(token, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr);
    else if (svg.current) JsBarcode(svg.current, token, { format: 'CODE128', displayValue: false, margin: 4, height: 50, width: 1.6 });
  }, [token, format]);
  const code = format === 'qr' ? <img src={qr} alt="" className="code-qr" /> : <svg ref={svg} className="code-bar" />;
  if (layout === 'sticker') {
    return (
      <div className="sticker" style={{ borderColor: color }}>
        {code}
        <strong>
          {row.student.firstName} {row.student.lastName[0]}.
        </strong>
      </div>
    );
  }
  return (
    <div className="idcard">
      <div className="idcard-band" style={{ background: color, color: textOn(color) }}>
        <Logo size={18} /> {school}
      </div>
      <div className="idcard-body">
        <div className="idcard-text">
          <strong>{row.student.firstName}</strong>
          <span>{row.student.lastName}</span>
          <em style={{ background: color, color: textOn(color) }}>{row.section?.name.replace('Kindergarten', 'Kinder')}</em>
        </div>
        {code}
      </div>
    </div>
  );
}
