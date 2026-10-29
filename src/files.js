import { addDays, attendanceRate, emptyCounts, isSchoolDay, to12h, normalizePhMobile } from './logic';

// =====================================================================
// files.js — EXCEL FILES (download reports, import students)
// ---------------------------------------------------------------------
// Uses the 'exceljs' package. It is large, so it is loaded only when a file
// is actually made or read (the `await import('exceljs')` lines).
// =====================================================================

// ----- 1. ATTENDANCE REPORT (Teacher -> Reports) -----
// Letters used in the Excel grid, and their cell colors (ARGB hex: FF + the color). Change colors here.
const CODE = { present: 'P', late: 'L', absent: 'A', excused: 'E' };
const FILL = { P: 'FFE3F6EA', L: 'FFFFF1D6', A: 'FFFDECEA', E: 'FFECEEFD' };
// Makes and downloads the .xlsx. Up to three sheets (chosen on the Reports page):
//   Daily Grid - one row per child, one column per school day (P / L / A / E) and totals
//   Summary    - totals and attendance rate per child
//   Raw Log    - every record with scan time, source and edit reason
export async function exportAttendanceXlsx(input) {
  const mod = await import('exceljs');
  const WorkbookCtor = mod.Workbook ?? mod.default.Workbook;
  const wb = new WorkbookCtor();
  wb.creator = 'Doorbell';
  wb.created = new Date();
  const days = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    if (isSchoolDay(d, input.section.schedule, input.calendar)) days.push(d);
  }
  const byKey = new Map(input.records.map((r) => [`${r.studentId}|${r.date}`, r]));
  const name = (s) => `${s.lastName}, ${s.firstName}`;
  const header = (ws, title, cols) => {
    ws.addRow([input.settings.schoolName]).font = { bold: true, size: 14 };
    ws.addRow([`${title}  |  ${input.schoolYearName}  |  ${input.section.name}  |  Teacher: ${input.teacherName}`]);
    ws.addRow([`Period: ${input.from} to ${input.to}  |  Generated: ${new Date().toLocaleString('en-PH')}`]).font = {
      italic: true,
      color: { argb: 'FF6B7078' },
    };
    ws.addRow([]);
    ws.mergeCells(1, 1, 1, Math.max(cols, 4));
  };
  if (input.sheets.grid) {
    const ws = wb.addWorksheet('Daily Grid');
    const cols = 2 + days.length + 4;
    header(ws, 'Daily Attendance Grid', cols);
    const head = ws.addRow(['#', 'Student', ...days.map((d) => d.slice(5)), 'P', 'L', 'A', 'E']);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD8F5A2' } };
      c.alignment = { horizontal: 'center' };
    });
    input.students.forEach((s, i) => {
      const counts = emptyCounts();
      const codes = days.map((d) => {
        const r = byKey.get(`${s.id}|${d}`);
        if (!r) return '';
        counts[r.status]++;
        return CODE[r.status];
      });
      const row = ws.addRow([i + 1, name(s), ...codes, counts.present, counts.late, counts.absent, counts.excused]);
      codes.forEach((code, j) => {
        if (!code) return;
        const cell = row.getCell(3 + j);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[code] } };
        cell.alignment = { horizontal: 'center' };
      });
    });
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 28;
    for (let c = 3; c <= cols; c++) ws.getColumn(c).width = 6.5;
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 5 }];
    ws.addRow([]);
    ws.addRow(['', 'Legend: P = Present, L = Late, A = Absent, E = Excused']).font = { italic: true };
  }
  if (input.sheets.summary) {
    const ws = wb.addWorksheet('Summary');
    header(ws, 'Attendance Summary', 8);
    ws.addRow(['#', 'Student', 'Present', 'Late', 'Absent', 'Excused', 'School days', 'Attendance rate']).font = { bold: true };
    input.students.forEach((s, i) => {
      const counts = emptyCounts();
      days.forEach((d) => {
        const r = byKey.get(`${s.id}|${d}`);
        if (r) counts[r.status]++;
      });
      ws.addRow([i + 1, name(s), counts.present, counts.late, counts.absent, counts.excused, days.length, attendanceRate(counts) / 100]);
    });
    ws.getColumn(8).numFmt = '0%';
    [5, 28, 10, 8, 9, 9, 12, 16].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    ws.views = [{ state: 'frozen', ySplit: 5 }];
  }
  if (input.sheets.raw) {
    const ws = wb.addWorksheet('Raw Log');
    header(ws, 'Raw Attendance Log', 7);
    ws.addRow(['Date', 'Student', 'Status', 'Time scanned', 'Source', 'Note', 'Edit reason']).font = { bold: true };
    const studentById = new Map(input.students.map((s) => [s.id, s]));
    [...input.records]
      .filter((r) => r.date >= input.from && r.date <= input.to && studentById.has(r.studentId))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.scannedAt ?? '99').localeCompare(b.scannedAt ?? '99'))
      .forEach((r) => {
        ws.addRow([
          r.date,
          name(studentById.get(r.studentId)),
          r.status,
          r.scannedAt ? to12h(r.scannedAt) : '',
          r.source,
          r.excusedNote ?? '',
          r.editedReason ?? '',
        ]);
      });
    [12, 28, 10, 13, 10, 32, 32].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    ws.views = [{ state: 'frozen', ySplit: 5 }];
  }
  const compact = input.section.name.replace(/Kindergarten/i, 'Kinder').replace(/[^A-Za-z0-9-]/g, '');
  const filename = `Attendance_${compact}_${input.from.slice(0, 7)}${input.from.slice(0, 7) !== input.to.slice(0, 7) ? `_to_${input.to.slice(0, 7)}` : ''}.xlsx`;
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}

// ----- 2. STUDENT IMPORT (Admin -> Students -> Import Excel) -----
// The columns of the import template. `required` columns must be filled for a row to be accepted.
const COLUMNS = [
  'LRN',
  'Last Name',
  'First Name',
  'Middle Name',
  'Birthdate',
  'Sex',
  'Guardian Name',
  'Guardian Mobile',
  'Relationship',
  'SMS Consent',
  'Language',
  'Section',
];
// Loads exceljs and makes an empty workbook.
async function newWorkbook() {
  const mod = await import('exceljs');
  const Ctor = mod.Workbook ?? mod.default.Workbook;
  return new Ctor();
}
// Gives a file to the browser to download.
function download(buf, filename) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// Downloads the empty template (with an instructions sheet and the section names).
export async function downloadTemplate(sections) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Students');
  ws.addRow(COLUMNS).font = { bold: true };
  ws.getRow(1).eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD8F5A2' } };
  });
  ws.addRow([
    '',
    'Dela Cruz',
    'Juan',
    'Lopez',
    '2021-03-14',
    'M',
    'Ana Dela Cruz',
    '09171234567',
    'Mother',
    'Yes',
    'English',
    sections[0]?.name ?? '',
  ]);
  ws.addRow(['', 'Dela Cruz', 'Maria', 'Lopez', '2021-03-14', 'F', 'Ana Dela Cruz', '09171234567', 'Mother', 'Yes', 'English', '']);
  [14, 16, 16, 14, 13, 6, 22, 16, 13, 12, 10, 26].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.getColumn(8).numFmt = '@'; // keep the leading 0 in mobile numbers
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const help = wb.addWorksheet('How to fill');
  [
    ['Column', 'What to type'],
    ['LRN', 'Optional. Learner Reference Number.'],
    ['Birthdate', 'YYYY-MM-DD, e.g. 2021-03-14'],
    ['Sex', 'M or F'],
    ['Guardian Mobile', '09XXXXXXXXX. Siblings can share the same number; they will be linked to one guardian.'],
    ['SMS Consent', 'Yes only if the guardian signed the consent form. No = no texts.'],
    ['Language', 'English or Filipino (for SMS). Blank = English.'],
    ['Section', `Optional. Leave blank to auto-assign later. Must match exactly: ${sections.map((s) => s.name).join(', ')}`],
  ].forEach((r, i) => {
    const row = help.addRow(r);
    if (i === 0) row.font = { bold: true };
  });
  help.getColumn(1).width = 18;
  help.getColumn(2).width = 90;
  download(await wb.xlsx.writeBuffer(), 'Doorbell_Student_Import_Template.xlsx');
}
// Header matching ignores case, spaces and symbols: 'First Name' = 'firstname'.
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v && 'text' in v) return String(v.text);
  if (typeof v === 'object' && v && 'result' in v) return String(v.result);
  return String(v).trim();
}
// Reads a .csv file (a simple alternative to .xlsx).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
// Reads the uploaded file into rows of { columnName: value }.
export async function readRows(file) {
  if (file.name.toLowerCase().endsWith('.csv')) return parseCsv(await file.text());
  const wb = await newWorkbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((r) => {
    const vals = r.values.slice(1).map(cellText);
    if (vals.some((v) => v)) rows.push(vals);
  });
  return rows;
}
// Checks each row: required names, birthdate, sex, a valid PH mobile number, a known section,
// and duplicates (same name and birthdate already in the school). Returns rows with either
// `input` (ready to save) or `problems` (shown to the admin, row skipped).
export function validateRows(rows, sections, existing) {
  const [header, ...body] = rows;
  if (!header) return [];
  const idx = (name) => header.findIndex((h) => norm(h) === norm(name));
  const col = Object.fromEntries(COLUMNS.map((c) => [c, idx(c)]));
  const seen = new Set();
  return body.map((r, i) => {
    const get = (c) => (col[c] >= 0 ? (r[col[c]] ?? '').trim() : '');
    const errors = [];
    const warnings = [];
    const last = get('Last Name');
    const first = get('First Name');
    if (!last || !first) errors.push('First and last name are required');
    let birth = get('Birthdate');
    const m = birth.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // MM/DD/YYYY from Excel
    if (m) birth = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) errors.push('Birthdate must be YYYY-MM-DD');
    const sexRaw = get('Sex').toUpperCase();
    const sex = sexRaw.startsWith('M') ? 'M' : sexRaw.startsWith('F') ? 'F' : null;
    if (!sex) errors.push('Sex must be M or F');
    const mobile = normalizePhMobile(get('Guardian Mobile'));
    if (!mobile) errors.push('Guardian mobile must look like 09171234567');
    if (!get('Guardian Name')) errors.push('Guardian name is required');
    const consent = /^y/i.test(get('SMS Consent'));
    if (!consent) warnings.push('No SMS consent: parent will not get texts');
    const secName = get('Section');
    const section = secName ? sections.find((s) => norm(s.name) === norm(secName) && !s.archived) : undefined;
    if (secName && !section) errors.push(`Unknown section "${secName}"`);
    const lrn = get('LRN') || undefined;
    const dupKey = lrn ?? `${norm(last)}|${norm(first)}|${birth}`;
    if (seen.has(dupKey)) errors.push('Duplicate row in this file');
    seen.add(dupKey);
    const dup = existing.find(
      (x) =>
        (lrn && x.student.lrn === lrn) ||
        (norm(x.student.lastName) === norm(last) && norm(x.student.firstName) === norm(first) && x.student.birthdate === birth),
    );
    if (dup) errors.push('Already registered');
    if (mobile && existing.some((x) => x.guardian?.mobile === mobile)) warnings.push('Shares a guardian number: will be linked as a sibling');
    return {
      line: i + 2,
      name: `${last}, ${first}`,
      errors,
      warnings,
      input: errors.length
        ? undefined
        : {
            lrn,
            lastName: last,
            firstName: first,
            middleName: get('Middle Name') || undefined,
            birthdate: birth,
            sex: sex,
            guardianName: get('Guardian Name'),
            guardianMobile: mobile,
            relationship: get('Relationship') || 'Guardian',
            smsConsent: consent,
            preferredLanguage: /^fil/i.test(get('Language')) ? 'fil' : 'en',
            sectionId: section?.id ?? null,
          },
    };
  });
}
