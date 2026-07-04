import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { DEFAULT_SETTINGS, RATER_TYPES, RATER_LABELS } from '../../scoring.js';
import { SkeletonPage } from '../../components/Skeleton.jsx';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api('/settings')
      .then(({ settings }) => setSettings(settings))
      .catch((e) => setMsg({ type: 'error', text: e.message }));
  }, []);

  if (!settings) return <SkeletonPage />;

  const p1 = Number(settings.part1_weight);
  const p2 = Number(settings.part2_weight);
  const weightsOk = Math.abs(p1 + p2 - 1) < 0.001;

  const raterWeights = { ...DEFAULT_SETTINGS.rater_weights, ...(settings.rater_weights || {}) };
  const raterTotal = RATER_TYPES.reduce((sum, t) => sum + Number(raterWeights[t] || 0), 0);
  const raterOk = Math.abs(raterTotal - 1) < 0.001;

  const save = async () => {
    try {
      const bands = [...settings.bands].sort((a, b) => b.min - a.min);
      const { settings: updated } = await api('/settings', {
        method: 'PUT',
        body: { part1_weight: p1, part2_weight: p2, rating_scale: settings.rating_scale, bands, rater_weights: raterWeights }
      });
      setSettings(updated);
      setMsg({ type: 'success', text: 'Formula settings saved.' });
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  };

  const setBand = (i, patch) => {
    const bands = settings.bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    setSettings({ ...settings, bands });
  };

  return (
    <div>
      <div className="page-head">
        <h1>Formula Settings</h1>
        <button className="btn btn-primary" onClick={save} disabled={!weightsOk || !raterOk}>
          Save settings
        </button>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
      {!weightsOk && <div className="alert alert-error">Part I + Part II weights must add up to 100%.</div>}
      {!raterOk && <div className="alert alert-error">The five rater weights must add up to 100% (currently {Math.round(raterTotal * 100)}%).</div>}

      <div className="grid-2">
        <div className="card">
          <h3>Part weights</h3>
          <label>
            Part I — Performance weight (0-1)
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={settings.part1_weight}
              onChange={(e) => setSettings({ ...settings, part1_weight: e.target.value })}
            />
          </label>
          <label>
            Part II — Critical factors weight (0-1)
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={settings.part2_weight}
              onChange={(e) => setSettings({ ...settings, part2_weight: e.target.value })}
            />
          </label>
          <h3 style={{ marginTop: 20 }}>Rating scale</h3>
          <label>
            Tap-to-rate values (comma separated)
            <input
              value={(settings.rating_scale || []).join(', ')}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  rating_scale: e.target.value
                    .split(',')
                    .map((v) => Number(v.trim()))
                    .filter((v) => !Number.isNaN(v))
                })
              }
            />
          </label>
          <p className="muted small">Default 10, 8, 6, 4, 2 — same as the paper RPAS form.</p>

          <h3 style={{ marginTop: 20 }}>Rater weights (Page 3)</h3>
          {RATER_TYPES.map((t) => (
            <label key={t}>
              {RATER_LABELS[t]} (0-1)
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={raterWeights[t]}
                onChange={(e) =>
                  setSettings({ ...settings, rater_weights: { ...raterWeights, [t]: Number(e.target.value) } })
                }
              />
            </label>
          ))}
          <p className="muted small">Default: Supervisor 50%, HR 20%, Internal Audit 30%.</p>
        </div>

        <div className="card">
          <h3>Adjectival rating bands</h3>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Score from</th>
                <th>Code</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {settings.bands.map((b, i) => (
                <tr key={i}>
                  <td>
                    <input type="number" step="0.01" value={b.min} onChange={(e) => setBand(i, { min: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input value={b.code} onChange={(e) => setBand(i, { code: e.target.value })} style={{ width: 60 }} />
                  </td>
                  <td>
                    <input value={b.label} onChange={(e) => setBand(i, { label: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">An employee gets the first band whose "score from" value their overall score reaches.</p>
        </div>
      </div>
    </div>
  );
}
