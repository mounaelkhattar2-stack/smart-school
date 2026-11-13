'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parse } = require('csv-parse/sync');
const { DatabaseSync, backup } = require('node:sqlite');
process.env.NODE_ENV='test';
const sourceDb = process.env.SMART_CLASS_TEST_SOURCE || path.join(__dirname,'..','data','smart-class.db');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(),'smart-class-phase2-'));
const testDb = path.join(testDir,'phase2-test.db');
const bcrypt=require('bcryptjs');
let app, db, findActiveLesson, setSchoolClockTestOverride;
let direction, teacherRecord, approvedParent, pendingParent, server;

const credentials = parse(fs.readFileSync(path.join(__dirname,'..','private_input','COMPTES_INITIAUX_CONFIDENTIELS.csv'),'utf8'),{columns:true,bom:true,skip_empty_lines:true});
const credentialById = new Map(credentials.map(row => [row.identifiant,row]));

async function makeIsolatedTestDatabase() {
  const sourceConnection = new DatabaseSync(sourceDb,{readOnly:true});
  try {
    if (typeof backup === 'function') {
      // Node's SQLite online backup API creates a consistent copy, including
      // committed WAL contents, without touching the source database files.
      await backup(sourceConnection,testDb);
    } else {
      // `backup()` was added in Node 22.16. Keep compatibility with earlier
      // Node 22 releases by asking SQLite itself to snapshot into the temp dir.
      const destination=testDb.replaceAll("'","''");
      sourceConnection.exec(`VACUUM INTO '${destination}'`);
    }
  } finally {
    sourceConnection.close();
  }
}

test.before(async () => {
  await makeIsolatedTestDatabase();
  process.env.SMART_CLASS_DB_PATH = testDb;
  ({ app, db, findActiveLesson, setSchoolClockTestOverride } = require('../server'));
  direction = credentialById.get('DIR-001');
  teacherRecord = db.prepare("SELECT login_id FROM users WHERE role='TEACHER' LIMIT 1").get();
  approvedParent = db.prepare("SELECT login_id FROM users WHERE role='PARENT' LIMIT 1").get();
  pendingParent = db.prepare("SELECT login_id FROM parents WHERE registration_status='EN_ATTENTE' LIMIT 1").get();
  server = app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{
    server.once('listening',resolve);
    server.once('error',reject);
  });
});

async function postLogin(record) {
  const address = server.address();
  return fetch(`http://127.0.0.1:${address.port}/api/login`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({login_id:record.identifiant,password:process.env.SMART_CLASS_TEST_PASSWORD||'12345678'})
  });
}
async function getWithCookie(url,cookie) { return fetch(url,{headers:{cookie}}); }
const cachedCookies=new Map();
async function loginCookie(record) {
  if(cachedCookies.has(record.identifiant))return cachedCookies.get(record.identifiant);
  const response=await postLogin(record);assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];cachedCookies.set(record.identifiant,cookie);return cookie;
}
const baseUrl=()=>`http://127.0.0.1:${server.address().port}`;
async function apiCall(path,cookie,{method='GET',body}={}){return fetch(`${baseUrl()}${path}`,{method,headers:{cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}

test.after(async () => {
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)db.close();
  fs.rmSync(testDir,{recursive:true,force:true});
  delete process.env.SMART_CLASS_DB_PATH;
});

test('imports all supplied record groups and preserves initial attendance states', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM classes').get().n,5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students').get().n,50);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parents').get().n,50);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n,20);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lessons').get().n,270);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE is_active=1').get().n,150);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE is_active=0').get().n,120);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM class_weekly_shifts').get().n,30);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teacher_workload_summary').get().n,20);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n > 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,1200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attendance WHERE status='NOT_RECORDED'").get().n,56);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_corrections').get().n,1);
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_authorizations').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance WHERE student_id IS NOT NULL AND lesson_id IS NOT NULL').get().n,1200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM absence_explanations WHERE attendance_id IS NOT NULL').get().n,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entry_decisions WHERE absence_attendance_id IS NOT NULL').get().n,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entry_holds WHERE status=\'ACTIVE\'').get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='uq_attendance_student_lesson_date'").get().n,1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM parents WHERE registration_status='EN_ATTENTE'").get().n,5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM parent_registration_requests WHERE status='EN_ATTENTE'").get().n,5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='PARENT'").get().n,45);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='TEACHER'").get().n,20);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='DIRECTION'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='attendance_demo'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE password_hash LIKE '$2%'").get().n,66);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM parent_registration_requests WHERE password_hash LIKE '$2%'").get().n,5);
});

test('Direction login creates a SQLite session and exposes aggregate data only to Direction', async () => {
  assert.ok(direction && direction.mot_de_passe_initial);
  const login=await postLogin(direction);
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const address=server.address();
  const summary=await getWithCookie(`http://127.0.0.1:${address.port}/api/direction/summary`,cookie);
  assert.equal(summary.status,200);
  assert.deepEqual(await summary.json(),{students:50,teachers:20,parents:50,activeParentAccounts:45,pendingParentRequests:5});
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n >= 1);
});

test('each role keeps its session through redirects and dashboard refreshes; logout clears it', async () => {
  const cases=[
    [credentialById.get('DIR-001'),'DIRECTION','/admin','/app.js'],
    [credentialById.get('F26099088'),'PARENT','/parent','/parent.js'],
    [credentialById.get('ENS-ARA-A'),'TEACHER','/teacher','/enseignant.js']
  ];
  for(const [record,role,destination,pageName] of cases){
    const login=await postLogin(record);
    assert.equal(login.status,200,record.identifiant);
    const setCookie=login.headers.get('set-cookie');
    assert.ok(setCookie&&setCookie.includes('smartclass.sid='));
    assert.doesNotMatch(setCookie,/\bSecure\b/i,'local HTTP session cookie must not require HTTPS');
    const cookie=setCookie.split(';')[0];
    const me=await apiCall('/api/me',cookie);
    assert.equal(me.status,200);assert.equal((await me.json()).user.role,role);
    const root=await fetch(`${baseUrl()}/`,{headers:{cookie},redirect:'manual'});
    assert.equal(root.status,302);assert.equal(root.headers.get('location'),destination);
    for(let refresh=0;refresh<2;refresh++){
      const page=await fetch(`${baseUrl()}${destination}`,{headers:{cookie},redirect:'manual'});
      assert.equal(page.status,200,`${role} dashboard refresh ${refresh+1}`);
      assert.ok((await page.text()).includes(pageName));
    }
    const logout=await fetch(`${baseUrl()}/api/logout`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});
    assert.equal(logout.status,200);assert.ok(logout.headers.get('set-cookie').includes('smartclass.sid='));
    assert.equal((await(await apiCall('/api/me',cookie)).json()).authenticated,false);
    const afterLogout=await fetch(`${baseUrl()}${destination}`,{headers:{cookie},redirect:'manual'});
    assert.equal(afterLogout.status,302);assert.equal(afterLogout.headers.get('location'),'/');
  }
});

test('incorrect login returns one API error without creating a session', async () => {
  const response=await fetch(`${baseUrl()}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login_id:'F26099088',password:'incorrect-password'})});
  assert.equal(response.status,401);assert.equal((await response.json()).error,'Identifiant ou mot de passe incorrect.');
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal((await(await fetch(`${baseUrl()}/api/me`)).json()).authenticated,false);
});

test('teacher can access own profile but not Direction data', async () => {
  const login=await postLogin(credentialById.get(teacherRecord.login_id));
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0], address=server.address();
  const profile=await getWithCookie(`http://127.0.0.1:${address.port}/api/teacher/profile`,cookie);
  assert.equal(profile.status,200);
  assert.ok((await profile.json()).teacher.teacher_id);
  const directionRoute=await getWithCookie(`http://127.0.0.1:${address.port}/api/direction/summary`,cookie);
  assert.equal(directionRoute.status,403);
});

test('parent can see the linked child; pending parent cannot log in', async () => {
  const login=await postLogin(credentialById.get(approvedParent.login_id));
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0], address=server.address();
  const childResponse=await getWithCookie(`http://127.0.0.1:${address.port}/api/parent/child`,cookie);
  assert.equal(childResponse.status,200);
  const child=(await childResponse.json()).child;
  assert.ok(child.student_id);
  assert.equal(Object.keys(child).length,6);
  assert.equal((await getWithCookie(`http://127.0.0.1:${address.port}/api/direction/summary`,cookie)).status,403);
  const pending=credentialById.get(pendingParent.login_id);
  const pendingLogin=await postLogin(pending);
  assert.equal(pendingLogin.status,401);
});

test('parent registration uses the same safe response for an ineligible child and a linked child', async () => {
  const address=server.address();
  const known=db.prepare('SELECT * FROM students LIMIT 1').get();
  const placeholder='x'.repeat(12);
  const base={parent_name:'Parent Test',child_name:known.full_name,class_id:known.class_id,class_number:known.class_number,massar_id:known.massar_id,email:'test@example.invalid',phone:'+212600000000',password:placeholder,password_confirmation:placeholder,confirmed:true};
  const post=body=>fetch(`http://127.0.0.1:${address.port}/api/register/parent`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const before=db.prepare('SELECT COUNT(*) AS n FROM parent_registration_requests').get().n;
  const knownResponse=await post(base);
  const unknownResponse=await post({...base,massar_id:'M00000000',class_id:'TCSF1',class_number:1});
  assert.equal(knownResponse.status,202);
  assert.equal(unknownResponse.status,202);
  assert.deepEqual(await knownResponse.json(),await unknownResponse.json());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_registration_requests').get().n,before);
});

test('Direction APIs reject anonymous and non-Direction users', async () => {
  assert.equal((await fetch(`${baseUrl()}/api/direction/dashboard`)).status,401);
  const cookie=await loginCookie(credentialById.get(teacherRecord.login_id));
  assert.equal((await getWithCookie(`${baseUrl()}/api/direction/students`,cookie)).status,403);
  assert.equal((await getWithCookie(`${baseUrl()}/api/direction/absences`,cookie)).status,403);
});

test('Direction application shell and local assets are served in French', async () => {
  const page=await fetch(`${baseUrl()}/admin`,{headers:{cookie:await loginCookie(direction)}}),html=await page.text();
  assert.equal(page.status,200);assert.ok(html.includes('Administration'));assert.ok(!html.includes('id="login-card"'));
  for(const label of ['Tableau de bord','Élèves','Enseignants','Parents','Classes','Absences','Emploi du temps',"Demandes d'inscription",'Notifications','Paramètres'])assert.ok(html.includes(label));
  for(const asset of ['/app.js','/admin.css','/admin-extra.css','/parent.html','/parent.js','/enseignant.html','/enseignant.js','/login.js'])assert.equal((await fetch(`${baseUrl()}${asset}`)).status,200);
});

test('dashboard attendance totals come from today’s database records', async () => {
  const cookie=await loginCookie(direction),response=await getWithCookie(`${baseUrl()}/api/direction/dashboard`,cookie);
  assert.equal(response.status,200);const data=await response.json();
  assert.deepEqual(data.totals,{students:50,teachers:20,parents:50,classes:5});
  const direct=db.prepare('SELECT status,COUNT(*) AS count FROM attendance WHERE lesson_date=? GROUP BY status').all(data.today);
  const expected={PRESENT:0,ABSENT:0,NOT_RECORDED:0};for(const item of direct)expected[item.status]=item.count;
  assert.deepEqual(data.attendance,expected);
  assert.ok(data.recentAbsences.every(row=>row.status==='ABSENT'));
  assert.equal(data.pendingRequestCount,5);
});

test('student and teacher search and profile routes return linked school records', async () => {
  const cookie=await loginCookie(direction);
  let response=await getWithCookie(`${baseUrl()}/api/direction/students?class_number=4`,cookie),students=(await response.json()).students;
  assert.equal(students.length,5);assert.ok(students.every(item=>item.class_number===4));
  response=await getWithCookie(`${baseUrl()}/api/direction/students?q=TCSF3`,cookie);assert.equal((await response.json()).students.length,10);
  const student=students[0];response=await getWithCookie(`${baseUrl()}/api/direction/students/${student.student_id}`,cookie);const profile=await response.json();
  assert.equal(profile.student.student_id,student.student_id);assert.ok(profile.parent);assert.equal(profile.timetable.length,30);assert.equal(profile.attendance.length,24);
  response=await getWithCookie(`${baseUrl()}/api/direction/teachers?q=Mat`,cookie);const teachers=(await response.json()).teachers;assert.ok(teachers.length>0);assert.ok(teachers.every(item=>`${item.full_name} ${item.teacher_id} ${item.subject_name}`.toLowerCase().includes('mat')));assert.ok(teachers.some(item=>item.subject_name.includes('Math')));
  response=await getWithCookie(`${baseUrl()}/api/direction/teachers/${teachers[0].teacher_id}`,cookie);const teacher=await response.json();
  assert.equal(teacher.teacher.teacher_id,teachers[0].teacher_id);assert.ok(teacher.timetable.length>0);assert.ok(teacher.classes.length>0);
});

test('parents, classes and timetables reflect the supplied records', async () => {
  const cookie=await loginCookie(direction);
  let response=await getWithCookie(`${baseUrl()}/api/direction/parents`,cookie),parents=(await response.json()).parents;
  assert.equal(parents.length,50);assert.equal(parents.filter(p=>p.can_login===1).length,45);assert.equal(parents.filter(p=>p.account_status==='PENDING').length,5);
  response=await getWithCookie(`${baseUrl()}/api/direction/classes`,cookie);const classes=(await response.json()).classes;
  assert.equal(classes.length,5);assert.ok(classes.every(c=>c.student_count===10&&c.lesson_count===30));
  response=await getWithCookie(`${baseUrl()}/api/direction/classes/${classes[0].class_id}`,cookie);const classProfile=await response.json();
  assert.equal(classProfile.students.length,10);assert.equal(classProfile.timetable.length,30);
  response=await getWithCookie(`${baseUrl()}/api/direction/timetable`,cookie);assert.equal((await response.json()).lessons.length,150);
  response=await getWithCookie(`${baseUrl()}/api/direction/timetable?class_id=${classes[0].class_id}`,cookie);assert.equal((await response.json()).lessons.length,30);
});

test('notifications and settings endpoints return editable local administration data', async () => {
  const cookie=await loginCookie(direction);
  let response=await getWithCookie(`${baseUrl()}/api/direction/notifications`,cookie),notifications=(await response.json()).notifications;
  assert.ok(Array.isArray(notifications));assert.ok(notifications.every(item=>!Object.hasOwn(item,'password_hash')));
  if(notifications.length){
    response=await fetch(`${baseUrl()}/api/direction/notifications/${notifications[0].notification_id}/read`,{method:'PATCH',headers:{cookie}});
    assert.equal(response.status,200);
  }
  response=await getWithCookie(`${baseUrl()}/api/direction/settings`,cookie);const data=await response.json();
  assert.equal(data.settings.school_name,'Établissement Abdlkrim El Khatabi');assert.ok(data.rooms.length>0);assert.equal(data.subjects.length,10);
  response=await fetch(`${baseUrl()}/api/direction/settings`,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({school_name:data.settings.school_name,school_year:data.settings.school_year})});
  assert.equal(response.status,200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='SCHOOL_SETTINGS_UPDATED'").get().n,1);
});

test('absence filters keep ABSENT, PRESENT and NOT_RECORDED distinct', async () => {
  const cookie=await loginCookie(direction);
  for(const[status,count]of [['ABSENT',5],['PRESENT',1139],['NOT_RECORDED',56]]){
    const response=await getWithCookie(`${baseUrl()}/api/direction/absences?status=${status}`,cookie),data=await response.json();
    assert.equal(data.total,count);assert.ok(data.records.every(row=>row.status===status));
  }
  const page1=await(await getWithCookie(`${baseUrl()}/api/direction/absences?limit=100&offset=0`,cookie)).json();
  const page2=await(await getWithCookie(`${baseUrl()}/api/direction/absences?limit=100&offset=100`,cookie)).json();
  assert.equal(page1.total,1200);assert.equal(page1.records.length,100);assert.equal(page2.records.length,100);
  assert.notEqual(page1.records[0].attendance_id,page2.records[0].attendance_id);
  assert.equal((await getWithCookie(`${baseUrl()}/api/direction/absences?status=UNKNOWN`,cookie)).status,400);
});

test('registration decisions activate one parent or preserve rejection reason and audit', async () => {
  const teacherCookie=await loginCookie(credentialById.get(teacherRecord.login_id));
  assert.equal((await fetch(`${baseUrl()}/api/direction/parent-requests/INS-PAR-046/decision`,{method:'POST',headers:{cookie:teacherCookie,'content-type':'application/json'},body:JSON.stringify({decision:'APPROUVEE'})})).status,403);
  const cookie=await loginCookie(direction);
  let response=await fetch(`${baseUrl()}/api/direction/parent-requests/INS-PAR-046/decision`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({decision:'APPROUVEE'})});
  assert.equal(response.status,200);
  const approved=db.prepare("SELECT * FROM users WHERE role='PARENT' AND student_id=(SELECT student_id FROM parents WHERE parent_id='PAR-046')").get();
  assert.ok(approved);assert.equal(db.prepare("SELECT account_status FROM parents WHERE parent_id='PAR-046'").get().account_status,'ACTIVE');
  assert.equal((await postLogin(credentialById.get(approved.login_id))).status,200);
  response=await fetch(`${baseUrl()}/api/direction/parent-requests/INS-PAR-047/decision`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({decision:'REFUSEE',reason:'Dossier incomplet à compléter.'})});
  assert.equal(response.status,200);
  const rejected=db.prepare("SELECT status,rejection_reason,decision_by FROM parent_registration_requests WHERE request_id='INS-PAR-047'").get();
  assert.equal(rejected.status,'REFUSEE');assert.equal(rejected.rejection_reason,'Dossier incomplet à compléter.');assert.equal(rejected.decision_by,'USR-DIR-001');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='PARENT_REQUEST_REFUSEE' AND entity_id='INS-PAR-047'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='PARENT' AND student_id=(SELECT student_id FROM parents WHERE parent_id='PAR-047')").get().n,0);
  assert.equal((await getWithCookie(`${baseUrl()}/api/direction/parent-requests`,cookie)).status,200);
});

test('redesigned timetable has 30 hours per class and balanced mixed-shift active teachers', () => {
  const classes=db.prepare('SELECT class_id,COUNT(*) hours FROM lessons WHERE is_active=1 GROUP BY class_id').all();
  assert.equal(classes.length,5);assert.ok(classes.every(row=>row.hours===30));
  const active=db.prepare("SELECT t.teacher_id,COUNT(l.lesson_id) hours,SUM(CASE WHEN l.shift='Matin' THEN 1 ELSE 0 END) morning,SUM(CASE WHEN l.shift='Après-midi' THEN 1 ELSE 0 END) afternoon FROM teachers t LEFT JOIN lessons l ON l.teacher_id=t.teacher_id AND l.is_active=1 WHERE t.status='Actif' GROUP BY t.teacher_id").all();
  assert.equal(active.length,14);assert.ok(active.every(row=>row.hours>=8&&row.hours<=16&&row.morning>=2&&row.afternoon>=2));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lessons WHERE is_active=1 AND day='Dimanche'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lessons WHERE is_active=1 AND day IN ('Vendredi','Samedi') AND shift='Après-midi'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lessons WHERE is_active=1 AND start_time<'14:00' AND end_time>'12:00'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM (SELECT class_id,day,slot_code,COUNT(*) n FROM lessons WHERE is_active=1 GROUP BY class_id,day,slot_code HAVING n>1)").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM (SELECT teacher_id,day,slot_code,COUNT(*) n FROM lessons WHERE is_active=1 GROUP BY teacher_id,day,slot_code HAVING n>1)").get().n,0);
  const sample=[{day:'Lundi',start_time:'08:00',end_time:'09:00'},{day:'Lundi',start_time:'09:00',end_time:'10:00'}];
  assert.equal(findActiveLesson(sample,{day:'Lundi',hour:8,minute:59}),sample[0]);assert.equal(findActiveLesson(sample,{day:'Lundi',hour:9,minute:0}),sample[1]);
  assert.equal(findActiveLesson(sample,{day:'Lundi',hour:10,minute:0}),null);assert.equal(findActiveLesson(sample,{day:'Dimanche',hour:8,minute:30}),null);
});

test('teacher attendance is server-timed, idempotent and requires Direction approval after an absence', async () => {
  const linkedStudent=db.prepare('SELECT student_id,class_id FROM students WHERE student_id=(SELECT student_id FROM users WHERE login_id=?)').get(approvedParent.login_id);
  const classRow={class_id:linkedStudent.class_id};
  const mondayLessons=db.prepare("SELECT * FROM lessons WHERE class_id=? AND day='Lundi' AND is_active=1 ORDER BY start_time").all(classRow.class_id);
  assert.ok(mondayLessons.length>=2);
  const first=mondayLessons[0],next=mondayLessons.find(row=>row.start_time>=first.end_time);assert.ok(next);
  const teacher1=db.prepare('SELECT login_id FROM users WHERE teacher_id=?').get(first.teacher_id);
  const teacher2=db.prepare('SELECT login_id FROM users WHERE teacher_id=?').get(next.teacher_id);
  const student={student_id:linkedStudent.student_id};
  const date='2026-11-16';
  setSchoolClockTestOverride({date,day:'Lundi',hour:Number(first.start_time.slice(0,2)),minute:Number(first.start_time.slice(3)),second:0,time:first.start_time});
  const teacherCookie=await loginCookie(credentialById.get(teacher1.login_id));
  let response=await apiCall('/api/teacher/active-lesson',teacherCookie);assert.equal(response.status,200);assert.equal((await response.json()).lesson.lesson_id,first.lesson_id);
  const roster=await(await apiCall(`/api/teacher/lessons/${first.lesson_id}/roster`,teacherCookie)).json();assert.equal(roster.students.length,10);assert.ok(roster.students.every(row=>row.status==='NOT_RECORDED'));
  response=await apiCall(`/api/teacher/lessons/${first.lesson_id}/attendance`,teacherCookie,{method:'POST',body:{student_id:student.student_id,status:'ABSENT'}});assert.equal(response.status,201,await response.text());
  assert.equal(db.prepare('SELECT status FROM attendance WHERE lesson_id=? AND student_id=? AND lesson_date=?').get(first.lesson_id,student.student_id,date).status,'ABSENT');
  response=await apiCall(`/api/teacher/lessons/${first.lesson_id}/attendance`,teacherCookie,{method:'POST',body:{student_id:student.student_id,status:'ABSENT'}});assert.equal(response.status,200);
  response=await apiCall(`/api/teacher/lessons/${first.lesson_id}/attendance`,teacherCookie,{method:'POST',body:{student_id:student.student_id,status:'PRESENT'}});assert.equal(response.status,409);
  setSchoolClockTestOverride({date,day:'Lundi',hour:Number(next.start_time.slice(0,2)),minute:Number(next.start_time.slice(3)),second:0,time:next.start_time});
  const nextTeacherCookie=await loginCookie(credentialById.get(teacher2.login_id));
  const nextRoster=await(await apiCall(`/api/teacher/lessons/${next.lesson_id}/roster`,nextTeacherCookie)).json();assert.equal(nextRoster.students.find(row=>row.student_id===student.student_id).blocked,true);
  response=await apiCall(`/api/teacher/lessons/${next.lesson_id}/attendance`,nextTeacherCookie,{method:'POST',body:{student_id:student.student_id,status:'PRESENT'}});assert.equal(response.status,403);
  const decision=db.prepare("SELECT decision_id FROM entry_decisions WHERE absence_attendance_id=(SELECT attendance_id FROM attendance WHERE lesson_id=? AND student_id=? AND lesson_date=?)").get(first.lesson_id,student.student_id,date);
  const directionCookie=await loginCookie(direction);
  response=await apiCall(`/api/direction/entry-decisions/${decision.decision_id}/decision`,directionCookie,{method:'POST',body:{decision:'AUTORISEE',reason:'Retour accordé pour le prochain cours.',authorized_lesson_id:next.lesson_id,authorized_lesson_date:date}});assert.equal(response.status,200,await response.text());
  response=await apiCall(`/api/teacher/lessons/${next.lesson_id}/attendance`,nextTeacherCookie,{method:'POST',body:{student_id:student.student_id,status:'PRESENT'}});assert.equal(response.status,201,await response.text());
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_authorizations WHERE decision_id=?').get(decision.decision_id).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance WHERE lesson_id=? AND student_id=? AND lesson_date=?').get(next.lesson_id,student.student_id,date).n,1);
  assert.equal((await apiCall(`/api/teacher/lessons/${next.lesson_id}/roster`,teacherCookie)).status,404);
  setSchoolClockTestOverride({date,day:'Lundi',hour:12,minute:30,second:0,time:'12:30'});
  const outside=await(await apiCall('/api/teacher/active-lesson',teacherCookie)).json();assert.equal(outside.lesson,null);
  setSchoolClockTestOverride(null);
  assert.equal((await apiCall('/api/teacher/active-lesson',null)).status,401);
});

test('Phase 3: parents can explain only their own child absence and Direction decisions stay separate', async () => {
  const parentCookie=await loginCookie(credentialById.get(approvedParent.login_id));
  const linkedStudent=db.prepare('SELECT student_id FROM users WHERE login_id=?').get(approvedParent.login_id).student_id;
  const ownAttendance=db.prepare("SELECT attendance_id FROM attendance WHERE student_id=? AND lesson_date='2026-11-16' AND status='ABSENT'").get(linkedStudent).attendance_id;
  assert.equal((await apiCall(`/api/parent/attendance/${ownAttendance}/explanations`,parentCookie,{method:'POST',body:{reason:'Pièce à vérifier.',document:{filename:'fichier.txt',content_type:'text/plain',content_base64:Buffer.from('pas un PDF').toString('base64')}}})).status,400);
  const pdf=Buffer.from('%PDF-1.4\nJustificatif local.\n');
  let response=await apiCall(`/api/parent/attendance/${ownAttendance}/explanations`,parentCookie,{method:'POST',body:{reason:'Rendez-vous médical confirmé.',document:{filename:'justificatif.pdf',content_type:'application/pdf',content_base64:pdf.toString('base64')}}});
  assert.equal(response.status,201);
  const ownExplanation=await response.json(),document=db.prepare('SELECT doc_id,storage_key FROM absence_explanation_documents WHERE explanation_id=?').get(ownExplanation.explanation_id);
  assert.ok(document);let fileResponse=await apiCall(`/api/absence-explanation-documents/${document.doc_id}`,parentCookie);assert.equal(fileResponse.status,200);assert.ok(Buffer.from(await fileResponse.arrayBuffer()).toString('ascii').startsWith('%PDF-'));
  const parentHistory=await apiCall('/api/parent/attendance',parentCookie);assert.equal(parentHistory.status,200);assert.ok((await parentHistory.json()).documents.some(d=>d.doc_id===document.doc_id));
  const otherLogin=db.prepare("SELECT login_id FROM users WHERE role='PARENT' AND student_id<>? LIMIT 1").get(linkedStudent).login_id;
  assert.equal((await apiCall(`/api/absence-explanation-documents/${document.doc_id}`,await loginCookie(credentialById.get(otherLogin)))).status,403);
  assert.equal((await apiCall(`/api/absence-explanation-documents/${document.doc_id}`,null)).status,401);
  assert.equal((await apiCall(`/api/parent/attendance/${ownAttendance}/explanations`,parentCookie,{method:'POST',body:{reason:'Deuxième demande.'}})).status,409);
  assert.equal((await apiCall('/api/parent/attendance/ATT-00003/explanations',parentCookie,{method:'POST',body:{reason:'Absence de l’autre enfant.'}})).status,404);
  const directionCookie=await loginCookie(direction),explanationId=ownExplanation.explanation_id;
  const directionQueue=await apiCall('/api/direction/absence-explanations?status=EN_ATTENTE',directionCookie);assert.equal(directionQueue.status,200);assert.ok((await directionQueue.json()).documents.some(d=>d.doc_id===document.doc_id));
  assert.equal((await apiCall(`/api/direction/absence-explanations/${explanationId}/decision`,null,{method:'POST',body:{decision:'APPROUVEE'}})).status,401);
  response=await apiCall(`/api/direction/absence-explanations/${explanationId}/decision`,directionCookie,{method:'POST',body:{decision:'APPROUVEE'}});
  assert.equal(response.status,200);
  assert.equal((await apiCall(`/api/absence-explanation-documents/${document.doc_id}`,directionCookie)).status,200);
  assert.equal(db.prepare('SELECT status FROM attendance WHERE attendance_id=?').get(ownAttendance).status,'ABSENT');
  assert.equal(db.prepare('SELECT status FROM absence_explanations WHERE explanation_id=?').get(explanationId).status,'APPROUVEE');
  assert.equal(db.prepare("SELECT status FROM entry_holds WHERE absence_attendance_id=?").get(ownAttendance).status,'CLOSED');
  const pending=db.prepare("SELECT explanation_id,attendance_id FROM absence_explanations WHERE status='EN_ATTENTE' ORDER BY explanation_id LIMIT 1").get();
  assert.equal((await apiCall(`/api/direction/absence-explanations/${pending.explanation_id}/decision`,directionCookie,{method:'POST',body:{decision:'REFUSEE'}})).status,400);
  response=await apiCall(`/api/direction/absence-explanations/${pending.explanation_id}/decision`,directionCookie,{method:'POST',body:{decision:'REFUSEE',reason:'Document justificatif manquant.'}});
  assert.equal(response.status,200);
  assert.equal(db.prepare('SELECT status FROM absence_explanations WHERE explanation_id=?').get(pending.explanation_id).status,'REFUSEE');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM absence_explanation_decisions WHERE explanation_id=?').get(pending.explanation_id).n,1);
  assert.equal((await apiCall('/api/direction/absence-explanations',parentCookie)).status,403);
  assert.equal((await apiCall('/api/teacher/lessons?date=2026-11-16',parentCookie)).status,403);
  assert.equal((await apiCall('/api/parent/attendance')).status,401);
});

test('Phase 3: correction remains append-only and Direction return approval is lesson specific', async () => {
  const directionCookie=await loginCookie(direction);
  const response=await apiCall('/api/direction/attendance/ATT-00002/corrections',directionCookie,{method:'POST',body:{status:'ABSENT',reason:'Feuille d’appel vérifiée par la Direction.'}});
  assert.equal(response.status,201);
  assert.equal(db.prepare("SELECT status FROM attendance WHERE attendance_id='ATT-00002'").get().status,'PRESENT');
  assert.equal(db.prepare("SELECT corrected_status FROM attendance_corrections WHERE attendance_id='ATT-00002' ORDER BY corrected_at DESC,rowid DESC LIMIT 1").get().corrected_status,'ABSENT');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='ATTENDANCE_CORRECTED' AND entity_id='ATT-00002'").get().n,1);
  assert.throws(()=>db.prepare("UPDATE attendance_corrections SET reason='effacé' WHERE attendance_id='ATT-00002'").run());
  const legacy=db.prepare("SELECT decision_id FROM entry_decisions WHERE decision_id='RET-002'").get();
  const later=db.prepare("SELECT lesson_id FROM lessons WHERE is_active=1 AND class_id='TCSF2' AND day='Lundi' ORDER BY start_time LIMIT 1").get().lesson_id;
  const result=await apiCall(`/api/direction/entry-decisions/${legacy.decision_id}/decision`,directionCookie,{method:'POST',body:{decision:'AUTORISEE',authorized_lesson_id:later,authorized_lesson_date:'2026-11-16',reason:'Autorisation réexaminée par la Direction.'}});
  assert.equal(result.status,200,await result.text());
  assert.equal(db.prepare("SELECT status FROM entry_decisions WHERE decision_id='RET-002'").get().status,'AUTORISEE');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM entry_decision_events WHERE decision_id='RET-002' AND source='LIVE'").get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_authorizations').get().n,1);
});

test('Parent dashboard returns its linked child arrays and week-scoped attendance only', async () => {
  const parent=credentialById.get(approvedParent.login_id),cookie=await loginCookie(parent);
  const linked=db.prepare('SELECT s.student_id,s.class_id FROM students s JOIN users u ON u.student_id=s.student_id WHERE u.login_id=?').get(parent.identifiant);
  const sample=db.prepare('SELECT lesson_date FROM attendance WHERE student_id=? ORDER BY lesson_date LIMIT 1').get(linked.student_id).lesson_date;
  const monday=new Date(`${sample}T00:00:00Z`);monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));const weekStart=monday.toISOString().slice(0,10);
  const response=await apiCall(`/api/parent/attendance?week_start=${weekStart}&student_id=NOT-THE-LINKED-CHILD`,cookie);assert.equal(response.status,200);const data=await response.json();
  for(const key of ['timetable','attendance','week_attendance','absences','explainable_absences','documents'])assert.ok(Array.isArray(data[key]),`${key} must always be an array`);
  assert.equal(data.child.student_id,linked.student_id);assert.equal(data.timetable.length,24);assert.ok(data.timetable.every(item=>item.class_id===linked.class_id));
  const currentWeek=await(await apiCall('/api/parent/attendance?week_start=2026-11-09',cookie)).json();
  assert.equal(currentWeek.timetable.length,30);assert.ok(currentWeek.timetable.every(item=>item.class_id===linked.class_id));
  assert.ok(data.attendance.every(item=>item.student_id===linked.student_id));assert.ok(data.absences.every(item=>item.student_id===linked.student_id));
  assert.ok(data.week_attendance.every(item=>item.lesson_date>=data.week_start&&item.lesson_date<=data.week_end));
  const total=data.absences.reduce((sum,item)=>sum+item.duration_hours,0);assert.ok(Math.abs(total-data.absence_hours)<0.001);
  assert.equal((await apiCall('/api/parent/attendance?week_start=not-a-date',cookie)).status,400);
  const secondParent=db.prepare("SELECT login_id FROM users WHERE role='PARENT' AND login_id<>?").all(parent.identifiant).find(row=>cachedCookies.has(row.login_id));
  assert.ok(secondParent);const second=await(await apiCall('/api/parent/attendance',cachedCookies.get(secondParent.login_id))).json();
  assert.notEqual(second.child.student_id,data.child.student_id);
});

test('Teacher timetable is limited to assigned lessons; role pages require their session', async () => {
  const teacher=credentialById.get(teacherRecord.login_id),cookie=await loginCookie(teacher),teacherId=db.prepare('SELECT teacher_id FROM users WHERE login_id=?').get(teacher.identifiant).teacher_id;
  const schedule=await(await apiCall('/api/teacher/timetable?date=2026-11-16',cookie)).json();
  assert.ok(Array.isArray(schedule.lessons));assert.ok(schedule.lessons.length>0);
  assert.deepEqual(schedule.lessons.map(l=>l.lesson_id).sort(),db.prepare('SELECT lesson_id FROM lessons WHERE teacher_id=? AND is_active=1 ORDER BY lesson_id').all(teacherId).map(l=>l.lesson_id).sort());
  const parentCookie=await loginCookie(credentialById.get(approvedParent.login_id));
  const wrongRole=await fetch(`${baseUrl()}/direction`,{headers:{cookie:parentCookie},redirect:'manual'});assert.equal(wrongRole.status,302);assert.equal(wrongRole.headers.get('location'),'/parent');
  const ownPage=await fetch(`${baseUrl()}/parent`,{headers:{cookie:parentCookie},redirect:'manual'});assert.equal(ownPage.status,200);assert.equal(ownPage.headers.get('cache-control'),'no-store');const parentHtml=await ownPage.text();assert.ok(parentHtml.includes('/parent.js'));assert.ok(!parentHtml.includes('id="login-card"'));
  const teacherPage=await fetch(`${baseUrl()}/teacher`,{headers:{cookie},redirect:'manual'});assert.equal(teacherPage.status,200);const teacherHtml=await teacherPage.text();assert.ok(teacherHtml.includes('/enseignant.js'));assert.ok(!teacherHtml.includes('id="login-card"'));
  assert.equal((await fetch(`${baseUrl()}/parent`,{redirect:'manual'})).status,302);assert.equal((await fetch(`${baseUrl()}/admin`,{redirect:'manual'})).status,302);assert.equal((await fetch(`${baseUrl()}/teacher`,{redirect:'manual'})).status,302);
  const adminCookie=await loginCookie(direction);const adminPage=await fetch(`${baseUrl()}/admin`,{headers:{cookie:adminCookie},redirect:'manual'});assert.equal(adminPage.status,200);assert.ok((await adminPage.text()).includes('/app.js'));const legacyAdmin=await fetch(`${baseUrl()}/direction`,{headers:{cookie:adminCookie},redirect:'manual'});assert.equal(legacyAdmin.status,302);assert.equal(legacyAdmin.headers.get('location'),'/admin');
});

test('Direction can safely update a timetable lesson and rejects duplicate class slots', async () => {
  const cookie=await loginCookie(direction),lesson=db.prepare('SELECT * FROM lessons WHERE is_active=1 ORDER BY lesson_id LIMIT 1').get();
  const original={day:lesson.day,slot_code:lesson.slot_code,subject_code:lesson.subject_code,teacher_id:lesson.teacher_id,room:lesson.room};
  let response=await fetch(`${baseUrl()}/api/direction/timetable/${lesson.lesson_id}`,{headers:{cookie}});assert.equal(response.status,200);
  response=await fetch(`${baseUrl()}/api/direction/timetable/${lesson.lesson_id}`,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(original)});assert.equal(response.status,200);
  const conflict=db.prepare('SELECT * FROM lessons WHERE is_active=1 AND class_id=? AND day=? AND lesson_id<>? ORDER BY slot_code LIMIT 1').get(lesson.class_id,lesson.day,lesson.lesson_id);
  if(conflict){response=await fetch(`${baseUrl()}/api/direction/timetable/${lesson.lesson_id}`,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({...original,slot_code:conflict.slot_code})});assert.equal(response.status,409);}
});
