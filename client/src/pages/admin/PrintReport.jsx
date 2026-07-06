import { Fragment, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { taskScore, RATER_LABELS } from '../../scoring.js';
import Logo from '../../components/Logo.jsx';
import { Skeleton, SkeletonTable } from '../../components/Skeleton.jsx';

export const COMPANY_NAME = 'Rural Bank of Liloy (ZN), Inc.';
export const REPORT_TITLE = `${COMPANY_NAME} - Performance Appraisal System`;

const SECTIONS = {
  A: 'A. Personal Attributes',
  B: 'B. Observance of Work Station Conduct',
  C: 'C. Service Excellence Condition',
  D: 'D. Judgment and Decision Making'
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '____________________';

// Standalone printable report (opened from Submissions). One page-broken
// section per employee with full Part I / II detail, Page 3 summary and
// signature blocks. Use the browser's Print > Save as PDF for a PDF copy.
export default function PrintReport() {
  const [params] = useSearchParams();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const periodId = params.get('periodId');
  const ids = params.get('ids');
  // Employees open /my-report and get only their own report
  const self = location.pathname === '/my-report';
  // Admin can request a single-page summary list instead of per-employee detail
  const isList = params.get('view') === 'list';

  useEffect(() => {
    const url = self
      ? `/reports/my-detail?periodId=${periodId}`
      : `/reports/detail?periodId=${periodId}${ids ? `&userIds=${ids}` : ''}`;
    api(url)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [periodId, ids, self]);

  if (error) return <div className="alert alert-error" style={{ margin: 30 }}>{error}</div>;
  if (!data)
    return (
      <div className="print-page">
        <Skeleton w={280} h={30} style={{ marginBottom: 20 }} />
        <SkeletonTable rows={6} cols={4} />
      </div>
    );

  const printedOn = fmtDate(new Date());

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <strong>
          {self ? 'My RPAS Report' : isList ? `Ratings List — ${data.rows.length} employee(s)` : `Print preview — ${data.rows.length} employee(s)`}
        </strong>
        <span className="muted small">Use "Save as PDF" in the print dialog for a PDF copy.</span>
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        <button className="btn" onClick={() => window.close()}>
          Close
        </button>
      </div>

      {isList && (
        <div className="print-report">
          <div className="print-head">
            <Logo size={46} />
            <div>
              <h2>{COMPANY_NAME}</h2>
              <div className="print-subtitle">Performance Appraisal System</div>
              <div className="muted">Summary of Ratings for the period {data.period.name}</div>
            </div>
          </div>
          <table className="print-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Employee</th>
                <th>Position</th>
                <th>Department</th>
                <th>Supervisor</th>
                <th>HR</th>
                <th>Int. Audit</th>
                <th>Final</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const byType = Object.fromEntries(r.final.rows.map((x) => [x.type, x.score ? x.score.overall.toFixed(2) : '—']));
                return (
                  <tr key={r.user.id}>
                    <td>{i + 1}</td>
                    <td>{r.user.full_name}</td>
                    <td>{r.user.position || ''}</td>
                    <td>{r.user.department || ''}</td>
                    <td>{byType.supervisor ?? '—'}</td>
                    <td>{byType.hr ?? '—'}</td>
                    <td>{byType.audit ?? '—'}</td>
                    <td><strong>{r.final.final.toFixed(2)}</strong></td>
                    <td>{r.final.band.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="print-signatures">
            <div className="print-sign">
              <div className="print-sign-line"></div>
              <span className="muted small">Prepared by</span>
            </div>
            <div className="print-sign">
              <div className="print-sign-line"></div>
              <span className="muted small">Noted by</span>
            </div>
          </div>
          <div className="print-dates small">
            <span><strong>Date of Printing:</strong> {printedOn}</span>
          </div>
        </div>
      )}

      {!isList && data.rows.map((r) => {
        const ratingByFactor = new Map(r.factorRatings.map((x) => [x.factor_id, x.rating]));
        const myFactors = data.factors.filter((f) => f.active !== false && (r.user.is_supervisor || !f.supervisor_only));
        const sections = [];
        for (const f of myFactors) {
          const g = sections.find((s) => s.key === f.section);
          if (g) g.factors.push(f);
          else sections.push({ key: f.section, factors: [f] });
        }
        return (
          <div key={r.user.id} className="print-report">
            <div className="print-head">
              <Logo size={46} />
              <div>
                <h2>{COMPANY_NAME}</h2>
                <div className="print-subtitle">Performance Appraisal System</div>
                <div className="muted">Performance Evaluation for the period {data.period.name}</div>
              </div>
            </div>

            <table className="print-meta">
              <tbody>
                <tr>
                  <td><strong>Employee:</strong> {r.user.full_name}</td>
                  <td><strong>Position:</strong> {r.user.position || '—'}</td>
                  <td><strong>Department:</strong> {r.user.department || '—'}</td>
                </tr>
              </tbody>
            </table>

            <h3>Part I — Performance ({Math.round((data.settings.part1_weight ?? 0.7) * 100)}%)</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Weight</th>
                  <th>Work / Activity</th>
                  <th>Unit of Measure</th>
                  <th>Qty Target</th>
                  <th>Qty Accomp</th>
                  <th>QN</th>
                  <th>QL</th>
                  <th>T</th>
                  <th>APS</th>
                  <th>EPS</th>
                </tr>
              </thead>
              <tbody>
                {r.tasks.map((t) => {
                  const s = taskScore(t);
                  const rt = t.rating || {};
                  return (
                    <tr key={t.id}>
                      <td>{Number(t.weight).toFixed(2)}</td>
                      <td>{t.code ? `${t.code} ` : ''}{t.name}</td>
                      <td>{t.unit}</td>
                      <td>{t.qty_target}</td>
                      <td>{rt.qty_accomp || ''}</td>
                      <td>{s.qn ?? ''}</td>
                      <td>{s.ql ?? ''}</td>
                      <td>{s.t ?? ''}</td>
                      <td>{s.complete ? s.aps.toFixed(2) : ''}</td>
                      <td>{s.complete ? s.eps.toFixed(3) : ''}</td>
                    </tr>
                  );
                })}
                <tr className="print-total">
                  <td>{r.score.totalWeight.toFixed(2)}</td>
                  <td colSpan={8}>Total Equivalent Point Score (TEPS) × {Math.round((data.settings.part1_weight ?? 0.7) * 100)}% = Weighted Average Score</td>
                  <td>
                    {r.score.teps.toFixed(2)} → {r.score.was1.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>

            <h3>Part II — Critical Factors ({Math.round((data.settings.part2_weight ?? 0.3) * 100)}%)</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Critical Factor</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="print-section">
                      <td colSpan={2}>{SECTIONS[g.key] || g.key}</td>
                    </tr>
                    {g.factors.map((f) => (
                      <tr key={f.id}>
                        <td>{f.label}</td>
                        <td>{ratingByFactor.get(f.id) ?? ''}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="print-total">
                  <td>
                    Average Point Score ÷ {myFactors.length} × {Math.round((data.settings.part2_weight ?? 0.3) * 100)}% = Weighted Average Score
                  </td>
                  <td>
                    {r.score.aps2.toFixed(2)} → {r.score.was2.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>

            <h3>Page 3 — Final Rating</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Rater</th>
                  <th>Score</th>
                  <th>Weight</th>
                  <th>Weighted Score</th>
                </tr>
              </thead>
              <tbody>
                {r.final.rows.map((row) => (
                  <tr key={row.type}>
                    <td>{RATER_LABELS[row.type] || row.type}</td>
                    <td>{row.score ? row.score.overall.toFixed(2) : '—'}</td>
                    <td>{Math.round(row.weight * 100)}%</td>
                    <td>{row.weighted.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="print-total">
                  <td colSpan={3}>Final Numerical Performance Rating — {r.final.band.label} ({r.final.band.code})</td>
                  <td>{r.final.final.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <p className="small" style={{ marginTop: 14 }}>We discussed and agreed on the above ratings.</p>
            <div className="print-signatures">
              <div className="print-sign">
                <div className="print-sign-line"></div>
                <strong>{r.supervisor?.full_name || '____________________'}</strong>
                <span className="muted small">Rater (Supervisor)</span>
              </div>
              <div className="print-sign">
                <div className="print-sign-line"></div>
                <strong>{r.user.full_name}</strong>
                <span className="muted small">Ratee</span>
              </div>
            </div>
            <div className="print-dates small">
              <span>
                <strong>Date of Rating (Supervisor):</strong> {fmtDate(r.rated_at)}
              </span>
              <span>
                <strong>Date of Printing:</strong> {printedOn}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
