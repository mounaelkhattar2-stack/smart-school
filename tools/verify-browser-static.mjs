// Playwright browser test of the built static site (dist) served under /smart-school/.
// Uses disposable server-side fixtures only; real school records are never modified.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(x => x.trim() && !x.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
if (!env.SUPABASE_DB_CA_CERT) throw Error('SUPABASE_DB_CA_CERT is required for verified TLS.');
const run = crypto.randomUUID(), tag = run.slice(0, 8).toUpperCase();
const email = id => `id-${[...new TextEncoder().encode(id.trim())].map(b => b.toString(16).padStart(2, '0')).join('')}@login.smart-school-2027.invalid`;
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = new Client({ connectionString: env.DATABASE_URL, ssl: { ca: fs.readFileSync(env.SUPABASE_DB_CA_CERT, 'utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
const results = [], errors = [], latencies = [];
const record = (ok, label, extra = '') => { results.push({ ok, label }); console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${extra ? ' — ' + extra : ''}`); if (!ok) process.exitCode = 1; };
const authUsers = [], clients = [];
const password = `Browser-${crypto.randomUUID()}-Zz9!`;
const fixture = { students: [], lessons: [], teacherId: `ZB-T-${tag}`, teacherLogin: `ZB-TLOGIN-${tag}`, student1: `ZB-STU1-${tag}`, student2: `ZB-STU2-${tag}`, extraStudent: null };

// --- static file server for dist under /smart-school/ ---
const root = path.resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (!pathname.startsWith('/smart-school/')) { res.writeHead(404).end(); return; }
  let file = path.resolve(root, pathname.slice('/smart-school/'.length) || 'index.html');
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const base = 'http://127.0.0.1:4174/smart-school/';

async function makeUser(role, code, profileRow) {
  const e = email(code);
  const { data, error } = await admin.auth.admin.createUser({ email: e, password, email_confirm: true, app_metadata: { account_code: code, role, status: 'ACTIVE' } });
  if (error || !data.user) throw Error(`Fixture ${role} auth failed: ${error?.message}`);
  authUsers.push(data.user.id);
  const dbClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await dbClient.auth.signInWithPassword({ email: e, password });
  if (signed.error) throw Error(`Fixture ${role} sign-in failed.`);
  clients.push(dbClient);
  await db.query(`insert into public.profiles(id,account_code,legacy_user_id,full_name,role,status${profileRow.extraCols}) values ($1,$2,$3,$4,$5,'ACTIVE'${profileRow.extraVals})`, [data.user.id, code, `ZB-LEG-${code}`, profileRow.fullName, role, ...profileRow.extraParams]);
  return { id: data.user.id, code, email: e, client: dbClient };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function login(page, id, usedPassword = password) {
  await page.goto(base);
  await page.locator('#login-id').fill(id);
  await page.locator('#login-password').fill(usedPassword);
  await page.getByRole('button', { name: /Se connecter/ }).click();
}

try {
  await db.connect();
  await new Promise(r => server.listen(4174, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true });

  // ---------- fixtures ----------
  const classRow = (await db.query(`select class_id from public.classes order by class_id limit 1`)).rows[0];
  const classId = classRow.class_id;
  await db.query(`insert into public.students(student_id,massar_id,full_name,class_id,class_number,status,provenance) values ($1,$2,$3,$4,960,'Actif','DISPOSABLE_TEST'),($5,$6,$7,$4,961,'Actif','DISPOSABLE_TEST')`,
    [fixture.student1, `ZB${tag}S1`, `Élève Browser ${tag} Un`, classId, fixture.student2, `ZB${tag}S2`, `Élève Browser ${tag} Deux`]);
  fixture.students = [fixture.student1, fixture.student2];
  const today = (await db.query(`select to_char(timezone('Africa/Casablanca',clock_timestamp()),'YYYY-MM-DD') d, extract(isodow from timezone('Africa/Casablanca',clock_timestamp()))::int dow, to_char(timezone('Africa/Casablanca',clock_timestamp())::time - interval '2 minutes','HH24:MI') s, to_char(timezone('Africa/Casablanca',clock_timestamp())::time + interval '25 minutes','HH24:MI') e`)).rows[0];
  const dayName = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'][today.dow - 1];
  const lessonId = `ZB-LES-${tag}`;
  await db.query(`insert into public.teachers(teacher_id,login_id,full_name,subject_code,subject_name,shift,email,phone,status,max_hours_day,max_shift_day) values ($1,$2,'Enseignant Browser ${tag}','INF','Informatique','Mixte',$3,'+212600000000','Actif',4,1)`,
    [fixture.teacherId, fixture.teacherLogin, `zb-${tag.toLowerCase()}@smartclass.example.invalid`]);
  await db.query(`insert into public.lessons(lesson_id,day,day_index,shift,slot_code,start_time,end_time,class_id,subject_code,subject_name,teacher_id,teacher_name,room,color,is_active) values ($1,$2,$3,'Test','ZB1',$4,$5,$6,'INF','Informatique',$7,$7,'ZB','#5274dd',true)`,
    [lessonId, dayName, today.dow, today.s, today.e, classId, fixture.teacherId]);
  fixture.lessons = [lessonId];
  const direction = await makeUser('DIRECTION', `ZB-DIR-${tag}`, { extraCols: '', extraVals: '', fullName: `Direction Browser ${tag}`, extraParams: [] });
  const teacher = await makeUser('TEACHER', fixture.teacherLogin, { extraCols: ',teacher_id', extraVals: ',$5', fullName: `Enseignant Browser ${tag}`, extraParams: [fixture.teacherId] });
  const parent = await makeUser('PARENT', `ZB-PAR-${tag}`, { extraCols: ',student_id', extraVals: ',$5', fullName: `Parent Browser ${tag}`, extraParams: [fixture.student1] });

  // ---------- 1. wrong credentials stay on the login page ----------
  {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    await login(page, 'ZB-NONEXISTENT', `Mauvais-${crypto.randomUUID()}-Aa1!`);
    await page.locator('#login-message').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const msg = await page.locator('#login-message').innerText().catch(() => '');
    record(msg.includes('Identifiant ou mot de passe incorrect'), 'wrong credentials show the French error and stay on the login page', msg);
    record(new URL(page.url()).pathname.endsWith('/smart-school/'), 'login page does not navigate on wrong credentials');
    await page.close();
  }

  // ---------- 2. Direction ----------
  {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push(e.name));
    await login(page, direction.code);
    await page.waitForURL('**/admin/**', { timeout: 20000 }).catch(() => {});
    record(page.url().includes('/admin/'), 'Direction login routes to /admin/', page.url());
    await page.locator('#admin-content .content-wrap').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const views = ['dashboard', 'students', 'teachers', 'parents', 'classes', 'absences', 'timetable', 'requests', 'notifications', 'accounts', 'settings'];
    const headings = { dashboard: 'Tableau de bord', students: 'Élèves', teachers: 'Enseignants', parents: 'Parents', classes: 'Classes', absences: 'Absences', timetable: 'Emploi du temps', requests: "Demandes d'inscription", notifications: 'Notifications', accounts: 'Comptes', settings: 'Paramètres' };
    let viewsOk = 0;
    for (const view of views) {
      await page.locator(`[data-view="${view}"]`).click();
      await wait(500);
      const content = await page.locator('#admin-content').innerText().catch(() => '');
      if (content.includes(headings[view])) viewsOk++; else errors.push(`Direction view ${view}: heading missing`);
    }
    record(viewsOk === views.length, `all ${views.length} Direction views render (passed ${viewsOk})`);

    // search finds the disposable student among real records
    await page.locator('[data-view="students"]').click();
    await wait(600);
    await page.locator('#student-search').fill(`ZB${tag}S1`);
    await wait(800);
    const tableText = await page.locator('#table-region').innerText().catch(() => '');
    record(tableText.includes(`ZB${tag}S1`), 'student search finds the disposable student in the roster');

    // create a student through the UI
    await page.locator('[data-new-student]').click();
    await page.locator('#student-form').waitFor({ state: 'visible', timeout: 10000 });
    const massar = `ZB${tag}M3`;
    await page.locator('#student-form input[name="full_name"]').fill(`Élève Browser ${tag} Trois`);
    await page.locator('#student-form input[name="massar_id"]').fill(massar);
    await page.locator('#student-form select[name="class_id"]').selectOption(classId);
    await page.locator('#student-form input[name="class_number"]').fill('962');
    await page.locator('#student-form button[type="submit"]').click();
    await wait(1200);
    const created = (await db.query(`select student_id from public.students where massar_id=$1`, [massar])).rows[0];
    record(!!created, 'Direction UI creates a student record (RPC direction_save_student)');
    fixture.extraStudent = created?.student_id || null;

    // archive it through the UI (confirm dialog)
    if (fixture.extraStudent) {
      page.once('dialog', d => d.accept());
      await page.locator(`[data-archive-student="${fixture.extraStudent}"]`).click().catch(e => errors.push(`archive click: ${e.message}`));
      await wait(1200);
      const archived = (await db.query(`select status from public.students where student_id=$1`, [fixture.extraStudent])).rows[0];
      record(archived?.status === 'Inactif', 'Direction UI archives the created student without deleting history');
    }

    // notifications: disposable notification visible + mark-as-read works
    await db.query(`insert into public.notifications(notification_id,role,title,message,created_at,is_read) values ($1,'DIRECTION','ZB-Notification ${tag}','Test jetable','${today.d}T12:00:00+00:00','false')`, [`ZB-NOT-${tag}`]).catch(e => {
      return db.query(`insert into public.notifications(notification_id,role,title,message,is_read) values ($1,'DIRECTION',$2,'Test jetable','false')`, [`ZB-NOT-${tag}`, `ZB-Notification ${tag}`]);
    });
    await page.locator('[data-view="notifications"]').click();
    await wait(700);
    const notifText = await page.locator('#admin-content').innerText().catch(() => '');
    record(notifText.includes(`ZB-Notification ${tag}`), 'Direction notifications view lists the disposable notification');
    if (notifText.includes(`ZB-Notification ${tag}`)) {
      await page.locator(`[data-read-id="ZB-NOT-${tag}"]`).first().click().catch(async () => {
        // fallback: any mark-read control in the row
        await page.locator('#admin-content [data-notification-read], #admin-content button:has-text("Marquer comme lue")').first().click().catch(() => {});
      });
      await wait(900);
      const readRow = (await db.query(`select is_read from public.notifications where notification_id=$1`, [`ZB-NOT-${tag}`])).rows[0];
      record(readRow?.is_read === true || readRow?.is_read === 'true', 'marking a notification as read persists');
    }

    // refresh persistence
    await page.reload();
    await wait(1500);
    record(page.url().includes('/admin/'), 'Direction session survives a page refresh');

    // logout
    await page.locator('#admin-logout').click().catch(() => errors.push('Direction logout button missing'));
    await page.waitForFunction(() => location.pathname.endsWith('/smart-school/'), null, { timeout: 10000 }).catch(() => {});
    record(new URL(page.url()).pathname.endsWith('/smart-school/'), 'Direction logout returns to the login page');
    record(consoleErrors.length === 0, 'Direction produced no page errors', consoleErrors.join(','));

    // mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + 'admin/');
    await wait(800);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    record(noOverflow, 'Direction mobile layout has no horizontal overflow');
    await page.close();
  }

  // ---------- 3. Parent first (realtime capture), Teacher second ----------
  const parentPage = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const latencies = [];
  parentPage.on('console', m => { const x = /latency \(ms\):\s*(\d+)/.exec(m.text()); if (x) latencies.push(Number(x[1])); });
  parentPage.on('pageerror', e => errors.push(`parent pageerror: ${e.name}`));
  await login(parentPage, parent.code);
  await parentPage.waitForURL('**/parent/**', { timeout: 20000 }).catch(() => {});
  record(parentPage.url().includes('/parent/'), 'Parent login routes to /parent/', parentPage.url());
  await parentPage.locator('.parent-child-heading').waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
  const childHeading = await parentPage.locator('.parent-child-heading').innerText().catch(() => '');
  record(childHeading.includes('Élève Browser') && childHeading.includes(classId), 'Parent sees only the linked disposable child');
  const otherChildHidden = await parentPage.evaluate(async studentId => {
    const { data, error } = await window.smartSchoolSupabase.from('students').select('student_id').eq('student_id', studentId);
    return !error && (data || []).length === 0;
  }, fixture.student2);
  record(otherChildHidden, 'parent RLS prevents reading a different disposable child');

  // weekly timetable renders with the unified structure
  const tableInfo = await parentPage.evaluate(() => {
    const table = document.querySelector('.parent-week-table');
    if (!table) return null;
    const days = [...table.querySelectorAll('thead th')].map(t => t.textContent.trim());
    const lunch = !!table.querySelector('.parent-lunch-row');
    const lessons = table.querySelectorAll('.parent-lesson').length;
    return { days, lunch, lessons };
  });
  record(!!tableInfo && ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].every(d => tableInfo.days.includes(d)), 'parent weekly timetable shows Monday to Sunday');
  record(!!tableInfo?.lunch, 'parent timetable includes the lunch break row');
  record((tableInfo?.lessons || 0) >= 24, 'parent timetable shows the class weekly lessons', `${tableInfo?.lessons} lesson cards`);

  // previous/next week navigation
  await parentPage.getByRole('button', { name: /Semaine précédente/ }).click();
  await wait(400);
  const navOk = (await parentPage.locator('.parent-week-controls').innerText()).includes('semaine') || (await parentPage.locator('.parent-week-controls strong').count()) === 1;
  record(navOk, 'parent week navigation works');
  await parentPage.getByRole('button', { name: /Semaine suivante/ }).click();
  await wait(400);

  // ---------- 4. Teacher (separate context) ----------
  const teacherPage = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  teacherPage.on('console', m => { const x = /latency \(ms\):\s*(\d+)/.exec(m.text()); if (x) latencies.push(Number(x[1])); });
  teacherPage.on('pageerror', e => errors.push(`teacher pageerror: ${e.name}`));
  await login(teacherPage, fixture.teacherLogin);
  await teacherPage.waitForURL('**/teacher/**', { timeout: 20000 }).catch(() => {});
  record(teacherPage.url().includes('/teacher/'), 'Teacher login routes to /teacher/', teacherPage.url());
  await teacherPage.locator('.parent-child-heading').waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
  const ttInfo = await teacherPage.evaluate(() => ({ lessons: document.querySelectorAll('.parent-lesson').length, lunch: !!document.querySelector('.parent-lunch-row') }));
  record((ttInfo.lessons || 0) === 1, 'teacher unified timetable shows the assigned lesson');
  record(!!ttInfo.lunch, 'teacher timetable keeps the unified weekly structure');

  // attendance tab: current lesson detected automatically
  await teacherPage.locator('[data-tab="attendance"]').click();
  await wait(700);
  const liveCard = await teacherPage.locator('.live-lesson-card').innerText().catch(() => '');
  record(liveCard.includes('COURS EN COURS'), 'teacher current lesson is detected automatically', liveCard.replace(/\s+/g, ' ').slice(0, 80));
  await teacherPage.locator('[data-open-roster]').click();
  await teacherPage.locator('#teacher-roster tr[data-student-row]').first().waitFor({ state: 'attached', timeout: 10000 });
  const rosterRows = await teacherPage.locator('#teacher-roster tr[data-student-row]').count();
  record(rosterRows === 12, 'roster shows the class students (10 real + 2 disposable)', `${rosterRows} rows`);

  // two visible actions only
  const buttonsInfo = await teacherPage.evaluate(() => {
    const row = document.querySelector(`tr[data-student-row="${fixture.student1}"]`) || document.querySelector('#teacher-roster tr[data-student-row]');
    const b = row ? [...row.querySelectorAll('.attendance-actions button')] : [];
    return { count: b.length, labels: b.map(x => x.textContent.trim()) };
  });
  record(buttonsInfo.count === 2 && buttonsInfo.labels.join(',') === 'Présent,Absent', 'each student shows exactly PRÉSENT and ABSENT actions');

  // mark student1 PRESENT
  await teacherPage.locator(`tr[data-student-row="${fixture.student1}"] button[data-mark="PRESENT"]`).click();
  await teacherPage.waitForFunction(() => document.querySelector('#teacher-message')?.textContent?.includes('Présence enregistrée'), null, { timeout: 15000 }).catch(() => {});
  const msg1 = await teacherPage.locator('#teacher-message').innerText().catch(() => '');
  record(msg1.includes('Présence enregistrée'), 'teacher marks a student present via the trusted RPC', msg1);
  const presentRow = await teacherPage.locator(`tr[data-student-row="${fixture.student1}"]`).innerText();
  record(presentRow.includes('Présent'), 'roster row updates to Présent without reload');

  // mark student2 ABSENT
  await teacherPage.locator(`tr[data-student-row="${fixture.student2}"] button[data-mark="ABSENT"]`).click();
  await teacherPage.waitForFunction(() => document.querySelector('#teacher-message')?.textContent?.includes('Présence enregistrée'), null, { timeout: 15000 }).catch(() => {});
  const absentRow = await teacherPage.locator(`tr[data-student-row="${fixture.student2}"]`).innerText();
  record(absentRow.includes('Absent'), 'teacher marks a student absent');

  // authorization rule: absent student cannot be marked present without Direction approval
  await teacherPage.locator(`tr[data-student-row="${fixture.student2}"] button[data-mark="PRESENT"]`).click().catch(() => {});
  await wait(1200);
  const blocked = await teacherPage.locator('#teacher-message').innerText().catch(() => '');
  record(blocked.includes('autorisation') || blocked.includes('bloqué'), 'return after absence is blocked pending Direction authorization', blocked.slice(0, 90));

  // realtime: parent received the attendance event for its own child
  await wait(2500);
  record(latencies.length >= 1, 'parent received the realtime attendance update in the browser', `events: ${latencies.length}`);
  const parentRowRealtime = await parentPage.locator(`.parent-week-table .parent-status-present`).count();
  record(parentRowRealtime >= 1, 'parent timetable shows the live green presence');

  // history tab
  await teacherPage.locator('[data-tab="history"]').click();
  await wait(1200);
  const historyText = await teacherPage.locator('#teacher-panel').innerText().catch(() => '');
  record(historyText.includes('Historique') && historyText.includes(`Élève Browser ${tag} Un`), 'teacher attendance history lists the records');

  // teacher refresh persistence + logout
  await teacherPage.reload();
  await wait(1500);
  record(teacherPage.url().includes('/teacher/'), 'teacher session survives refresh');
  await teacherPage.locator('[data-tab="settings"]').click();
  await wait(400);
  await teacherPage.locator('[data-logout]').click();
  await teacherPage.waitForFunction(() => location.pathname.endsWith('/smart-school/'), null, { timeout: 10000 }).catch(() => {});
  record(new URL(teacherPage.url()).pathname.endsWith('/smart-school/'), 'teacher logout returns to login');

  // parent refresh persistence + admin redirect + logout
  await parentPage.reload();
  await wait(1500);
  record(parentPage.url().includes('/parent/'), 'parent session survives refresh');
  await parentPage.goto(base + 'admin/');
  await wait(1500);
  record(parentPage.url().includes('/parent/') || new URL(parentPage.url()).pathname.endsWith('/smart-school/'), 'parent is redirected away from the Direction area', parentPage.url());
  await parentPage.locator('[data-tab="absences"], button:has-text("Absences de l\'année")').first().click().catch(() => {});
  await wait(800);
  const absenceTab = await parentPage.locator('#parent-content').innerText().catch(() => '');
  record(absenceTab.includes('Absence'), 'parent absence history tab renders');
  await parentPage.locator('[data-logout], button:has-text("Déconnexion")').first().click();
  await parentPage.waitForFunction(() => location.pathname.endsWith('/smart-school/'), null, { timeout: 10000 }).catch(() => {});
  record(new URL(parentPage.url()).pathname.endsWith('/smart-school/'), 'parent logout returns to login');

  // verify real students were never written
  const realWrites = (await db.query(`select count(*) n from public.attendance a join public.lesson_occurrences o on o.occurrence_id=a.occurrence_id where o.lesson_id=$1 and a.student_id not like 'ZB-%'`, [lessonId])).rows[0].n;
  record(Number(realWrites) === 0, 'no real student attendance row was written by the browser test');

  await browser.close();
} catch (e) {
  console.error('ABORT:', e.message);
  process.exitCode = 1;
} finally {
  try {
    await server.close();
    if (db._connected) {
      await db.query('begin').catch(() => {});
      await db.query(`delete from public.attendance where student_id = any($1::text[])`, [fixture.students]).catch(() => {});
      await db.query(`delete from public.lesson_occurrences where lesson_id = any($1::text[])`, [fixture.lessons]).catch(() => {});
      await db.query(`delete from public.audit_log where entity_type='parent_registration_request' and entity_id in (select request_id from public.parent_registration_requests where massar_id like 'ZB%')`).catch(() => {});
      await db.query(`delete from public.notifications where notification_id like 'ZB-NOT-%'`).catch(() => {});
      await db.query(`delete from public.audit_log where actor_user_id = any($1::uuid[])`, [authUsers]).catch(() => {});
      await db.query(`delete from public.profiles where student_id = any($1::text[])`, [fixture.students]).catch(() => {});
      await db.query(`delete from public.profiles where account_code like 'ZB-%${tag}%'`).catch(() => {});
      await db.query(`delete from public.parents where student_id = any($1::text[])`, [fixture.students]).catch(() => {});
      if (fixture.extraStudent) await db.query(`delete from public.students where student_id=$1`, [fixture.extraStudent]).catch(() => {});
      await db.query(`delete from public.students where student_id = any($1::text[])`, [fixture.students]).catch(() => {});
      await db.query(`delete from public.profiles where teacher_id = $1`, [fixture.teacherId]).catch(() => {});
      await db.query(`delete from public.teachers where teacher_id = $1`, [fixture.teacherId]).catch(() => {});
      await db.query(`delete from public.lessons where lesson_id = any($1::text[])`, [fixture.lessons]).catch(() => {});
      await db.query('commit').catch(() => {});
      await db.end().catch(() => {});
    }
  } catch (e) { console.error('cleanup(db):', e.message); }
  for (const uid of [...new Set(authUsers)]) await admin.auth.admin.deleteUser(uid).catch(e => console.error('cleanup(auth):', e.message));
  for (const c of clients) await c.auth.signOut({ scope: 'local' }).catch(() => {});
  await admin.auth.signOut({ scope: 'local' }).catch(() => {});
  const ok = results.filter(r => r.ok).length;
  console.log(`\nBrowser summary: ${ok}/${results.length} checks passed.`);
  if (errors.length) console.log('Notes:', errors.join(' | '));
  if (latencies.length) {
    const s = [...latencies].sort((a, b) => a - b);
    console.log(`Browser realtime recorded_at-to-callback: median ${s[Math.floor(s.length / 2)]} ms | min ${s[0]} | max ${s[s.length - 1]} | n=${s.length}`);
  }
}
