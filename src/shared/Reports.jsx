import { useState } from 'react';
import { Download, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import { useLive, useRepo, Card, Skeleton, Empty, Modal, Toast, DatePicker, ClassSwitch, loadMyClasses, useClassParam } from '../ui';
import { addDays } from '../logic';
import { exportAttendanceXlsx } from '../files';

// =====================================================================
// REPORTS (/reports for teachers, /admin/reports for the admin): download a class's attendance as an
// Excel file (the file is made in files.js). A privacy warning appears first, and each download is
// written in the audit log. Teachers see their own classes; the admin sees every class.
// =====================================================================
export function Reports() {
  const repo = useRepo();
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [sheets, setSheets] = useState({ grid: true, summary: true, raw: true });
  const [warnOpen, setWarnOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [classId, setClass] = useClassParam();
  const { data } = useLive(
    async (r) => {
      const { session, today, classes, section } = await loadMyClasses(r, classId);
      // The adviser's name goes in the file's header (the admin downloads for any class).
      const teachers = session.role === 'admin' ? await r.listTeachers().catch(() => []) : [];
      const teacherName = session.role === 'admin' ? (teachers.find((t) => t.id === section?.teacherId)?.name ?? 'No adviser yet') : session.name;
      return { session, today, classes, section, teacherName, year: await r.getSchoolYear(), calendar: await r.getCalendar() };
    },
    [classId],
  );
  if (!data)
    return (
      <div className="page">
        <Skeleton h={300} />
      </div>
    );
  if (!data.section)
    return (
      <div className="page">
        <Empty title="No class to report on" hint="Classes you handle appear here." />
      </div>
    );
  const start = from ?? `${data.today.date.slice(0, 8)}01`;
  const end = to ?? data.today.date;
  // Builds and downloads the .xlsx file for the chosen class and dates.
  const run = async () => {
    setWarnOpen(false);
    setBusy(true);
    try {
      const [settings, calendar, roster, records] = await Promise.all([
        repo.getSettings(),
        repo.getCalendar(),
        repo.getRoster(data.section.id, end),
        repo.getAttendanceRange(data.section.id, start, end),
      ]);
      const filename = await exportAttendanceXlsx({
        settings,
        schoolYearName: data.year.name,
        section: data.section,
        teacherName: data.teacherName,
        students: roster.map((r) => r.student),
        records,
        calendar,
        from: start,
        to: end,
        sheets,
      });
      await repo.logAudit('export.excel', data.section.id, `${filename} (${start} to ${end})`);
      setToast(`Downloaded ${filename}`);
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  };
  const presets = [
    ['This month', `${data.today.date.slice(0, 8)}01`, data.today.date],
    ['Last 7 days', addDays(data.today.date, -6), data.today.date],
    ['School year to date', data.year.start, data.today.date],
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="page-sub">{data.section.name}</p>
        </div>
      </div>
      <ClassSwitch classes={data.classes} value={data.section.id} onChange={setClass} />
      <div className="grid-2">
        <Card title="Export to Excel">
          <div className="chips">
            {presets.map(([label, a, b]) => (
              <button
                key={label}
                className={`fchip ${start === a && end === b ? 'fchip-on' : ''}`}
                onClick={() => {
                  setFrom(a);
                  setTo(b);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="form-row">
            <div className="field">
              <span>From</span>
              <DatePicker
                value={start}
                min={data.year.start}
                max={end}
                calendar={data.calendar}
                onChange={setFrom}
                ariaLabel="From"
                quick={[
                  ['First day of classes', data.year.start],
                  ['Start of month', `${data.today.date.slice(0, 8)}01`],
                ]}
              />
            </div>
            <div className="field">
              <span>To</span>
              <DatePicker
                value={end}
                min={start}
                max={data.today.date}
                calendar={data.calendar}
                onChange={setTo}
                ariaLabel="To"
                quick={[['Today', data.today.date]]}
              />
            </div>
          </div>
          <fieldset className="checks">
            <legend>Sheets</legend>
            <label>
              <input type="checkbox" checked={sheets.grid} onChange={(e) => setSheets({ ...sheets, grid: e.target.checked })} /> Daily grid (P / L / A
              / E per day)
            </label>
            <label>
              <input type="checkbox" checked={sheets.summary} onChange={(e) => setSheets({ ...sheets, summary: e.target.checked })} /> Summary with
              attendance rate
            </label>
            <label>
              <input type="checkbox" checked={sheets.raw} onChange={(e) => setSheets({ ...sheets, raw: e.target.checked })} /> Raw log with scan times
              and edits
            </label>
          </fieldset>
          <button className="btn btn-ink wide" disabled={busy || !(sheets.grid || sheets.summary || sheets.raw)} onClick={() => setWarnOpen(true)}>
            <Download size={18} /> {busy ? 'Preparing…' : 'Download .xlsx'}
          </button>
        </Card>
        <Card title="What you get">
          <div className="xl-preview" aria-hidden="true">
            <div className="xl-tabs">
              <span className="on">Daily Grid</span>
              <span>Summary</span>
              <span>Raw Log</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>10-26</th>
                  <th>10-27</th>
                  <th>10-28</th>
                  <th>P</th>
                  <th>A</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Dela Cruz, Juan</td>
                  <td className="p">P</td>
                  <td className="l">L</td>
                  <td className="p">P</td>
                  <td>2</td>
                  <td>0</td>
                </tr>
                <tr>
                  <td>Reyes, Bea</td>
                  <td className="a">A</td>
                  <td className="p">P</td>
                  <td className="e">E</td>
                  <td>1</td>
                  <td>1</td>
                </tr>
                <tr>
                  <td>Santos, Miguel</td>
                  <td className="p">P</td>
                  <td className="p">P</td>
                  <td className="p">P</td>
                  <td>3</td>
                  <td>0</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">
            <FileSpreadsheet size={14} /> Opens in Excel, Google Sheets or WPS. Header rows show the school, school year, section and teacher.
          </p>
        </Card>
      </div>
      {warnOpen && (
        <Modal
          title="This file contains learners' personal data"
          onClose={() => setWarnOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setWarnOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={run}>
                <Download size={16} /> I understand, download
              </button>
            </>
          }
        >
          <p className="warn-row">
            <ShieldAlert size={20} /> Keep it on a school device, do not post it in group chats, and delete copies you no longer need. This download
            is recorded in the audit log (Data Privacy Act of 2012).
          </p>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}
