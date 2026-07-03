// Seeds the database with the admin account, active period, Part II critical
// factors, formula settings and (with --sample) a demo employee with tasks.
// Run AFTER executing server/sql/schema.sql in the Supabase SQL Editor:
//   npm run seed            (base data only)
//   npm run seed -- --sample  (also creates a demo employee account)
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, must } from '../src/supabase.js';
import { DEFAULT_SETTINGS } from '../src/scoring.js';

const withSample = process.argv.includes('--sample');

const FACTORS = [
  // A. Personal Attributes
  ['A', 'Has initiative; sees things to be done and does them.'],
  ['A', 'Communicates ideas logically and clearly.'],
  ['A', 'Reliable/resourceful in problem solving; needs less supervision on tasks.'],
  ['A', 'Pleasant disposition despite work pressures.'],
  ['A', 'Ability for teamwork / to work well with others.'],
  ['A', 'Adaptability / openness to change.'],
  // B. Observance of Work Station Conduct
  ['B', 'Observance of proper work attire / good grooming.'],
  ['B', 'Engages not in unofficial / non-work related activities during working hours.'],
  ['B', 'Punctuality and attendance; observance of lunch and break periods.'],
  ['B', 'Neatness and orderliness of work station.'],
  ['B', 'Possesses good and right attitude towards work and co-workers.'],
  // C. Service Excellence Condition
  ['C', 'Work simplification / improved systems introduced or implemented resulting in efficiency.'],
  ['C', 'No client or user complaint due to neglect of duty or below acceptable level of performance.'],
  ['C', 'Courtesy / attentiveness extended to clients or users of service.'],
  ['C', 'Turnaround time in meeting clients, users or unit requirements.'],
  // D. Judgment and Decision Making (supervisors only)
  ['D', 'Ability to develop alternative solutions for problems.', true],
  ['D', 'Evaluates facts or courses of action and reaches sound decisions.', true],
  ['D', 'Readiness to take action or commit oneself.', true]
];

// Mirrors the real PEF-1 form (Head Office Teller, July-December 2025) - weights sum to 1.00
const SAMPLE_TASKS = [
  ['1. Reports', '1.1', 'Cash Holding', 'sum of money', '132', '1', 'EOD', 0.05],
  ['1. Reports', '1.3', 'AMLC-AMLA Report', '# of reports prepared', 'ATC', '1', 'EOD', 0.1],
  ['2. Activities', '2.1', 'Deposit', 'accuracy of work', '132', '1', 'EOD', 0.15],
  ['2. Activities', '2.2', 'Withdrawal', 'accuracy of work', '132', '1', 'EOD', 0.15],
  ['2. Activities', '2.3', 'Issuance of Official Receipt/Coll Receipt', 'accuracy of work', '132', '1', 'EOD', 0.1],
  ['2. Activities', '2.4', 'Overages/Shortages', 'accuracy of work', '132', '1', 'EOD', 0.05],
  ['2. Activities', '2.5', 'Releases', 'accuracy of work', '132', '1', 'EOD', 0.1],
  ['2. Activities', '2.7', 'Accuracy of transaction entries', 'accuracy of work', '132', '1', 'EOD', 0.2],
  ['3. Service / Assistance to Client', '3.1', 'Market Educ Savers Club Deposit', '# of clients', '6', '1', 'EOS', 0.05],
  ['3. Service / Assistance to Client', '3.2', 'Market Time Deposit (New/Rollover)', '# of clients', '12', '1', 'EOS', 0.05]
];

async function upsertUser({ username, password, full_name, position, department, role, is_supervisor, rater_privilege = 'none' }) {
  const password_hash = await bcrypt.hash(password, 10);
  const existing = must(await db.from('users').select('id').eq('username', username).limit(1));
  if (existing[0]) {
    console.log(`- user "${username}" already exists, keeping it`);
    return existing[0].id;
  }
  const rows = must(
    await db
      .from('users')
      .insert({ username, password_hash, full_name, position, department, role, is_supervisor, rater_privilege })
      .select()
  );
  console.log(`- created user "${username}" (password: ${password})`);
  return rows[0].id;
}

async function main() {
  console.log('Seeding RBLI RPAS...');

  // 1. Avatars bucket
  const { error: bucketErr } = await db.storage.createBucket('avatars', { public: true });
  if (bucketErr && !/already exists/i.test(bucketErr.message)) throw new Error(`Bucket: ${bucketErr.message}`);
  console.log('- storage bucket "avatars" ready');

  // 2. Admin account
  await upsertUser({
    username: 'admin',
    password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
    full_name: 'System Administrator',
    position: 'Administrator',
    department: 'Admin',
    role: 'admin',
    is_supervisor: false
  });

  // 3. Active period
  let periodId;
  const periods = must(await db.from('periods').select('*').limit(1));
  if (periods.length) {
    periodId = periods[0].id;
    console.log(`- period already exists ("${periods[0].name}"), keeping it`);
  } else {
    const rows = must(
      await db
        .from('periods')
        .insert({ name: 'July - December 2026', start_date: '2026-07-01', end_date: '2026-12-31', is_active: true })
        .select()
    );
    periodId = rows[0].id;
    console.log('- created active period "July - December 2026"');
  }

  // 4. Critical factors
  const existingFactors = must(await db.from('factors').select('id').limit(1));
  if (existingFactors.length) {
    console.log('- factors already exist, keeping them');
  } else {
    const rows = FACTORS.map(([section, label, supervisor_only], i) => ({
      section,
      label,
      supervisor_only: !!supervisor_only,
      sort_order: i
    }));
    must(await db.from('factors').insert(rows).select());
    console.log(`- created ${rows.length} Part II critical factors`);
  }

  // 5. Formula settings
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    must(await db.from('settings').upsert({ key, value }, { onConflict: 'key' }).select());
  }
  console.log('- formula settings saved (Part I 70% / Part II 30%, rating bands)');

  // 6. Optional demo employee
  if (withSample) {
    const employeeId = await upsertUser({
      username: 'demo',
      password: 'demo123',
      full_name: 'Demo Employee',
      position: 'Head Office Teller',
      department: 'Cash Department',
      role: 'employee',
      is_supervisor: false
    });
    // A supervisor account assigned as the demo employee's Supervisor rater
    const supervisorId = await upsertUser({
      username: 'supervisor',
      password: 'super123',
      full_name: 'Demo Supervisor',
      position: 'Cashier',
      department: 'Cash Department',
      role: 'employee',
      is_supervisor: true,
      rater_privilege: 'full'
    });
    must(
      await db
        .from('rater_assignments')
        .upsert({ ratee_id: employeeId, rater_type: 'supervisor', rater_user_id: supervisorId }, { onConflict: 'ratee_id,rater_type' })
        .select()
    );
    console.log('- assigned "supervisor" as Supervisor rater of "demo"');
    const existingTasks = must(await db.from('tasks').select('id').eq('user_id', employeeId).eq('period_id', periodId).limit(1));
    if (!existingTasks.length) {
      const rows = SAMPLE_TASKS.map(([category, code, name, unit, qty_target, quality_target, time_target, weight], i) => ({
        user_id: employeeId,
        period_id: periodId,
        category,
        code,
        name,
        unit,
        qty_target,
        quality_target,
        time_target,
        weight,
        sort_order: i
      }));
      must(await db.from('tasks').insert(rows).select());
      console.log(`- created ${rows.length} sample tasks for "demo" (weights sum to 1.00)`);
    }
  }

  console.log('\nDone! Log in as "admin" to get started.');
}

main().catch((e) => {
  console.error('\nSeed failed:', e.message);
  console.error('Did you run server/sql/schema.sql in the Supabase SQL Editor first?');
  process.exit(1);
});
