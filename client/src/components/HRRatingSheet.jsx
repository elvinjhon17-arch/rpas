import { useState } from 'react';
import Modal from './Modal.jsx';

// HR Rating Checklist - mirrors the paper "HR Rating Sheet" (RPAS):
// five criteria scored 10/8/6/4/2; the average becomes the HR Rate.
export const HR_CRITERIA = [
  {
    key: 'punctuality',
    label: '1. Punctuality (Tardiness / Undertime)',
    options: [
      [10, 'Not more than 3 times'],
      [8, '4–6 times'],
      [6, '7–10 times'],
      [4, '11–15 times'],
      [2, 'More than 15 times']
    ]
  },
  {
    key: 'attendance',
    label: '2. Attendance (Absences)',
    options: [
      [10, 'Not more than 4 days'],
      [8, '5–8 days'],
      [6, '9–12 days'],
      [4, '13–16 days'],
      [2, 'More than 16 days']
    ]
  },
  {
    key: 'rpas_timeliness',
    label: '3. Timeliness of RPAS Submission',
    options: [
      [10, 'On or before deadline'],
      [8, '1–2 days late'],
      [6, '3–5 days late'],
      [4, '6–10 days late'],
      [2, 'More than 10 days late / not submitted']
    ]
  },
  {
    key: 'complaints',
    label: '4. Client or Co-Employee Complaints',
    options: [
      [10, 'No complaints'],
      [8, '1 minor complaint'],
      [6, '2–3 minor complaints'],
      [4, 'Repeated / moderate complaints'],
      [2, 'Serious complaint / multiple issues']
    ]
  },
  {
    key: 'violations',
    label: '5. Violations of Bank Policies',
    options: [
      [10, 'No violations'],
      [8, '1 minor violation'],
      [6, '2–3 minor violations'],
      [4, 'Repeated violations'],
      [2, 'Major violation / disciplinary action']
    ]
  }
];

export default function HRRatingSheet({ ratee, onSubmit, onClose }) {
  const [picks, setPicks] = useState({});
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);

  const values = HR_CRITERIA.map((c) => picks[c.key]).filter((v) => v !== undefined);
  const total = values.reduce((a, b) => a + b, 0);
  const average = values.length ? Math.round((total / values.length) * 100) / 100 : 0;
  const complete = values.length === HR_CRITERIA.length;

  const submit = async () => {
    if (!window.confirm(`Submit HR Rating of ${average.toFixed(2)} for ${ratee.full_name}? You will not be able to edit it afterwards.`))
      return;
    setBusy(true);
    try {
      await onSubmit({ detail: picks, comments });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`HR Rating Checklist — ${ratee.full_name}`} onClose={onClose} wide>
      <p className="muted small">
        Tick one rating per criterion (paper HR Rating Sheet). The average of the five becomes the HR Rate on Page 3.
      </p>
      {HR_CRITERIA.map((c) => (
        <div key={c.key} className="hr-criterion">
          <strong className="small">{c.label}</strong>
          {c.options.map(([value, text]) => (
            <label key={value} className="check-label small hr-option">
              <input
                type="radio"
                name={c.key}
                checked={picks[c.key] === value}
                onChange={() => setPicks((prev) => ({ ...prev, [c.key]: value }))}
              />
              <span>
                <strong>{value}</strong> — {text}
              </span>
            </label>
          ))}
        </div>
      ))}
      <div className="hr-total">
        Total Score: <strong>{total}</strong> · Average Rating: <strong>{average.toFixed(2)}</strong>
        {!complete && <span className="muted small"> — rate all {HR_CRITERIA.length} criteria to submit</span>}
      </div>
      <label>
        Comments and Recommendations (optional)
        <textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
      </label>
      <button className="btn btn-primary btn-block" disabled={!complete || busy} onClick={submit}>
        Submit HR Rating ({average.toFixed(2)})
      </button>
    </Modal>
  );
}
