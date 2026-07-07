import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../api.js';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/Icon.jsx';
import { bandColor, RATER_TYPES, RATER_LABELS, taskScore } from '../../scoring.js';
import { pickPeriod, setSavedPeriod } from '../../period.js';
import { SkeletonTable } from '../../components/Skeleton.jsx';
import { REPORT_TITLE } from './PrintReport.jsx';

const SHORT = { supervisor: 'Supervisor', hr: 'HR', audit: 'Int. Audit' };
const SECTIONS = {
  A: 'A. Personal Attributes',
  B: 'B. Observance of Work Station Conduct',
  C: 'C. Service Excellence Condition',
  D: 'D. Judgment and Decision Making'
};

export default function Submissions() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    api('/periods')
      .then(({ periods }) => {
        setPeriods(periods);
        const pid = pickPeriod(periods);
        if (pid) setPeriodId(pid);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Remember the chosen coverage so it stays selected across pages
  const changePeriod = (id) => {
    setSavedPeriod(id);
    setPeriodId(id);
  };

  const load = () => {
    if (!periodId) return;
    setRows(null);
    api(`/reports/summary?periodId=${periodId}`)
      .then(({ rows }) => setRows(rows))
      .catch((e) => setError(e.message));
  };
  useEffect(load, [periodId]);

  const reopen = async (row, appraisal) => {
    if (!window.confirm(`Reopen the ${RATER_LABELS[appraisal.rater_type]} of ${row.user.full_name} for editing?`)) return;
    try {
      await api(`/appraisals/${appraisal.id}/reopen`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  // Admin encodes a Page 3 score (self/hr/peer/audit) e.g. from a paper form
  const encodeScore = async (row, type) => {
    const value = window.prompt(`${RATER_LABELS[type]} for ${row.user.full_name} — overall score (0-10):`);
    if (value === null || value === '') return;
    try {
      await api('/appraisals/submit', { method: 'POST', body: { periodId, raterType: type, userId: row.user.id, score: value } });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  // Export/print target: the ticked employees, or everyone when none ticked
  const exportRows = () => (selected.size ? rows.filter((r) => selected.has(r.user.id)) : rows);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.user.id))));

  const summaryData = () => {
    const head = ['Employee', 'Position', 'Department', ...RATER_TYPES.map((t) => RATER_LABELS[t]), 'Final Rating', 'Adjectival'];
    const body = exportRows().map((r) => [
      r.user.full_name,
      r.user.position,
      r.user.department,
      ...r.final.rows.map((row) => (row.score ? row.score.overall : '')),
      r.final.final,
      r.final.band.label
    ]);
    return { head, body };
  };

  const exportCsv = () => {
    const period = periods.find((p) => p.id === periodId);
    const { head, body } = summaryData();
    const lines = [head, ...body].map((cells) => cells.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `RPAS ${period?.name || 'summary'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const fmtDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  // One worksheet per employee with the same detail as the printed PDF.
  const detailSheet = (r, data) => {
    const pct1 = Math.round((data.settings.part1_weight ?? 0.7) * 100);
    const pct2 = Math.round((data.settings.part2_weight ?? 0.3) * 100);
    const aoa = [
      [REPORT_TITLE],
      [`Performance Evaluation for the period: ${data.period.name}`],
      [],
      ['Employee:', r.user.full_name, '', 'Position:', r.user.position || '', '', 'Department:', r.user.department || ''],
      [],
      [`PART I — PERFORMANCE (${pct1}%)`],
      ['Weight', 'Work / Activity', 'Unit of Measure', 'Qty Target', 'Qty Accomp', 'QN', 'QL', 'T', 'APS', 'EPS']
    ];
    for (const t of r.tasks) {
      const s = taskScore(t);
      aoa.push([
        Number(t.weight),
        `${t.code ? `${t.code} ` : ''}${t.name}`,
        t.unit || '',
        t.qty_target || '',
        t.qty_accomp || '',
        s.qn ?? '',
        s.ql ?? '',
        s.t ?? '',
        s.complete ? Number(s.aps.toFixed(2)) : '',
        s.complete ? Number(s.eps.toFixed(3)) : ''
      ]);
    }
    aoa.push([
      Number(r.score.totalWeight.toFixed(2)),
      `TEPS × ${pct1}% = Weighted Average Score`,
      '', '', '', '', '', '',
      Number(r.score.teps.toFixed(2)),
      Number(r.score.was1.toFixed(2))
    ]);

    const ratingByFactor = new Map(r.factorRatings.map((x) => [x.factor_id, x.rating]));
    const myFactors = data.factors.filter((f) => f.active !== false && (r.user.is_supervisor || !f.supervisor_only));
    aoa.push([], [`PART II — CRITICAL FACTORS (${pct2}%)`], ['Critical Factor', 'Rating']);
    let lastSection = null;
    for (const f of myFactors) {
      if (f.section !== lastSection) {
        aoa.push([SECTIONS[f.section] || f.section]);
        lastSection = f.section;
      }
      aoa.push([f.label, ratingByFactor.get(f.id) ?? '']);
    }
    aoa.push([`Average Point Score ÷ ${myFactors.length} × ${pct2}% = Weighted Average Score`, Number(r.score.was2.toFixed(2))]);

    aoa.push([], ['PAGE 3 — FINAL RATING'], ['Rater', 'Score', 'Weight', 'Weighted Score']);
    for (const row of r.final.rows) {
      aoa.push([
        RATER_LABELS[row.type] || row.type,
        row.score ? Number(row.score.overall.toFixed(2)) : '',
        `${Math.round(row.weight * 100)}%`,
        Number(row.weighted.toFixed(2))
      ]);
    }
    aoa.push([`Final Numerical Performance Rating — ${r.final.band.label} (${r.final.band.code})`, '', '', Number(r.final.final.toFixed(2))]);
    aoa.push(
      [],
      ['Rater (Supervisor):', r.supervisor?.full_name || '', '', 'Ratee:', r.user.full_name],
      ['Date of Rating (Supervisor):', fmtDate(r.rated_at), '', 'Date of Printing:', fmtDate(new Date())]
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 40 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 8 }];
    return ws;
  };

  const sheetName = (name, used) => {
    let base = (name || 'Employee').replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Employee';
    let nm = base;
    let i = 2;
    while (used.has(nm.toLowerCase())) nm = `${base.slice(0, 26)} ${i++}`;
    used.add(nm.toLowerCase());
    return nm;
  };

  const exportExcel = async () => {
    try {
      const ids = selected.size ? `&userIds=${[...selected].join(',')}` : '';
      const data = await api(`/reports/detail?periodId=${periodId}${ids}`);
      const wb = XLSX.utils.book_new();

      const { head, body } = summaryData();
      const summary = XLSX.utils.aoa_to_sheet([[REPORT_TITLE], [`Period: ${data.period.name}`], [], head, ...body]);
      summary['!cols'] = head.map((h, i) => ({ wch: i === 0 ? 28 : Math.max(12, h.length + 2) }));
      XLSX.utils.book_append_sheet(wb, summary, 'Summary');

      const used = new Set(['summary']);
      for (const r of data.rows) {
        XLSX.utils.book_append_sheet(wb, detailSheet(r, data), sheetName(r.user.full_name, used));
      }
      XLSX.writeFile(wb, `RPAS ${data.period.name} detailed.xlsx`);
    } catch (e) {
      setError(e.message);
    }
  };

  const openPrint = () => {
    const ids = selected.size ? `&ids=${[...selected].join(',')}` : '';
    window.open(`/admin/print?periodId=${periodId}${ids}`, '_blank');
  };

  const openList = () => {
    const ids = selected.size ? `&ids=${[...selected].join(',')}` : '';
    window.open(`/admin/print?periodId=${periodId}${ids}&view=list`, '_blank');
  };

  return (
    <div>
      <div className="page-head">
        <h1>Submissions</h1>
        <div className="page-head-right">
          <select value={periodId} onChange={(e) => changePeriod(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={exportCsv} disabled={!rows?.length}>
            <Icon name="download" size={16} /> CSV
          </button>
          <button className="btn" onClick={exportExcel} disabled={!rows?.length}>
            <Icon name="download" size={16} /> Excel
          </button>
          <button className="btn" onClick={openList} disabled={!rows?.length}>
            Print List{selected.size ? ` (${selected.size})` : ''}
          </button>
          <button className="btn btn-primary" onClick={openPrint} disabled={!rows?.length}>
            Print / PDF{selected.size ? ` (${selected.size})` : ' (all)'}
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {!rows ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} title="Select all" />
                </th>
                <th>Employee</th>
                {RATER_TYPES.map((t) => (
                  <th key={t} title={RATER_LABELS[t]}>
                    {SHORT[t]}
                  </th>
                ))}
                <th>Final</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.user.id)} onChange={() => toggle(r.user.id)} />
                  </td>
                  <td>
                    <div className="cell-user">
                      <Avatar user={r.user} size={32} />
                      <div>
                        <div>{r.user.full_name}</div>
                        <div className="muted small">{r.user.department}</div>
                      </div>
                    </div>
                  </td>
                  {r.final.rows.map((cell) => {
                    const appraisal = r.appraisals.find((a) => a.rater_type === cell.type);
                    const label = cell.score ? cell.score.overall.toFixed(2) : cell.status === 'submitted' ? '✓' : '—';
                    const badgeClass = `badge ${cell.status === 'submitted' ? 'badge-green' : 'badge-slate'}`;
                    return (
                      <td key={cell.type}>
                        {cell.type === 'supervisor' ? (
                          <Link
                            to={`/rate/supervisor/${r.user.id}`}
                            state={{ ratee: r.user }}
                            className={badgeClass}
                            title={`${RATER_LABELS[cell.type]}: ${cell.status} — click to open the form`}
                          >
                            {label}
                          </Link>
                        ) : (
                          <button
                            className={badgeClass}
                            style={{ border: 'none', cursor: 'pointer' }}
                            title={`${RATER_LABELS[cell.type]}: ${cell.status} — click to enter/update the Page 3 score`}
                            onClick={() => encodeScore(r, cell.type)}
                          >
                            {label}
                          </button>
                        )}
                        {appraisal?.status === 'submitted' && (
                          <button className="btn btn-small" style={{ marginLeft: 4 }} title="Reopen for editing" onClick={() => reopen(r, appraisal)}>
                            ↺
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <strong>{r.final.final.toFixed(2)}</strong>
                  </td>
                  <td>
                    <span className="badge" style={{ background: `${bandColor(r.final.band.code)}22`, color: bandColor(r.final.band.code) }}>
                      {r.final.band.label}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    No employees yet. Add them in the Employees page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted small" style={{ padding: '0 12px 12px' }}>
            Each cell shows that rater's submitted score (— = not submitted; scores only count toward the final once submitted).
            Click a cell to open that rater's form; ↺ reopens a submitted rating. Tick employees to export or print only those —
            no ticks means everyone. Print List gives a one-page summary table of ratings; Print / PDF gives the detailed
            per-employee report with signature blocks. Use "Save as PDF" in the print dialog for a PDF file.
          </p>
        </div>
      )}
    </div>
  );
}
