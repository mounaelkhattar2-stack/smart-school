'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');

const ROOT = __dirname;
const DB_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.SMART_CLASS_DB_PATH || path.join(DB_DIR, 'smart-class.db');
const PRIVATE_CREDENTIALS = path.join(ROOT, 'private_input', 'COMPTES_INITIAUX_CONFIDENTIELS.csv');
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_ABSENCE_DOCUMENT_BYTES = 2 * 1024 * 1024;
const ABSENCE_DOCUMENT_DIR = path.join(path.dirname(DB_PATH),'absence-documents');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS seed_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('DIRECTION','TEACHER','PARENT')),
  full_name TEXT NOT NULL, password_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
  student_id TEXT, teacher_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_parent_per_student ON users(student_id) WHERE role='PARENT' AND student_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS classes (class_id TEXT PRIMARY KEY, name TEXT, level TEXT, track TEXT, language TEXT, enrollment INTEGER);
CREATE TABLE IF NOT EXISTS subjects (code TEXT PRIMARY KEY, name TEXT NOT NULL, weekly_hours INTEGER, color TEXT, usual_room TEXT);
CREATE TABLE IF NOT EXISTS rooms (room_name TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS class_weekly_shifts (class_id TEXT NOT NULL REFERENCES classes(class_id), day TEXT NOT NULL, shift TEXT NOT NULL, shift_start TEXT, shift_end TEXT, lesson_hours INTEGER, PRIMARY KEY(class_id,day));
CREATE TABLE IF NOT EXISTS students (
  student_id TEXT PRIMARY KEY, massar_id TEXT NOT NULL UNIQUE, last_name TEXT, first_name TEXT, full_name TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(class_id), class_number INTEGER NOT NULL, birth_date TEXT, school_email TEXT,
  status TEXT, parent_id TEXT, parent_name TEXT, parent_phone TEXT, parent_email TEXT, photo_path TEXT, provenance TEXT DEFAULT 'INITIAL_GENERATED_UNVERIFIED'
);
CREATE INDEX IF NOT EXISTS idx_students_class_number ON students(class_id,class_number);
CREATE TABLE IF NOT EXISTS teachers (
  teacher_id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE, last_name TEXT, first_name TEXT, full_name TEXT NOT NULL,
  subject_code TEXT, subject_name TEXT, shift TEXT, email TEXT, phone TEXT, status TEXT, max_hours_day INTEGER, max_shift_day INTEGER
);
CREATE TABLE IF NOT EXISTS parents (
  parent_id TEXT PRIMARY KEY, login_id TEXT, last_name TEXT, first_name TEXT, full_name TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(student_id), child_massar_id TEXT NOT NULL, child_name TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(class_id), class_number INTEGER NOT NULL,
  email TEXT, phone TEXT, registration_status TEXT NOT NULL, submitted_at TEXT, approved_at TEXT,
  account_status TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX IF NOT EXISTS idx_parents_student ON parents(student_id);
CREATE TABLE IF NOT EXISTS teacher_assignments (teacher_id TEXT PRIMARY KEY REFERENCES teachers(teacher_id), subject_name TEXT, shift TEXT, assigned_classes TEXT, weekly_hours INTEGER, max_hours_day INTEGER);
CREATE TABLE IF NOT EXISTS teacher_workload_summary (teacher_id TEXT PRIMARY KEY REFERENCES teachers(teacher_id), subject_name TEXT, teacher_name TEXT, shift TEXT, weekly_hours INTEGER, max_hours_day INTEGER);
CREATE TABLE IF NOT EXISTS teacher_work_schedule (teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id), day TEXT NOT NULL, shift TEXT, shift_start TEXT, shift_end TEXT, lesson_hours INTEGER, day_status TEXT, PRIMARY KEY(teacher_id,day));
CREATE TABLE IF NOT EXISTS lessons (
  lesson_id TEXT PRIMARY KEY, day TEXT NOT NULL, day_index INTEGER, shift TEXT NOT NULL, slot_code TEXT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, class_id TEXT NOT NULL REFERENCES classes(class_id),
  subject_code TEXT NOT NULL REFERENCES subjects(code), subject_name TEXT NOT NULL, teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
  teacher_name TEXT NOT NULL, room TEXT, color TEXT
);
CREATE TABLE IF NOT EXISTS attendance (
  attendance_id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(lesson_id), lesson_date TEXT NOT NULL,
  day TEXT, slot_code TEXT, class_id TEXT NOT NULL, student_id TEXT NOT NULL REFERENCES students(student_id), massar_id TEXT NOT NULL,
  student_name TEXT NOT NULL, teacher_id TEXT, teacher_name TEXT, subject_name TEXT, status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','NOT_RECORDED')),
  access_status TEXT, recorded_at TEXT, provenance TEXT DEFAULT 'INITIAL_GENERATED_UNVERIFIED'
);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_id,lesson_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
CREATE TABLE IF NOT EXISTS absence_explanations (explanation_id TEXT PRIMARY KEY, student_id TEXT, massar_id TEXT, student_name TEXT, class_id TEXT, lesson_id TEXT, absence_date TEXT, reason TEXT, status TEXT, direction_decision TEXT, decided_by TEXT, decided_at TEXT, internal_note TEXT);
CREATE TABLE IF NOT EXISTS entry_decisions (decision_id TEXT PRIMARY KEY, student_id TEXT, massar_id TEXT, student_name TEXT, class_id TEXT, absence_lesson_id TEXT, status TEXT, authorized_lesson_id TEXT, direction_decision TEXT, decided_at TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS attendance_corrections (correction_id TEXT PRIMARY KEY, attendance_id TEXT, lesson_id TEXT, student_id TEXT, massar_id TEXT, student_name TEXT, original_status TEXT, corrected_status TEXT, reason TEXT, actor TEXT, corrected_at TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS parent_registration_requests (
  request_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, parent_name TEXT NOT NULL, child_name TEXT NOT NULL,
  class_id TEXT NOT NULL, class_number INTEGER NOT NULL, massar_id TEXT NOT NULL, email TEXT, phone TEXT,
  submitted_at TEXT NOT NULL, status TEXT NOT NULL, decision_by TEXT, decision_at TEXT, rejection_reason TEXT,
  password_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registration_status ON parent_registration_requests(status,submitted_at);
CREATE TABLE IF NOT EXISTS teacher_absences (absence_id TEXT PRIMARY KEY, teacher_id TEXT, teacher_name TEXT, absence_date TEXT, type TEXT, reason TEXT, substitute TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS notifications (notification_id TEXT PRIMARY KEY, role TEXT, user_id TEXT, title TEXT, message TEXT, created_at TEXT, is_read TEXT);
CREATE TABLE IF NOT EXISTS school_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (event_id TEXT PRIMARY KEY, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);

function applyMigrations() {
  db.exec('BEGIN IMMEDIATE');
  try {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const version = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
  if (version >= 1) { db.exec('COMMIT'); return; }
  const duplicates = db.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT student_id,lesson_id,lesson_date FROM attendance
    GROUP BY student_id,lesson_id,lesson_date HAVING COUNT(*)>1
  )`).get().n;
  if (duplicates) throw new Error(`Migration 1 stopped: ${duplicates} duplicate attendance keys must be reviewed first.`);
  const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  const addColumn = (table, name, declaration) => { if (!columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`); };
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_student_lesson_date ON attendance(student_id,lesson_id,lesson_date);
      CREATE TABLE IF NOT EXISTS absence_explanation_decisions (
        decision_id TEXT PRIMARY KEY, explanation_id TEXT NOT NULL, action TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', decided_by TEXT, decided_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'LIVE'
      );
      CREATE INDEX IF NOT EXISTS idx_explanation_decisions ON absence_explanation_decisions(explanation_id,decided_at);
      CREATE TABLE IF NOT EXISTS entry_decision_events (
        event_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, action TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', actor_user_id TEXT, authorized_lesson_id TEXT,
        authorized_lesson_date TEXT, created_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'LIVE'
      );
      CREATE INDEX IF NOT EXISTS idx_entry_events ON entry_decision_events(decision_id,created_at);
      CREATE TABLE IF NOT EXISTS entry_holds (
        hold_id TEXT PRIMARY KEY, student_id TEXT NOT NULL, absence_attendance_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','CLOSED')), created_at TEXT NOT NULL,
        closed_at TEXT, closed_by TEXT, close_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entry_holds_student_status ON entry_holds(student_id,status);
      CREATE TRIGGER IF NOT EXISTS attendance_corrections_no_update BEFORE UPDATE ON attendance_corrections
      BEGIN SELECT RAISE(ABORT,'Les corrections de présence sont immuables.'); END;
      CREATE TRIGGER IF NOT EXISTS attendance_corrections_no_delete BEFORE DELETE ON attendance_corrections
      BEGIN SELECT RAISE(ABORT,'Les corrections de présence sont immuables.'); END;
    `);
    addColumn('absence_explanations','attendance_id','TEXT');
    addColumn('absence_explanations','submitted_by','TEXT');
    addColumn('absence_explanations','created_at','TEXT');
    addColumn('entry_decisions','absence_attendance_id','TEXT');
    addColumn('entry_decisions','authorized_lesson_date','TEXT');
    addColumn('entry_decisions','authorized_by','TEXT');
    db.exec(`
      UPDATE absence_explanations SET attendance_id=(
        SELECT a.attendance_id FROM attendance a WHERE a.student_id=absence_explanations.student_id
          AND a.lesson_id=absence_explanations.lesson_id AND a.lesson_date=absence_explanations.absence_date
        ORDER BY a.attendance_id LIMIT 1
      ), created_at=COALESCE(NULLIF(decided_at,''),absence_date||'T00:00:00Z') WHERE attendance_id IS NULL;
      UPDATE entry_decisions SET absence_attendance_id=(
        SELECT a.attendance_id FROM attendance a WHERE a.student_id=entry_decisions.student_id
          AND a.lesson_id=entry_decisions.absence_lesson_id AND a.status='ABSENT'
        ORDER BY a.lesson_date DESC,a.attendance_id LIMIT 1
      ), authorized_by=NULLIF(direction_decision,'') WHERE absence_attendance_id IS NULL;
      UPDATE entry_decisions SET authorized_lesson_date=(
        SELECT a.lesson_date FROM attendance a WHERE a.student_id=entry_decisions.student_id
          AND a.lesson_id=entry_decisions.authorized_lesson_id AND a.lesson_date>(
            SELECT source.lesson_date FROM attendance source WHERE source.attendance_id=entry_decisions.absence_attendance_id
          ) ORDER BY a.lesson_date LIMIT 1
      ) WHERE status='AUTORISEE' AND COALESCE(authorized_lesson_id,'')<>'';
      UPDATE entry_decisions SET authorized_by=(SELECT user_id FROM users WHERE login_id=entry_decisions.direction_decision LIMIT 1)
        WHERE authorized_by IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_explanation_attendance ON absence_explanations(attendance_id) WHERE attendance_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_decision_absence ON entry_decisions(absence_attendance_id) WHERE absence_attendance_id IS NOT NULL;
    `);
    const now = new Date().toISOString();
    const explanationRows = db.prepare("SELECT explanation_id,status,direction_decision,decided_by,decided_at FROM absence_explanations WHERE status IN ('APPROUVEE','REFUSEE')").all();
    const explanationEvent = db.prepare('INSERT OR IGNORE INTO absence_explanation_decisions(decision_id,explanation_id,action,reason,decided_by,decided_at,source) VALUES(?,?,?,?,?,?,?)');
    for (const row of explanationRows) explanationEvent.run(`MIG-${row.explanation_id}`,row.explanation_id,row.status,row.direction_decision||'',row.decided_by||null,row.decided_at||now,'MIGRATION_SNAPSHOT');
    const entryRows = db.prepare('SELECT decision_id,status,reason,direction_decision,decided_at,authorized_lesson_id,authorized_lesson_date FROM entry_decisions').all();
    const entryEvent = db.prepare('INSERT OR IGNORE INTO entry_decision_events(event_id,decision_id,action,reason,actor_user_id,authorized_lesson_id,authorized_lesson_date,created_at,source) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const row of entryRows) entryEvent.run(`MIG-${row.decision_id}`,row.decision_id,row.status,row.reason||'',row.direction_decision||null,row.authorized_lesson_id||null,row.authorized_lesson_date||null,row.decided_at||now,'MIGRATION_SNAPSHOT');
    db.prepare(`INSERT OR IGNORE INTO entry_holds(hold_id,student_id,absence_attendance_id,status,created_at)
      SELECT 'HOLD-'||a.attendance_id,a.student_id,a.attendance_id,'ACTIVE',COALESCE(a.recorded_at,?)
      FROM attendance a LEFT JOIN absence_explanations e ON e.attendance_id=a.attendance_id
      LEFT JOIN attendance_corrections c ON c.attendance_id=a.attendance_id
      WHERE a.status='ABSENT' AND COALESCE(c.corrected_status,'ABSENT')='ABSENT'
        AND COALESCE(e.status,'')<>'APPROUVEE'`).run(now);
    db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(1,'attendance_absence_workflows',?)").run(now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
applyMigrations();
function applyAttachmentMigration() {
  db.exec('BEGIN IMMEDIATE');
  try {
    const version=db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
    if(version>=2){db.exec('COMMIT');return;}
    db.exec(`CREATE TABLE absence_explanation_documents (
      doc_id TEXT PRIMARY KEY, explanation_id TEXT NOT NULL REFERENCES absence_explanations(explanation_id),
      original_filename TEXT NOT NULL, content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/png','image/jpeg')),
      storage_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 2097152),
      uploaded_by TEXT NOT NULL REFERENCES users(user_id), uploaded_at TEXT NOT NULL
    ); CREATE INDEX idx_explanation_documents ON absence_explanation_documents(explanation_id,uploaded_at);`);
    db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(2,'local_absence_explanation_documents',?)").run(new Date().toISOString());
    db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;}
}
applyAttachmentMigration();

function readCsv(file) {
  const input = fs.readFileSync(path.join(ROOT, 'seed_data', file), 'utf8');
  return parse(input, { columns: true, skip_empty_lines: true, bom: true, relax_quotes: false, trim: false });
}
function readJson(file) { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
function value(row, key, fallback = '') { return row[key] == null ? fallback : String(row[key]); }
function asNumber(input) { return input === '' || input == null ? null : Number(input); }
function normalizeLogin(input) { return String(input || '').trim(); }

function seedAuxiliaryData() {
  if (db.prepare("SELECT value FROM seed_meta WHERE key='auxiliary_seed_v1'").get()) return false;
  const shifts=readCsv('class_weekly_shifts.csv');
  const workload=readCsv('teacher_workload_summary.csv');
  const timetable=readCsv('weekly_timetable.csv');
  const subjects=readCsv('subjects.csv');
  db.exec('BEGIN IMMEDIATE');
  try {
    const shiftStmt=db.prepare('INSERT INTO class_weekly_shifts VALUES(?,?,?,?,?,?)');
    shifts.forEach(r=>shiftStmt.run(r.classe_id,r.jour,r.shift,r.debut,r.fin,asNumber(r.nombre_heures)));
    const workloadStmt=db.prepare('INSERT INTO teacher_workload_summary VALUES(?,?,?,?,?,?)');
    workload.forEach(r=>workloadStmt.run(r.identifiant,r.matiere,r.enseignant,r.shift,asNumber(r.heures_semaine),asNumber(r.max_heures_jour)));
    const roomStmt=db.prepare('INSERT OR IGNORE INTO rooms(room_name) VALUES(?)');
    for(const room of new Set([...timetable.map(r=>r.salle),...subjects.map(r=>r.salle_habituelle)].filter(Boolean))) roomStmt.run(room);
    db.prepare("INSERT INTO seed_meta(key,value) VALUES('auxiliary_seed_v1',?)").run(new Date().toISOString());
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
  return true;
}

function loadCredentials() {
  if (!fs.existsSync(PRIVATE_CREDENTIALS)) throw new Error('Le fichier privé des comptes initiaux est absent.');
  const rows = parse(fs.readFileSync(PRIVATE_CREDENTIALS, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
  const map = new Map();
  for (const row of rows) {
    const login = normalizeLogin(row.identifiant);
    if (!login || !row.mot_de_passe_initial) throw new Error('Le fichier privé des comptes contient une entrée incomplète.');
    if (map.has(login)) throw new Error('Le fichier privé des comptes contient un identifiant en double.');
    map.set(login, { role: value(row, 'role'), password: row.mot_de_passe_initial });
  }
  return map;
}

function insertSeedData() {
  if (db.prepare("SELECT value FROM seed_meta WHERE key='initial_seed_v1'").get()) return { seeded: false, auxiliarySeeded: seedAuxiliaryData() };
  const credentials = loadCredentials();
  const classes = readCsv('classes.csv');
  const subjects = readCsv('subjects.csv');
  const students = readCsv('students.csv');
  const parents = readCsv('parents.csv');
  const teachers = readCsv('teachers.csv');
  const assignments = readCsv('teacher_assignments.csv');
  const workSchedule = readCsv('teacher_work_schedule.csv');
  const timetable = readCsv('weekly_timetable.csv');
  const attendance = readCsv('attendance_initiale.csv');
  const explanations = readCsv('absence_explanations.csv');
  const entryDecisions = readCsv('entry_decisions.csv');
  const corrections = readCsv('attendance_corrections.csv');
  const teacherAbsences = readCsv('teacher_absences.csv');
  const notifications = readCsv('notifications.csv');
  const seedJson = readJson('seed_data/seed-data.json');
  const initialRequests = Array.isArray(seedJson.parent_registration_requests) ? seedJson.parent_registration_requests : [];

  if (classes.length !== 5 || students.length !== 50 || parents.length !== 50 || teachers.length !== 20 || timetable.length !== 120 || attendance.length !== 1200)
    throw new Error('Les nombres de lignes du jeu initial ne correspondent pas aux données attendues.');

  const parentById = new Map(parents.map(p => [p.parent_id, p]));
  const pendingParents = parents.filter(p => p.statut_inscription === 'EN_ATTENTE');
  if (pendingParents.length !== 5 || initialRequests.length !== 5) throw new Error('Les cinq demandes parentales en attente ne sont pas présentes.');
  const requestsByParent = new Map(initialRequests.map(r => [r.parent_id, r]));
  for (const parent of pendingParents) {
    const request = requestsByParent.get(parent.parent_id);
    if (!request || request.masar_id !== parent.masar_id_enfant || request.child_name !== parent.nom_enfant || request.class_id !== parent.classe_id || Number(request.class_number) !== Number(parent.numero_classe) || request.status !== 'EN_ATTENTE') {
      throw new Error('Une demande en attente de seed-data.json ne correspond pas au parent associé.');
    }
  }
  for (const request of initialRequests) if (!parentById.has(request.parent_id)) throw new Error('Une demande parentale ne possède pas de fiche parent correspondante.');

  const passwordHash = new Map();
  for (const [login, record] of credentials) passwordHash.set(login, bcrypt.hashSync(record.password, 12));
  // Remove plaintext credentials from memory as soon as all hashes are made.
  for (const record of credentials.values()) record.password = '';

  const tx = db;
  tx.exec('BEGIN IMMEDIATE');
  try {
    const classStmt = tx.prepare('INSERT INTO classes VALUES(?,?,?,?,?,?)');
    classes.forEach(r => classStmt.run(r.classe_id,r.nom,r.niveau,r.filiere,r.langue_enseignement,asNumber(r.effectif)));
    const subjectStmt = tx.prepare('INSERT INTO subjects VALUES(?,?,?,?,?)');
    subjects.forEach(r => subjectStmt.run(r.code,r.matiere,asNumber(r.heures_par_classe_par_semaine),r.couleur,r.salle_habituelle));
    const studentStmt = tx.prepare(`INSERT INTO students(student_id,massar_id,last_name,first_name,full_name,class_id,class_number,birth_date,school_email,status,parent_id,parent_name,parent_phone,parent_email,photo_path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    students.forEach(r => studentStmt.run(r.student_id,r.masar_id,r.nom,r.prenom,r.nom_complet,r.classe_id,asNumber(r.numero_classe),r.date_naissance,r.email_scolaire,r.statut,r.parent_id,r.parent_nom,r.parent_telephone,r.parent_email,r.photo_path));
    const teacherStmt = tx.prepare('INSERT INTO teachers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    teachers.forEach(r => teacherStmt.run(r.teacher_id,r.login_id,r.nom,r.prenom,r.nom_complet,r.matiere_code,r.matiere,r.shift,r.email,r.telephone,r.statut,asNumber(r.max_heures_par_jour),asNumber(r.max_shift_par_jour)));
    const parentStmt = tx.prepare(`INSERT INTO parents(parent_id,login_id,last_name,first_name,full_name,student_id,child_massar_id,child_name,class_id,class_number,email,phone,registration_status,submitted_at,approved_at,account_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    parents.forEach(r => parentStmt.run(r.parent_id,r.login_id,r.nom,r.prenom,r.nom_complet,r.student_id,r.masar_id_enfant,r.nom_enfant,r.classe_id,asNumber(r.numero_classe),r.email,r.telephone,r.statut_inscription,r.date_demande,r.date_approbation,r.statut_inscription === 'APPROUVEE' ? 'ACTIVE' : 'PENDING'));
    const assignmentStmt = tx.prepare('INSERT INTO teacher_assignments VALUES(?,?,?,?,?,?)');
    assignments.forEach(r => assignmentStmt.run(r.teacher_id,r.matiere,r.shift,r.classes_assignees,asNumber(r.heures_semaine),asNumber(r.max_heures_par_jour)));
    const workStmt = tx.prepare('INSERT INTO teacher_work_schedule VALUES(?,?,?,?,?,?,?)');
    workSchedule.forEach(r => workStmt.run(r.teacher_id,r.jour,r.shift,r.debut_shift,r.fin_shift,asNumber(r.heures_cours),r.statut_jour));
    const lessonStmt = tx.prepare('INSERT INTO lessons VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    timetable.forEach(r => lessonStmt.run(r.lesson_id,r.jour,asNumber(r.jour_index),r.shift,r.creneau_code,r.debut,r.fin,r.classe_id,r.matiere_code,r.matiere,r.teacher_id,r.enseignant,r.salle,r.couleur));
    const attendanceStmt = tx.prepare(`INSERT INTO attendance(attendance_id,lesson_id,lesson_date,day,slot_code,class_id,student_id,massar_id,student_name,teacher_id,teacher_name,subject_name,status,access_status,recorded_at,provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    attendance.forEach(r => {
      const status = r.statut_presence === 'PRESENT' || r.statut_presence === 'ABSENT' ? r.statut_presence : 'NOT_RECORDED';
      attendanceStmt.run(r.attendance_id,r.lesson_id,r.date,r.jour,r.creneau_code,r.classe_id,r.student_id,r.masar_id,r.eleve,r.teacher_id,r.enseignant,r.matiere,status,r.statut_acces,r.saisi_le,r.origine_donnee || 'INITIAL_GENERATED_UNVERIFIED');
    });
    const explainStmt = tx.prepare('INSERT INTO absence_explanations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    explanations.forEach(r => explainStmt.run(r.explanation_id,r.student_id,r.masar_id,r.eleve,r.classe_id,r.lesson_id,r.date_absence,r.motif_parent,r.statut,r.decision_direction,r.decide_par,r.decide_le,r.note_interne));
    const decisionStmt = tx.prepare('INSERT INTO entry_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    entryDecisions.forEach(r => decisionStmt.run(r.decision_id,r.student_id,r.masar_id,r.eleve,r.classe_id,r.absence_source_lesson_id,r.statut,r.lesson_autorisee_id,r.decision_direction,r.date_decision,r.motif_direction));
    const correctionStmt = tx.prepare('INSERT INTO attendance_corrections VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    corrections.forEach(r => correctionStmt.run(r.correction_id,r.attendance_id,r.lesson_id,r.student_id,r.masar_id,r.eleve,r.statut_original,r.statut_corrige,r.motif,r.acteur,r.date_correction,r.note));
    const absenceStmt = tx.prepare('INSERT INTO teacher_absences VALUES(?,?,?,?,?,?,?,?)');
    teacherAbsences.forEach(r => absenceStmt.run(r.absence_id,r.teacher_id,r.enseignant,r.date,r.type,r.motif,r.remplacement,r.statut));
    const notificationStmt = tx.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)');
    notifications.forEach(r => notificationStmt.run(r.notification_id,r.role,r.user_id,r.title,r.message,r.created_at,String(r.read)));
    const settingStmt = tx.prepare('INSERT INTO school_settings VALUES(?,?)');
    settingStmt.run('school_name','Établissement Abdlkrim El Khatabi');
    settingStmt.run('school_year','2026–2027');
    settingStmt.run('timezone','Africa/Casablanca');

    const userStmt = tx.prepare(`INSERT INTO users(user_id,login_id,role,full_name,password_hash,status,student_id,teacher_id) VALUES(?,?,?,?,?,'ACTIVE',?,?)`);
    const directionCredential = credentials.get('DIR-001');
    if (!directionCredential) throw new Error('Le compte Direction initial manque dans le fichier privé.');
    userStmt.run('USR-DIR-001','DIR-001','DIRECTION','Direction',passwordHash.get('DIR-001'),null,null);
    for (const teacher of teachers) {
      if (!passwordHash.has(teacher.login_id)) throw new Error('Un enseignant ne possède pas de mot de passe initial.');
      userStmt.run(`USR-${teacher.teacher_id}`,teacher.login_id,'TEACHER',teacher.nom_complet,passwordHash.get(teacher.login_id),null,teacher.teacher_id);
    }
    const activeParents = parents.filter(p => p.statut_inscription === 'APPROUVEE');
    for (const parent of activeParents) {
      if (!passwordHash.has(parent.login_id)) throw new Error('Un parent approuvé ne possède pas de mot de passe initial.');
      userStmt.run(`USR-${parent.parent_id}`,parent.login_id,'PARENT',parent.nom_complet,passwordHash.get(parent.login_id),parent.student_id,null);
    }

    const requestStmt = tx.prepare(`INSERT INTO parent_registration_requests(request_id,parent_id,parent_name,child_name,class_id,class_number,massar_id,email,phone,submitted_at,status,decision_by,decision_at,rejection_reason,password_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const request of initialRequests) {
      const parent = parentById.get(request.parent_id);
      const credHash = passwordHash.get(parent.login_id);
      if (!credHash) throw new Error('Une demande parentale initiale ne possède pas de mot de passe à hacher.');
      requestStmt.run(request.request_id,parent.parent_id,request.parent_name,request.child_name,request.class_id,Number(request.class_number),request.masar_id,request.email || parent.email,request.phone || parent.telephone,request.submitted_at,request.status,request.decision_by || null,request.decision_at || null,null,credHash);
    }

    tx.prepare("INSERT INTO seed_meta(key,value) VALUES('initial_seed_v1',?)").run(new Date().toISOString());
    tx.exec('COMMIT');
  } catch (error) {
    tx.exec('ROLLBACK');
    throw error;
  }
  return { seeded: true, auxiliarySeeded: seedAuxiliaryData() };
}

const seedResult = process.env.SMART_CLASS_SKIP_SEED==='1' ? { seeded:false, auxiliarySeeded:false, skipped:true } : insertSeedData();
function applyParentTeacherRedesignMigrations() {
  if (!db.prepare("SELECT value FROM seed_meta WHERE key='initial_seed_v1'").get()) return;
  const columns = new Set(db.prepare('PRAGMA table_info(lessons)').all().map(row => row.name));
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
    if (version < 3) {
      if (!columns.has('is_active')) db.exec('ALTER TABLE lessons ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
      const schedule = readCsv('weekly_timetable_rebalanced.csv');
      if (schedule.length !== 150) throw new Error('La grille réorganisée doit contenir exactement 150 cours.');
      const duplicateKeys = new Set(), teacherTimes = new Set(), subjectCounts = new Map(), teacherStats = new Map();
      for (const row of schedule) {
        const key = row.class_id+'|'+row.day+'|'+row.slot_code;
        const teacherKey = row.teacher_id+'|'+row.day+'|'+row.slot_code;
        if (duplicateKeys.has(key)) throw new Error('Conflit de classe dans la nouvelle grille: '+key);
        if (teacherTimes.has(teacherKey)) throw new Error('Conflit enseignant dans la nouvelle grille: '+teacherKey);
        duplicateKeys.add(key); teacherTimes.add(teacherKey);
        subjectCounts.set(row.subject_code,(subjectCounts.get(row.subject_code)||0)+1);
        const stats=teacherStats.get(row.teacher_id)||{total:0,morning:0,afternoon:0,days:new Map()};
        stats.total++;stats[row.shift==='Matin'?'morning':'afternoon']++;stats.days.set(row.day,(stats.days.get(row.day)||0)+1);teacherStats.set(row.teacher_id,stats);
      }
      if ([...teacherStats.values()].some(s=>s.total<8||s.total>16||s.morning<2||s.afternoon<2||[...s.days.values()].some(n=>n>3)))
        throw new Error('La grille ne respecte pas les limites de charge des enseignants.');
      db.exec('UPDATE lessons SET is_active=0');
      const insertLesson=db.prepare('INSERT INTO lessons(lesson_id,day,day_index,shift,slot_code,start_time,end_time,class_id,subject_code,subject_name,teacher_id,teacher_name,room,color,is_active) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,1');
      for (const row of schedule) {
        const subject=db.prepare('SELECT name,color,usual_room FROM subjects WHERE code=?').get(row.subject_code);
        const teacher=db.prepare('SELECT full_name FROM teachers WHERE teacher_id=?').get(row.teacher_id);
        if(!subject||!teacher)throw new Error('La grille référence une matière ou un enseignant absent.');
        insertLesson.run('W26-'+row.class_id+'-'+row.day_index+'-'+row.slot_code,row.day,Number(row.day_index),row.shift,row.slot_code,row.start_time,row.end_time,row.class_id,row.subject_code,subject.name,row.teacher_id,teacher.full_name,subject.usual_room,subject.color);
      }
      const activeIds=[...teacherStats.keys()];
      const placeholders=activeIds.map(()=>'?').join(',');
      db.prepare("UPDATE teachers SET status=CASE WHEN teacher_id IN ("+placeholders+") THEN 'Actif' ELSE 'Inactif' END,shift=CASE WHEN teacher_id IN ("+placeholders+") THEN 'Mixte' ELSE shift END").run(...activeIds,...activeIds);
      for(const teacher of db.prepare('SELECT teacher_id FROM teachers').all()) {
        db.prepare('UPDATE teacher_assignments SET assigned_classes=?,weekly_hours=0 WHERE teacher_id=?').run('',teacher.teacher_id);
        db.prepare('UPDATE teacher_workload_summary SET weekly_hours=0 WHERE teacher_id=?').run(teacher.teacher_id);
      }
      for(const [teacherId,stats] of teacherStats) {
        const classes=[...new Set(schedule.filter(r=>r.teacher_id===teacherId).map(r=>r.class_id))].sort();
        const name=db.prepare('SELECT subject_name,full_name FROM teachers WHERE teacher_id=?').get(teacherId);
        db.prepare("UPDATE teacher_assignments SET subject_name=?,shift='Mixte',assigned_classes=?,weekly_hours=? WHERE teacher_id=?").run(name.subject_name,classes.join('; '),stats.total,teacherId);
        db.prepare("UPDATE teacher_workload_summary SET subject_name=?,teacher_name=?,shift='Mixte',weekly_hours=? WHERE teacher_id=?").run(name.subject_name,name.full_name,stats.total,teacherId);
      }
      for(const [code,hours] of subjectCounts)db.prepare('UPDATE subjects SET weekly_hours=? WHERE code=?').run(hours/5,code);
      for(const klass of db.prepare('SELECT class_id FROM classes').all())for(const day of ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']){
        const rows=schedule.filter(r=>r.class_id===klass.class_id&&r.day===day), morning=rows.some(r=>r.shift==='Matin'),afternoon=rows.some(r=>r.shift==='Après-midi');
        const shift=morning&&afternoon?'Mixte':afternoon?'Après-midi':'Matin';
        db.prepare('UPDATE class_weekly_shifts SET shift=?,shift_start=?,shift_end=?,lesson_hours=? WHERE class_id=? AND day=?').run(shift,morning?'08:00':'14:00',afternoon?'18:00':'12:00',rows.length,klass.class_id,day);
      }
      for(const teacher of db.prepare('SELECT teacher_id FROM teachers').all())for(const day of ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']){
        const rows=schedule.filter(r=>r.teacher_id===teacher.teacher_id&&r.day===day),morning=rows.some(r=>r.shift==='Matin'),afternoon=rows.some(r=>r.shift==='Après-midi');
        const shift=morning&&afternoon?'Mixte':afternoon?'Après-midi':morning?'Matin':'Repos';
        const start=morning?'08:00':afternoon?'14:00':'';
        const end=rows.length?rows.reduce((max,r)=>r.end_time>max?r.end_time:max,''):'';
        db.prepare('UPDATE teacher_work_schedule SET shift=?,shift_start=?,shift_end=?,lesson_hours=?,day_status=? WHERE teacher_id=? AND day=?').run(shift,start,end,rows.length,rows.length?'Actif':'Repos',teacher.teacher_id,day);
      }
      db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(3,'active_balanced_30_hour_timetable',?)").run(new Date().toISOString());
    }
    const currentVersion=db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
    if(currentVersion<4){
      const users=db.prepare('SELECT user_id FROM users').all(), update=db.prepare('UPDATE users SET password_hash=? WHERE user_id=?'), now=new Date().toISOString();
      for(const user of users){update.run(bcrypt.hashSync('12345678',12),user.user_id);db.prepare("INSERT INTO audit_log(event_id,actor_user_id,action,entity_type,entity_id,created_at) VALUES(?,NULL,'LOCAL_TEMP_PASSWORD_ROTATED','user',?,?)").run(crypto.randomUUID(),user.user_id,now);}
      db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(4,'shared_local_temporary_password',?)").run(now);
    }
    const finalVersion=db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
    if(finalVersion<5){
      db.exec(`CREATE TABLE attendance_authorizations (
        attendance_id TEXT PRIMARY KEY REFERENCES attendance(attendance_id),
        decision_id TEXT REFERENCES entry_decisions(decision_id),
        explanation_id TEXT REFERENCES absence_explanations(explanation_id),
        approved_by TEXT REFERENCES users(user_id), approved_at TEXT NOT NULL,
        CHECK ((decision_id IS NOT NULL AND explanation_id IS NULL) OR (decision_id IS NULL AND explanation_id IS NOT NULL))
      ); CREATE INDEX idx_attendance_authorizations_decision ON attendance_authorizations(decision_id);
      CREATE INDEX idx_attendance_authorizations_explanation ON attendance_authorizations(explanation_id);`);
      db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(5,'attendance_authorization_references',?)").run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
applyParentTeacherRedesignMigrations();

function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretPath = path.join(path.dirname(DB_PATH), 'session-secret');
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 });
  return fs.readFileSync(secretPath, 'utf8').trim();
}

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super(); this.db = database;
    this.getStmt = database.prepare('SELECT data,expires_at FROM sessions WHERE sid=?');
    this.setStmt = database.prepare('INSERT INTO sessions(sid,expires_at,data) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at,data=excluded.data');
    this.delStmt = database.prepare('DELETE FROM sessions WHERE sid=?');
    this.touchStmt = database.prepare('UPDATE sessions SET expires_at=? WHERE sid=?');
  }
  get(sid, callback) {
    try { const row=this.getStmt.get(sid); if(!row || row.expires_at <= Date.now()){ if(row) this.delStmt.run(sid); return callback(null,null); } callback(null,JSON.parse(row.data)); }
    catch (error) { callback(error); }
  }
  set(sid, sess, callback = () => {}) {
    try { const expires=sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now()+SESSION_TTL_MS; this.setStmt.run(sid,expires,JSON.stringify(sess)); callback(null); }
    catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) { try { this.delStmt.run(sid); callback(null); } catch (error) { callback(error); } }
  touch(sid, sess, callback = () => {}) { try { const expires=sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now()+SESSION_TTL_MS; this.touchStmt.run(expires,sid); callback(null); } catch (error) { callback(error); } }
}

const app = express();
app.disable('x-powered-by');
app.use((req,res,next) => {
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
    const expected = `${req.protocol}://${req.get('host')}`;
    if (req.headers.origin !== expected) return res.status(403).json({ error: 'Origine de requête refusée.' });
  }
  next();
});
app.use(express.json({ limit: '4mb', strict: true }));
app.use(session({
  name: 'smartclass.sid', secret: loadSessionSecret(), store: new SQLiteSessionStore(db),
  resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: SESSION_TTL_MS, path: '/' }
}));
app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use((req,res,next)=>{
  const pages={'/admin.html':'DIRECTION','/parent.html':'PARENT','/enseignant.html':'TEACHER'};
  if(req.path==='/index.html')return res.redirect(req.session.user?({DIRECTION:'/admin',PARENT:'/parent',TEACHER:'/teacher'}[req.session.user.role]||'/'):'/');
  const pageRole=pages[req.path];
  if(!pageRole)return next();
  if(!req.session.user)return res.redirect('/');
  const destination={DIRECTION:'/admin',PARENT:'/parent',TEACHER:'/teacher'}[req.session.user.role]||'/';
  return res.redirect(destination);
});
app.use(express.static(path.join(ROOT,'public'), { index: false, fallthrough: true, dotfiles: 'deny' }));

const loginAttempts = new Map();
function rateLimited(req) {
  const now=Date.now(), key=req.ip;
  const old=loginAttempts.get(key) || { count:0, until:now+10*60*1000 };
  if(old.until <= now){ old.count=0; old.until=now+10*60*1000; }
  old.count++; loginAttempts.set(key,old);
  return old.count > 15;
}
function requireRole(role) {
  return (req,res,next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Veuillez vous connecter.' });
    if (role && req.session.user.role !== role) return res.status(403).json({ error: 'Accès non autorisé.' });
    next();
  };
}
function audit(actor, action, entityType, entityId) {
  db.prepare('INSERT INTO audit_log(event_id,actor_user_id,action,entity_type,entity_id) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),actor,action,entityType,entityId || null);
}

app.get('/api/health', (req,res) => res.json({ status: 'ok', local: true }));
app.get('/api/me', (req,res) => {
  if (!req.session.user) return res.json({ authenticated: false });
  const user=req.session.user;
  return res.json({ authenticated: true, user: { role:user.role, fullName:user.fullName, loginId:user.loginId } });
});
app.post('/api/login', (req,res) => {
  if (rateLimited(req)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  const login=normalizeLogin(req.body && req.body.login_id);
  const password=String(req.body && req.body.password || '');
  if (!login || !password || password.length > 200) return res.status(400).json({ error: 'Identifiant ou mot de passe incorrect.' });
  const user=db.prepare("SELECT user_id,login_id,role,full_name,password_hash,status FROM users WHERE login_id=? AND status='ACTIVE'").get(login);
  const valid=user ? bcrypt.compareSync(password,user.password_hash) : bcrypt.compareSync(password,bcrypt.hashSync('invalid-login-placeholder',10));
  if (!user || !valid) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Connexion impossible pour le moment.' });
    req.session.user={ id:user.user_id, role:user.role, fullName:user.full_name, loginId:user.login_id };
    audit(user.user_id,'LOGIN','user',user.user_id);
    req.session.save(saveError => {
      if (saveError) return res.status(500).json({ error: 'Connexion impossible pour le moment.' });
    res.json({ authenticated:true, user:{ role:user.role, fullName:user.full_name, loginId:user.login_id } });
    });
  });
});
app.post('/api/logout', (req,res) => {
  const user=req.session.user;
  if (!user) return res.json({ ok:true });
  audit(user.id,'LOGOUT','user',user.id);
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: 'Déconnexion impossible pour le moment.' });
    res.clearCookie('smartclass.sid',{ httpOnly:true,sameSite:'lax',path:'/' });
    res.json({ ok:true });
  });
});

app.post('/api/register/parent', async (req,res) => {
  const generic={ message:'Votre demande a été prise en compte. Si les informations correspondent aux critères de l’établissement, la Direction pourra la valider. Vous pourrez vous connecter après approbation.' };
  const b=req.body || {};
  const parentName=String(b.parent_name||'').trim(), childName=String(b.child_name||'').trim(), massar=String(b.massar_id||'').trim();
  const classId=String(b.class_id||'').trim(), number=Number(b.class_number), email=String(b.email||'').trim(), phone=String(b.phone||'').trim();
  const password=String(b.password||''), confirmation=String(b.password_confirmation||'');
  if (!b.confirmed || parentName.length<3 || parentName.length>120 || childName.length<3 || childName.length>120 || !/^[A-Z0-9-]{5,24}$/i.test(massar) || !/^[A-Z0-9_-]{2,20}$/i.test(classId) || !Number.isInteger(number) || number<1 || number>60 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length<6 || phone.length>30 || password.length<10 || password.length>200 || password!==confirmation) return res.status(202).json(generic);
  const student=db.prepare('SELECT * FROM students WHERE massar_id=? AND class_id=? AND class_number=?').get(massar,classId,number);
  if (!student || student.full_name.trim().toLocaleLowerCase('fr')!==childName.toLocaleLowerCase('fr')) return res.status(202).json(generic);
  const linked=db.prepare("SELECT 1 FROM parents WHERE student_id=? AND registration_status IN ('APPROUVEE','EN_ATTENTE') LIMIT 1").get(student.student_id);
  const pending=db.prepare("SELECT 1 FROM parent_registration_requests WHERE massar_id=? AND status='EN_ATTENTE' LIMIT 1").get(massar);
  if (linked || pending) return res.status(202).json(generic);
  const passwordHash=await bcrypt.hash(password,12);
  const now=new Date().toISOString(), parentId=`PAR-${crypto.randomUUID()}`, requestId=`INS-${crypto.randomUUID()}`;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO parents(parent_id,login_id,last_name,first_name,full_name,student_id,child_massar_id,child_name,class_id,class_number,email,phone,registration_status,submitted_at,account_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,? ,?,'PENDING')`).run(parentId,massar,'', '',parentName,student.student_id,massar,student.full_name,classId,number,email,phone,'EN_ATTENTE',now);
    db.prepare(`INSERT INTO parent_registration_requests(request_id,parent_id,parent_name,child_name,class_id,class_number,massar_id,email,phone,submitted_at,status,password_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(requestId,parentId,parentName,student.full_name,classId,number,massar,email,phone,now,'EN_ATTENTE',passwordHash);
    audit(null,'PARENT_REGISTRATION_SUBMITTED','parent_registration_request',requestId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); return res.status(202).json(generic); }
  res.status(202).json(generic);
});

app.get('/api/direction/summary',requireRole('DIRECTION'),(req,res) => {
  res.json({ students:db.prepare('SELECT COUNT(*) AS n FROM students').get().n, teachers:db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n,
    parents:db.prepare('SELECT COUNT(*) AS n FROM parents').get().n, activeParentAccounts:db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='PARENT'").get().n,
    pendingParentRequests:db.prepare("SELECT COUNT(*) AS n FROM parent_registration_requests WHERE status='EN_ATTENTE'").get().n });
});
app.get('/api/teacher/profile',requireRole('TEACHER'),(req,res) => {
  const profile=db.prepare('SELECT t.teacher_id,t.full_name,t.subject_name,t.shift,t.email,t.phone,u.login_id FROM teachers t JOIN users u ON u.teacher_id=t.teacher_id WHERE u.user_id=?').get(req.session.user.id);
  if (!profile) return res.status(404).json({error:'Profil introuvable.'});
  res.json({ teacher:profile });
});
app.get('/api/parent/child',requireRole('PARENT'),(req,res) => {
  const child=db.prepare('SELECT s.student_id,s.massar_id,s.full_name,s.class_id,s.class_number,s.birth_date FROM students s JOIN users u ON u.student_id=s.student_id WHERE u.user_id=?').get(req.session.user.id);
  if (!child) return res.status(404).json({error:'Élève lié introuvable.'});
  res.json({ child });
});
app.get('/api/parent/attendance',requireRole('PARENT'),(req,res) => {
  const child=db.prepare('SELECT s.student_id,s.massar_id,s.full_name,s.class_id,s.class_number,u.full_name AS parent_name FROM students s JOIN users u ON u.student_id=s.student_id WHERE u.user_id=?').get(req.session.user.id);
  if(!child)return res.status(404).json({error:'Élève lié introuvable.'});
  const attendance=db.prepare(`SELECT a.attendance_id,a.lesson_id,a.lesson_date,a.day,a.slot_code,a.student_id,a.student_name,a.subject_name,a.teacher_name,a.status,
      l.class_id,l.start_time,l.end_time,
      COALESCE((SELECT c.corrected_status FROM attendance_corrections c WHERE c.attendance_id=a.attendance_id ORDER BY c.corrected_at DESC,c.rowid DESC LIMIT 1),a.status) AS effective_status,
      e.explanation_id,e.status AS explanation_status,e.reason AS explanation_reason,
      (SELECT d.status FROM entry_decisions d WHERE d.absence_attendance_id=a.attendance_id ORDER BY d.decided_at DESC LIMIT 1) AS return_status,
      (SELECT d.authorized_lesson_date FROM entry_decisions d WHERE d.absence_attendance_id=a.attendance_id ORDER BY d.decided_at DESC LIMIT 1) AS authorized_lesson_date
    FROM attendance a JOIN lessons l ON l.lesson_id=a.lesson_id LEFT JOIN absence_explanations e ON e.attendance_id=a.attendance_id
    WHERE a.student_id=? ORDER BY a.lesson_date DESC,l.start_time DESC`).all(child.student_id).map(row=>({...row,duration_hours:lessonDurationHours(row.start_time,row.end_time)}));
  let weekStart=String(req.query.week_start||'');
  if(!weekStart){const today=new Date(`${todayInSchoolTimezone()}T00:00:00Z`);today.setUTCDate(today.getUTCDate()-((today.getUTCDay()+6)%7));weekStart=today.toISOString().slice(0,10);}
  if(!validIsoDate(weekStart)||new Date(`${weekStart}T00:00:00Z`).getUTCDay()!==1)return res.status(400).json({error:'Choisissez le lundi de la semaine à consulter.'});
  const weekEnd=new Date(`${weekStart}T00:00:00Z`);weekEnd.setUTCDate(weekEnd.getUTCDate()+6);
  const weekEndDate=weekEnd.toISOString().slice(0,10);
  const timetable=db.prepare(`SELECT DISTINCT l.lesson_id,l.day,l.day_index,l.slot_code,l.start_time,l.end_time,l.class_id,l.subject_name,l.teacher_name,l.room,l.color
    FROM attendance a JOIN lessons l ON l.lesson_id=a.lesson_id
    WHERE a.student_id=? AND a.lesson_date>=? AND a.lesson_date<=?
    ORDER BY l.day_index,l.start_time`).all(child.student_id,weekStart,weekEndDate);
  if(!timetable.length) timetable.push(...db.prepare(`SELECT lesson_id,day,day_index,slot_code,start_time,end_time,class_id,subject_name,teacher_name,room,color
    FROM lessons WHERE class_id=? AND is_active=1 ORDER BY day_index,start_time`).all(child.class_id));
  const weekAttendance=attendance.filter(row=>row.lesson_date>=weekStart&&row.lesson_date<=weekEndDate);
  const schoolYear=db.prepare("SELECT setting_value FROM school_settings WHERE setting_key='school_year'").get()?.setting_value||'';
  const schoolYears=/^(20\d{2}).*?(20\d{2})$/.exec(schoolYear);
  const yearStart=schoolYears?`${schoolYears[1]}-09-01`:'';
  const yearEnd=schoolYears?`${schoolYears[2]}-08-31`:'';
  const absences=attendance.filter(row=>row.effective_status==='ABSENT'&&(!yearStart||(row.lesson_date>=yearStart&&row.lesson_date<=yearEnd)));
  const absenceHours=absences.reduce((total,row)=>total+row.duration_hours,0);
  const documents=db.prepare(`SELECT d.doc_id,d.explanation_id,d.original_filename,d.content_type,d.size_bytes,d.uploaded_at
    FROM absence_explanation_documents d JOIN absence_explanations e ON e.explanation_id=d.explanation_id
    WHERE e.student_id=? ORDER BY d.uploaded_at DESC`).all(child.student_id);
  res.json({child,timetable,attendance,week_attendance:weekAttendance,week_start:weekStart,week_end:weekEndDate,absences,explainable_absences:attendance.filter(row=>row.effective_status==='ABSENT'&&!row.explanation_id),absence_hours:absenceHours,school_year:schoolYear,documents});
});
app.post('/api/parent/attendance/:attendanceId/explanations',requireRole('PARENT'),async (req,res) => {
  const attendanceId=String(req.params.attendanceId||'');
  const reason=String(req.body?.reason||'').trim();
  if(!validRecordId(attendanceId)||reason.length<5||reason.length>1000)return res.status(400).json({error:'Choisissez une absence valide et saisissez une explication de 5 à 1 000 caractères.'});
  let document;
  try{document=decodeAbsenceDocument(req.body?.document);}catch(error){return res.status(400).json({error:error.message});}
  const child=db.prepare('SELECT s.student_id FROM students s JOIN users u ON u.student_id=s.student_id WHERE u.user_id=?').get(req.session.user.id);
  if(!child)return res.status(404).json({error:'Élève lié introuvable.'});
  const attendance=db.prepare('SELECT * FROM attendance WHERE attendance_id=? AND student_id=?').get(attendanceId,child.student_id);
  if(!attendance)return res.status(404).json({error:'Cette absence ne correspond pas à votre enfant.'});
  if(effectiveAttendance(attendanceId)!=='ABSENT')return res.status(409).json({error:'Seule une absence encore confirmée peut être justifiée.'});
  if(db.prepare('SELECT 1 FROM absence_explanations WHERE attendance_id=?').get(attendanceId))return res.status(409).json({error:'Une explication existe déjà pour cette absence.'});
  const explanationId=`JUST-${crypto.randomUUID()}`,now=new Date().toISOString(),docId=document?`DOC-${crypto.randomUUID()}`:null,storageKey=document?`${crypto.randomUUID()}.${document.contentType==='application/pdf'?'pdf':document.contentType==='image/png'?'png':'jpg'}`:null;
  let filePath=null,inTransaction=false;
  try {
    db.exec('BEGIN IMMEDIATE');inTransaction=true;
    if(effectiveAttendance(attendanceId)!=='ABSENT'||db.prepare('SELECT 1 FROM absence_explanations WHERE attendance_id=?').get(attendanceId)){db.exec('ROLLBACK');inTransaction=false;return res.status(409).json({error:'Une explication existe déjà ou cette absence a été corrigée.'});}
    if(document){await fs.promises.mkdir(ABSENCE_DOCUMENT_DIR,{recursive:true});filePath=path.join(ABSENCE_DOCUMENT_DIR,storageKey);await fs.promises.writeFile(filePath,document.bytes,{flag:'wx',mode:0o600});}
    db.prepare(`INSERT INTO absence_explanations(explanation_id,student_id,massar_id,student_name,class_id,lesson_id,absence_date,reason,status,direction_decision,decided_by,decided_at,internal_note,attendance_id,submitted_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,'EN_ATTENTE','En attente','','','',?,?,?)`).run(explanationId,attendance.student_id,attendance.massar_id,attendance.student_name,attendance.class_id,attendance.lesson_id,attendance.lesson_date,reason,attendanceId,req.session.user.id,now);
    if(document)db.prepare('INSERT INTO absence_explanation_documents(doc_id,explanation_id,original_filename,content_type,storage_key,size_bytes,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?)').run(docId,explanationId,document.filename,document.contentType,storageKey,document.bytes.length,req.session.user.id,now);
    db.prepare('INSERT INTO absence_explanation_decisions(decision_id,explanation_id,action,reason,decided_by,decided_at,source) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),explanationId,'SOUMISE','Explication transmise par le parent.',req.session.user.id,now,'LIVE');
    audit(req.session.user.id,'ABSENCE_EXPLANATION_SUBMITTED','absence_explanation',explanationId);
    db.exec('COMMIT');inTransaction=false;
  } catch(error) {if(inTransaction)db.exec('ROLLBACK');if(filePath)await fs.promises.unlink(filePath).catch(()=>{});return res.status(500).json({error:'L’explication ou son document n’a pas pu être enregistré.'});}
  res.status(201).json({ok:true,explanation_id:explanationId,message:document?'Votre explication et son document ont été envoyés à la Direction.':'Votre explication a été envoyée à la Direction.'});
});
app.get('/api/absence-explanation-documents/:documentId',(req,res) => {
  if(!req.session.user)return res.status(401).json({error:'Veuillez vous connecter.'});
  if(!validRecordId(req.params.documentId))return res.status(400).json({error:'Document invalide.'});
  const document=db.prepare(`SELECT d.doc_id,d.original_filename,d.content_type,d.storage_key,e.student_id
    FROM absence_explanation_documents d JOIN absence_explanations e ON e.explanation_id=d.explanation_id WHERE d.doc_id=?`).get(req.params.documentId);
  if(!document)return res.status(404).json({error:'Document introuvable.'});
  if(req.session.user.role==='PARENT'&&db.prepare('SELECT 1 FROM users WHERE user_id=? AND student_id=?').get(req.session.user.id,document.student_id)===undefined)return res.status(403).json({error:'Vous ne pouvez pas consulter le document d’un autre enfant.'});
  if(!['DIRECTION','PARENT'].includes(req.session.user.role))return res.status(403).json({error:'Accès non autorisé.'});
  const safePath=path.resolve(ABSENCE_DOCUMENT_DIR,document.storage_key),root=path.resolve(ABSENCE_DOCUMENT_DIR)+path.sep;
  if(!safePath.startsWith(root))return res.status(404).json({error:'Document introuvable.'});
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type',document.content_type);
  res.download(safePath,document.original_filename,error=>{if(error&&!res.headersSent)res.status(404).json({error:'Fichier joint introuvable sur cet appareil.'});});
});

app.get('/api/teacher/timetable',requireRole('TEACHER'),(req,res) => {
  const teacher=db.prepare("SELECT teacher_id FROM users WHERE user_id=? AND role='TEACHER'").get(req.session.user.id);
  if(!teacher)return res.status(403).json({error:'Compte enseignant invalide.'});
  const lessons=db.prepare(`SELECT l.lesson_id,l.day,l.day_index,l.shift,l.slot_code,l.start_time,l.end_time,l.class_id,l.subject_name,l.teacher_name,l.room,l.color
    FROM lessons l WHERE l.teacher_id=? AND l.is_active=1 ORDER BY l.day_index,l.start_time`).all(teacher.teacher_id);
  res.json({lessons});
});
app.get('/api/teacher/lessons',requireRole('TEACHER'),(req,res)=>{
  const date=String(req.query.date||'');if(!validIsoDate(date))return res.status(400).json({error:'Date invalide.'});
  const teacher=db.prepare("SELECT teacher_id FROM users WHERE user_id=? AND role='TEACHER'").get(req.session.user.id);if(!teacher)return res.status(403).json({error:'Compte enseignant invalide.'});
  const day=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][new Date(date+'T00:00:00Z').getUTCDay()];
  res.json({lessons:db.prepare('SELECT lesson_id,day,slot_code,start_time,end_time,class_id,subject_name,teacher_id FROM lessons WHERE teacher_id=? AND is_active=1 AND day=? ORDER BY start_time').all(teacher.teacher_id,day)});
});
app.get('/api/teacher/active-lesson',requireRole('TEACHER'),(req,res) => {
  const teacher=db.prepare("SELECT teacher_id FROM users WHERE user_id=? AND role='TEACHER'").get(req.session.user.id);
  if(!teacher)return res.status(403).json({error:'Compte enseignant invalide.'});
  const clock=currentSchoolClock();
  const todays=db.prepare('SELECT l.lesson_id,l.day,l.day_index,l.shift,l.slot_code,l.start_time,l.end_time,l.class_id,l.subject_name,l.teacher_name,l.room,l.color FROM lessons l WHERE l.teacher_id=? AND l.is_active=1 AND l.day=? ORDER BY l.start_time').all(teacher.teacher_id,clock.day);
  const minute=clock.hour*60+clock.minute;
  const lesson=findActiveLesson(todays,clock);
  const next=todays.find(l=>timeToMinutes(l.start_time)>minute)||null;
  const active=lesson?{...lesson,student_count:db.prepare('SELECT COUNT(*) n FROM students WHERE class_id=?').get(lesson.class_id).n,submitted:db.prepare('SELECT COUNT(*) n FROM attendance WHERE lesson_id=? AND lesson_date=?').get(lesson.lesson_id,clock.date).n}:null;
  const boundary=lesson?timeToMinutes(lesson.end_time):next?timeToMinutes(next.start_time):null;
  const refreshAfterMs=boundary===null?60000:Math.max(250,(boundary-minute)*60000-clock.second*1000);
  res.json({date:clock.date,day:clock.day,time:clock.time,lesson:active,next_lesson:next,refresh_after_ms:refreshAfterMs});
});
app.get('/api/teacher/lessons/:lessonId/roster',requireRole('TEACHER'),(req,res) => {
  if(!validRecordId(req.params.lessonId))return res.status(400).json({error:'Cours invalide.'});
  const teacher=db.prepare("SELECT teacher_id FROM users WHERE user_id=? AND role='TEACHER'").get(req.session.user.id);
  const lesson=db.prepare('SELECT l.* FROM lessons l WHERE l.lesson_id=? AND l.teacher_id=? AND l.is_active=1').get(req.params.lessonId,teacher?.teacher_id);
  if(!lesson)return res.status(404).json({error:'Cours introuvable pour cet enseignant.'});
  const clock=currentSchoolClock(),minute=clock.hour*60+clock.minute;
  if(lesson.day!==clock.day||minute<timeToMinutes(lesson.start_time)||minute>=timeToMinutes(lesson.end_time))return res.status(409).json({error:'L’appel est disponible uniquement pendant le cours prévu à l’horaire actuel.'});
  const date=clock.date;
  const students=db.prepare(`SELECT s.student_id,s.full_name,s.massar_id,s.class_number,a.attendance_id,a.status,
      h.absence_attendance_id,source_absence.lesson_date AS absence_date,source_absence.lesson_id AS absence_lesson_id,source_absence.subject_name AS absence_subject,source_absence.slot_code AS absence_slot,al.start_time AS absence_start_time,
      e.status AS explanation_status,
      CASE WHEN d.status='AUTORISEE' AND d.authorized_lesson_id=? AND d.authorized_lesson_date=? THEN 1 ELSE 0 END AS authorized_here
    FROM students s LEFT JOIN attendance a ON a.student_id=s.student_id AND a.lesson_id=? AND a.lesson_date=?
    LEFT JOIN entry_holds h ON h.absence_attendance_id=(SELECT h2.absence_attendance_id FROM entry_holds h2 WHERE h2.student_id=s.student_id AND h2.status='ACTIVE' ORDER BY h2.created_at,h2.hold_id LIMIT 1)
    LEFT JOIN attendance source_absence ON source_absence.attendance_id=h.absence_attendance_id
    LEFT JOIN lessons al ON al.lesson_id=source_absence.lesson_id
    LEFT JOIN absence_explanations e ON e.attendance_id=h.absence_attendance_id
    LEFT JOIN entry_decisions d ON d.absence_attendance_id=h.absence_attendance_id
    WHERE s.class_id=? ORDER BY s.class_number`).all(lesson.lesson_id,date,lesson.lesson_id,date,lesson.class_id);
  res.json({lesson,date,students:students.map(s=>({...s,blocked:Boolean(s.absence_attendance_id)&&isLessonSubsequentToAbsence({absence_date:s.absence_date,absence_start_time:s.absence_start_time},lesson,date)&&!Boolean(s.authorized_here),status:s.status||'NOT_RECORDED'}))});
});
app.post('/api/teacher/lessons/:lessonId/attendance',requireRole('TEACHER'),(req,res) => {
  const studentId=String(req.body?.student_id||''),status=req.body?.status;
  if(!validRecordId(req.params.lessonId)||!validRecordId(studentId)||!['PRESENT','ABSENT'].includes(status))return res.status(400).json({error:'Choisissez Présent ou Absent pour un élève valide.'});
  const teacher=db.prepare("SELECT teacher_id FROM users WHERE user_id=? AND role='TEACHER'").get(req.session.user.id);
  const lesson=db.prepare('SELECT l.* FROM lessons l WHERE l.lesson_id=? AND l.teacher_id=? AND l.is_active=1').get(req.params.lessonId,teacher?.teacher_id);
  if(!lesson)return res.status(404).json({error:'Cours introuvable pour cet enseignant.'});
  const clock=currentSchoolClock(),minute=clock.hour*60+clock.minute,date=clock.date;
  if(lesson.day!==clock.day||minute<timeToMinutes(lesson.start_time)||minute>=timeToMinutes(lesson.end_time))return res.status(409).json({error:'L’appel est fermé en dehors de l’horaire réel du cours.'});
  const student=db.prepare('SELECT student_id,massar_id,full_name,class_id FROM students WHERE student_id=? AND class_id=?').get(studentId,lesson.class_id);
  if(!student)return res.status(404).json({error:'Cet élève ne fait pas partie de cette classe.'});
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=db.prepare('SELECT attendance_id,status FROM attendance WHERE lesson_id=? AND lesson_date=? AND student_id=?').get(lesson.lesson_id,date,studentId);
    if(existing){db.exec('ROLLBACK');if(existing.status===status)return res.json({ok:true,already_recorded:true,status,message:'Présence déjà enregistrée.'});return res.status(409).json({error:'Une présence est déjà enregistrée. Une correction par la Direction est nécessaire.'});}
    const hold=getActiveHold(studentId),blocked=isLessonSubsequentToAbsence(hold,lesson,date),authorized=blocked&&hold.decision_status==='AUTORISEE'&&hold.authorized_lesson_id===lesson.lesson_id&&hold.authorized_lesson_date===date;
    if(blocked&&!authorized){db.exec('ROLLBACK');return res.status(403).json({error:'Action bloquée : la Direction doit autoriser le retour après cette absence.'});}
    const now=new Date().toISOString();
    let authorization={decisionId:authorized?hold.decision_id:null,explanationId:null,approvedBy:authorized?hold.authorized_by:null,approvedAt:authorized?(hold.authorization_decided_at||now):null};
    if(status==='PRESENT'&&!authorized){
      const prior=db.prepare(`SELECT a.attendance_id,a.lesson_date,e.explanation_id,e.decided_by,e.decided_at,l.start_time FROM attendance a
        JOIN absence_explanations e ON e.attendance_id=a.attendance_id AND e.status='APPROUVEE'
        JOIN lessons l ON l.lesson_id=a.lesson_id WHERE a.student_id=? AND a.lesson_date<=? ORDER BY a.lesson_date DESC,l.start_time DESC`).all(studentId,date);
      const justified=prior.find(row=>(row.lesson_date<date||row.start_time<lesson.start_time)&&effectiveAttendance(row.attendance_id)==='ABSENT');
      if(justified){const approver=db.prepare('SELECT user_id FROM users WHERE user_id=?').get(justified.decided_by)?.user_id||null;authorization={decisionId:null,explanationId:justified.explanation_id,approvedBy:approver,approvedAt:justified.decided_at||now};}
    }
    const access=authorization.decisionId?'AUTORISE_POUR_CETTE_SEANCE':authorization.explanationId?'JUSTIFIEE_PAR_DIRECTION':'AUTORISE';
    const insert=db.prepare(`INSERT INTO attendance(attendance_id,lesson_id,lesson_date,day,slot_code,class_id,student_id,massar_id,student_name,teacher_id,teacher_name,subject_name,status,access_status,recorded_at,provenance)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SAISIE_LOCALE')`);
    insert.run('ATT-'+crypto.randomUUID(),lesson.lesson_id,date,lesson.day,lesson.slot_code,lesson.class_id,student.student_id,student.massar_id,student.full_name,lesson.teacher_id,lesson.teacher_name,lesson.subject_name,status,access,now);
    const attendance=db.prepare('SELECT * FROM attendance WHERE lesson_id=? AND lesson_date=? AND student_id=?').get(lesson.lesson_id,date,studentId);
    if(authorization.decisionId||authorization.explanationId)db.prepare('INSERT INTO attendance_authorizations(attendance_id,decision_id,explanation_id,approved_by,approved_at) VALUES(?,?,?,?,?)').run(attendance.attendance_id,authorization.decisionId,authorization.explanationId,authorization.approvedBy,authorization.approvedAt||now);
    if(status==='ABSENT')createHoldForAbsence(attendance,now);
    if(status==='PRESENT'&&authorized){
      closeHoldForAbsence(hold.absence_attendance_id,req.session.user.id,'Présence constatée au cours autorisé.',now);
      db.prepare(`INSERT INTO entry_decision_events(event_id,decision_id,action,reason,actor_user_id,authorized_lesson_id,authorized_lesson_date,created_at,source) VALUES(?,?,'RETOUR_EFFECTUE','Présence enregistrée au cours autorisé.',?,?,?,?, 'LIVE')`).run(crypto.randomUUID(),hold.decision_id,req.session.user.id,lesson.lesson_id,date,now);
      audit(req.session.user.id,'STUDENT_RETURN_RECORDED','entry_hold',hold.hold_id);
    }
    audit(req.session.user.id,'ATTENDANCE_SUBMITTED','attendance',attendance.attendance_id);
    db.exec('COMMIT');
    return res.status(201).json({ok:true,status,message:'Présence enregistrée.'});
  }catch(error){db.exec('ROLLBACK');return res.status(error.code==='SQLITE_CONSTRAINT_UNIQUE'?409:500).json({error:error.code==='SQLITE_CONSTRAINT_UNIQUE'?'Une présence existe déjà pour cet élève et ce cours.':'La présence n’a pas pu être enregistrée.'});}
});
app.get('/api/teacher/history',requireRole('TEACHER'),(req,res)=>{
  const teacher=db.prepare("SELECT teacher_id FROM users WHERE user_id=? AND role='TEACHER'").get(req.session.user.id);
  if(!teacher)return res.status(403).json({error:'Compte enseignant invalide.'});
  const rows=db.prepare(`SELECT attendance_id,lesson_date,day,slot_code,class_id,student_name,massar_id,subject_name,status,recorded_at FROM attendance WHERE teacher_id=? ORDER BY lesson_date DESC,recorded_at DESC LIMIT 300`).all(teacher.teacher_id);
  res.json({history:rows});
});

app.get('/api/direction/parent-requests',requireRole('DIRECTION'),(req,res) => {
  const rows=db.prepare("SELECT request_id,parent_id,parent_name,child_name,class_id,class_number,massar_id,email,phone,submitted_at,status,decision_by,decision_at,rejection_reason FROM parent_registration_requests ORDER BY CASE status WHEN 'EN_ATTENTE' THEN 0 ELSE 1 END,submitted_at").all();
  res.json({ requests:rows });
});
app.post('/api/direction/parent-requests/:requestId/decision',requireRole('DIRECTION'),(req,res) => {
  const { decision, reason }=req.body || {};
  const row=db.prepare("SELECT * FROM parent_registration_requests WHERE request_id=? AND status='EN_ATTENTE'").get(req.params.requestId);
  if (!row) return res.status(404).json({error:'Demande introuvable ou déjà traitée.'});
  if (!['APPROUVEE','REFUSEE'].includes(decision)) return res.status(400).json({error:'Décision invalide.'});
  if (decision==='REFUSEE' && (!String(reason||'').trim() || String(reason).trim().length>500)) return res.status(400).json({error:'Un motif de refus est obligatoire.'});
  db.exec('BEGIN IMMEDIATE');
  try {
    const current=db.prepare("SELECT * FROM parent_registration_requests WHERE request_id=? AND status='EN_ATTENTE'").get(row.request_id);
    if (!current) { db.exec('ROLLBACK'); return res.status(409).json({error:'Cette demande a déjà été traitée.'}); }
    if (decision==='APPROUVEE') {
      const existing=db.prepare("SELECT 1 FROM users WHERE role='PARENT' AND student_id=(SELECT student_id FROM parents WHERE parent_id=?)").get(row.parent_id);
      if (existing) { db.exec('ROLLBACK'); return res.status(409).json({error:'Un compte parent existe déjà pour cet élève.'}); }
    }
    const now=new Date().toISOString();
    db.prepare('UPDATE parent_registration_requests SET status=?,decision_by=?,decision_at=?,rejection_reason=? WHERE request_id=?').run(decision,req.session.user.id,now,decision==='REFUSEE'?String(reason).trim():null,row.request_id);
    db.prepare('UPDATE parents SET registration_status=?,approved_at=?,account_status=? WHERE parent_id=?').run(decision,decision==='APPROUVEE'?now:null,decision==='APPROUVEE'?'ACTIVE':'REJECTED',row.parent_id);
    if (decision==='APPROUVEE') {
      const parent=db.prepare('SELECT * FROM parents WHERE parent_id=?').get(row.parent_id);
      db.prepare("INSERT INTO users(user_id,login_id,role,full_name,password_hash,status,student_id) VALUES(?,?,'PARENT',?,?,'ACTIVE',?)").run(`USR-${row.parent_id}`,parent.login_id,parent.full_name,row.password_hash,parent.student_id);
    }
    audit(req.session.user.id,`PARENT_REQUEST_${decision}`,'parent_registration_request',row.request_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); return res.status(500).json({error:'La décision n’a pas pu être enregistrée.'}); }
  res.json({ok:true});
});

function todayInSchoolTimezone() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Casablanca',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
let schoolClockTestOverride=null;
function setSchoolClockTestOverride(value) { if(process.env.NODE_ENV!=='test')throw new Error('Horloge de test désactivée.');schoolClockTestOverride=value||null; }
function currentSchoolClock() {
  if(process.env.NODE_ENV==='test'&&schoolClockTestOverride)return {...schoolClockTestOverride};
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Casablanca',weekday:'long',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  const days={Monday:'Lundi',Tuesday:'Mardi',Wednesday:'Mercredi',Thursday:'Jeudi',Friday:'Vendredi',Saturday:'Samedi',Sunday:'Dimanche'};
  return {date:parts.year+'-'+parts.month+'-'+parts.day,day:days[parts.weekday],hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second),time:parts.hour+':'+parts.minute};
}
function timeToMinutes(value) { const match=/^(\d{2}):(\d{2})$/.exec(String(value||''));return match?Number(match[1])*60+Number(match[2]):null; }
function findActiveLesson(lessons,clock) { const now=clock.hour*60+clock.minute;return lessons.find(lesson=>lesson.day===clock.day&&timeToMinutes(lesson.start_time)<=now&&now<timeToMinutes(lesson.end_time))||null; }
function boundedText(input,max=100) { return String(input||'').trim().slice(0,max); }
function validRecordId(input) { return /^[A-Za-z0-9_-]{1,80}$/.test(String(input||'')); }
function validIsoDate(input) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(input||'')))return false;
  const parsed=new Date(`${input}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===input;
}
function lessonDurationHours(startTime,endTime) {
  const minutes=value=>{const match=/^(\d{2}):(\d{2})$/.exec(String(value||''));return match?Number(match[1])*60+Number(match[2]):null;};
  const start=minutes(startTime),end=minutes(endTime);
  return start===null||end===null||end<=start?0:(end-start)/60;
}
function lessonMatchesDate(lesson,date) {
  const day=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return lesson && lesson.day===day;
}
function effectiveAttendance(attendanceId) {
  const row=db.prepare('SELECT status FROM attendance WHERE attendance_id=?').get(attendanceId);
  if(!row)return null;
  return db.prepare('SELECT corrected_status FROM attendance_corrections WHERE attendance_id=? ORDER BY corrected_at DESC,rowid DESC LIMIT 1').get(attendanceId)?.corrected_status||row.status;
}
function decodeAbsenceDocument(input) {
  if(input==null)return null;
  if(typeof input!=='object'||typeof input.filename!=='string'||typeof input.content_type!=='string'||typeof input.content_base64!=='string')throw new Error('Le document joint est invalide.');
  if(input.content_base64.length>Math.ceil(MAX_ABSENCE_DOCUMENT_BYTES*4/3)+8||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content_base64))throw new Error('Le document dépasse 2 Mo ou son encodage est invalide.');
  const bytes=Buffer.from(input.content_base64,'base64');
  if(!bytes.length||bytes.length>MAX_ABSENCE_DOCUMENT_BYTES||bytes.toString('base64')!==input.content_base64)throw new Error('Le document dépasse 2 Mo ou son encodage est invalide.');
  const signatures={
    'application/pdf':bytes.subarray(0,5).toString('ascii')==='%PDF-',
    'image/png':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/jpeg':bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
  };
  if(!Object.hasOwn(signatures,input.content_type)||!signatures[input.content_type])throw new Error('Formats acceptés : PDF, PNG ou JPEG valide.');
  const raw=path.basename(input.filename.replace(/\\/g,'/')).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,120);
  if(!raw)throw new Error('Nom de fichier invalide.');
  return {bytes,contentType:input.content_type,filename:raw};
}
function createHoldForAbsence(attendance,now=new Date().toISOString()) {
  const existing=db.prepare('SELECT * FROM entry_holds WHERE absence_attendance_id=?').get(attendance.attendance_id);
  if(existing){
    if(existing.status!=='ACTIVE'){
      db.prepare("UPDATE entry_holds SET status='ACTIVE',closed_at=NULL,closed_by=NULL,close_reason=NULL WHERE absence_attendance_id=?").run(attendance.attendance_id);
      const decision=db.prepare('SELECT decision_id,status FROM entry_decisions WHERE absence_attendance_id=?').get(attendance.attendance_id);
      if(decision){db.prepare("UPDATE entry_decisions SET status='EN_ATTENTE',authorized_lesson_id='',authorized_lesson_date='',authorized_by=NULL,direction_decision='',decided_at='',reason='Une correction a rétabli l’absence; une nouvelle décision de retour est requise.' WHERE decision_id=?").run(decision.decision_id);db.prepare(`INSERT INTO entry_decision_events(event_id,decision_id,action,reason,created_at,source) VALUES(?,?,'EN_ATTENTE','Une nouvelle décision est requise après correction.',?,'LIVE')`).run(crypto.randomUUID(),decision.decision_id,now);}
    }
    return existing;
  }
  db.prepare("INSERT INTO entry_holds(hold_id,student_id,absence_attendance_id,status,created_at) VALUES(?,?,?,'ACTIVE',?)").run(`HOLD-${attendance.attendance_id}`,attendance.student_id,attendance.attendance_id,now);
  const decisionId=`RET-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO entry_decisions(decision_id,student_id,massar_id,student_name,class_id,absence_lesson_id,status,authorized_lesson_id,direction_decision,decided_at,reason,absence_attendance_id)
    VALUES(?,?,?,?,?,?,'EN_ATTENTE','','','',?,?)`).run(decisionId,attendance.student_id,attendance.massar_id,attendance.student_name,attendance.class_id,attendance.lesson_id,'Une absence non justifiée bloque l’accès aux cours suivants.',attendance.attendance_id);
  db.prepare(`INSERT INTO entry_decision_events(event_id,decision_id,action,reason,created_at,source) VALUES(?,?,?,?,?,'LIVE')`).run(crypto.randomUUID(),decisionId,'EN_ATTENTE','Demande de retour créée après une absence.',now);
  return db.prepare('SELECT * FROM entry_holds WHERE absence_attendance_id=?').get(attendance.attendance_id);
}
function closeHoldForAbsence(attendanceId,actor,reason,now=new Date().toISOString()) {
  db.prepare("UPDATE entry_holds SET status='CLOSED',closed_at=?,closed_by=?,close_reason=? WHERE absence_attendance_id=? AND status='ACTIVE'").run(now,actor||null,reason,attendanceId);
}
function getActiveHold(studentId) {
  return db.prepare(`SELECT h.*,a.lesson_id AS absence_lesson_id,a.lesson_date AS absence_date,a.subject_name,a.slot_code,
      al.start_time AS absence_start_time,e.status AS explanation_status,d.decision_id,d.status AS decision_status,d.authorized_lesson_id,d.authorized_lesson_date,d.authorized_by,d.decided_at AS authorization_decided_at
    FROM entry_holds h JOIN attendance a ON a.attendance_id=h.absence_attendance_id
    JOIN lessons al ON al.lesson_id=a.lesson_id
    LEFT JOIN absence_explanations e ON e.attendance_id=a.attendance_id
    LEFT JOIN entry_decisions d ON d.absence_attendance_id=a.attendance_id
    WHERE h.student_id=? AND h.status='ACTIVE' ORDER BY a.lesson_date,a.slot_code LIMIT 1`).get(studentId)||null;
}
function isLessonSubsequentToAbsence(hold,lesson,date) {
  return Boolean(hold)&&(date>hold.absence_date||(date===hold.absence_date&&lesson.start_time>hold.absence_start_time));
}
function getParentsPending(limit=8) {
  return db.prepare("SELECT request_id,parent_name,child_name,class_id,class_number,massar_id,submitted_at,status FROM parent_registration_requests WHERE status='EN_ATTENTE' ORDER BY submitted_at LIMIT ?").all(limit);
}

app.get('/api/direction/dashboard',requireRole('DIRECTION'),(req,res) => {
  const today=todayInSchoolTimezone();
  const totals={
    students:db.prepare('SELECT COUNT(*) AS n FROM students').get().n,
    teachers:db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n,
    parents:db.prepare('SELECT COUNT(*) AS n FROM parents').get().n,
    classes:db.prepare('SELECT COUNT(*) AS n FROM classes').get().n
  };
  const pendingRequestCount=db.prepare("SELECT COUNT(*) AS n FROM parent_registration_requests WHERE status='EN_ATTENTE'").get().n;
  const attendanceRows=db.prepare('SELECT status,COUNT(*) AS count FROM attendance WHERE lesson_date=? GROUP BY status').all(today);
  const attendance={PRESENT:0,ABSENT:0,NOT_RECORDED:0};
  for(const row of attendanceRows) if(Object.hasOwn(attendance,row.status)) attendance[row.status]=row.count;
  const recentAbsences=db.prepare(`SELECT a.attendance_id,a.lesson_date,a.day,a.slot_code,a.student_id,a.student_name,a.massar_id,a.class_id,a.subject_name,a.teacher_name,a.status,
      COALESCE(e.status,'') AS explanation_status
    FROM attendance a LEFT JOIN absence_explanations e ON e.lesson_id=a.lesson_id AND e.student_id=a.student_id
    WHERE a.status='ABSENT' ORDER BY a.lesson_date DESC,a.recorded_at DESC,a.attendance_id LIMIT 8`).all();
  const activity=db.prepare(`SELECT a.event_id,a.action,a.entity_type,a.entity_id,a.created_at,COALESCE(u.full_name,'Système') AS actor_name
    FROM audit_log a LEFT JOIN users u ON u.user_id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 8`).all();
  const todayLabel=new Intl.DateTimeFormat('fr-MA',{timeZone:'Africa/Casablanca',dateStyle:'full'}).format(new Date());
  res.json({today,todayLabel,totals,attendance,pendingRequestCount,pendingRequests:getParentsPending(),recentAbsences,activity});
});

app.get('/api/direction/students',requireRole('DIRECTION'),(req,res) => {
  const q=boundedText(req.query.q,100), classId=boundedText(req.query.class_id,20), numberText=boundedText(req.query.class_number,3);
  const classNumber=numberText && /^\d{1,2}$/.test(numberText) ? Number(numberText) : null;
  const params=[], clauses=[];
  if(q){
    const like=`%${q}%`; const numeric=/^\d{1,2}$/.test(q) ? Number(q) : -1;
    clauses.push('(s.full_name LIKE ? OR s.massar_id LIKE ? OR s.class_id LIKE ? OR CAST(s.class_number AS TEXT) LIKE ?)');
    params.push(like,like,like,like);
    if(numeric>0){clauses[clauses.length-1]=clauses.at(-1).slice(0,-1)+' OR s.class_number=?)';params.push(numeric);}
  }
  if(classId){clauses.push('s.class_id=?');params.push(classId);}
  if(classNumber){clauses.push('s.class_number=?');params.push(classNumber);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const rows=db.prepare(`SELECT s.student_id,s.full_name,s.massar_id,s.class_id,s.class_number,s.status,
      p.full_name AS parent_name,p.phone AS parent_phone,p.registration_status AS parent_status
    FROM students s LEFT JOIN parents p ON p.student_id=s.student_id ${where}
    ORDER BY s.class_id,s.class_number LIMIT 200`).all(...params);
  res.json({students:rows});
});

app.get('/api/direction/students/:studentId',requireRole('DIRECTION'),(req,res) => {
  if(!validRecordId(req.params.studentId)) return res.status(400).json({error:'Identifiant élève invalide.'});
  const student=db.prepare('SELECT * FROM students WHERE student_id=?').get(req.params.studentId);
  if(!student) return res.status(404).json({error:'Élève introuvable.'});
  const parent=db.prepare('SELECT parent_id,full_name,email,phone,registration_status,account_status FROM parents WHERE student_id=? ORDER BY CASE registration_status WHEN \'APPROUVEE\' THEN 0 WHEN \'EN_ATTENTE\' THEN 1 ELSE 2 END LIMIT 1').get(student.student_id)||null;
  const timetable=db.prepare(`SELECT lesson_id,day,day_index,shift,slot_code,start_time,end_time,subject_name,teacher_id,teacher_name,room,color
    FROM lessons WHERE class_id=? AND is_active=1 ORDER BY day_index,slot_code`).all(student.class_id);
  const attendance=db.prepare(`SELECT a.attendance_id,a.lesson_id,a.lesson_date,a.day,a.slot_code,a.subject_name,a.teacher_name,a.status,a.access_status,
      (SELECT c.corrected_status FROM attendance_corrections c WHERE c.attendance_id=a.attendance_id ORDER BY c.corrected_at DESC,c.rowid DESC LIMIT 1) AS corrected_status,
      (SELECT c.reason FROM attendance_corrections c WHERE c.attendance_id=a.attendance_id ORDER BY c.corrected_at DESC,c.rowid DESC LIMIT 1) AS correction_reason,
      (SELECT c.corrected_at FROM attendance_corrections c WHERE c.attendance_id=a.attendance_id ORDER BY c.corrected_at DESC,c.rowid DESC LIMIT 1) AS corrected_at
    FROM attendance a
    WHERE a.student_id=? ORDER BY a.lesson_date DESC,a.slot_code DESC LIMIT 300`).all(student.student_id);
  const explanations=db.prepare('SELECT explanation_id,attendance_id,lesson_id,absence_date,reason,status,direction_decision,decided_by,decided_at FROM absence_explanations WHERE student_id=? ORDER BY absence_date DESC').all(student.student_id);
  const entryDecisions=db.prepare('SELECT decision_id,absence_attendance_id,absence_lesson_id,status,authorized_lesson_id,authorized_lesson_date,authorized_by,direction_decision,decided_at,reason FROM entry_decisions WHERE student_id=? ORDER BY decided_at DESC').all(student.student_id);
  const correctionHistory=db.prepare(`SELECT c.correction_id,c.attendance_id,c.original_status,c.corrected_status,c.reason,c.actor,c.corrected_at,a.lesson_date,a.subject_name
    FROM attendance_corrections c JOIN attendance a ON a.attendance_id=c.attendance_id WHERE c.student_id=? ORDER BY c.corrected_at DESC,c.rowid DESC`).all(student.student_id);
  const explanationHistory=db.prepare(`SELECT d.explanation_id,d.action,d.reason,d.decided_by,d.decided_at,d.source FROM absence_explanation_decisions d
    JOIN absence_explanations e ON e.explanation_id=d.explanation_id WHERE e.student_id=? ORDER BY d.decided_at DESC`).all(student.student_id);
  const entryHistory=db.prepare(`SELECT ev.decision_id,ev.action,ev.reason,ev.actor_user_id,ev.authorized_lesson_id,ev.authorized_lesson_date,ev.created_at,ev.source
    FROM entry_decision_events ev JOIN entry_decisions d ON d.decision_id=ev.decision_id WHERE d.student_id=? ORDER BY ev.created_at DESC`).all(student.student_id);
  res.json({student,parent,timetable,attendance,explanations,entryDecisions,correctionHistory,explanationHistory,entryHistory});
});

app.get('/api/direction/teachers',requireRole('DIRECTION'),(req,res) => {
  const q=boundedText(req.query.q,100), subject=boundedText(req.query.subject,100), shift=boundedText(req.query.shift,20);
  const clauses=[],params=[];
  if(q){const like=`%${q}%`;clauses.push('(t.full_name LIKE ? OR t.teacher_id LIKE ? OR t.subject_name LIKE ?)');params.push(like,like,like);}
  if(subject){clauses.push('t.subject_name=?');params.push(subject);}
  if(shift){clauses.push('t.shift=?');params.push(shift);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const rows=db.prepare(`SELECT t.teacher_id,t.full_name,t.subject_name,t.shift,t.status,t.email,t.phone,
    COALESCE(w.weekly_hours,0) AS weekly_hours,COALESCE(w.max_hours_day,t.max_hours_day) AS max_hours_day,
    GROUP_CONCAT(DISTINCT l.class_id) AS classes
    FROM teachers t LEFT JOIN teacher_workload_summary w ON w.teacher_id=t.teacher_id LEFT JOIN lessons l ON l.teacher_id=t.teacher_id AND l.is_active=1
    ${where} GROUP BY t.teacher_id ORDER BY t.subject_name,t.full_name LIMIT 100`).all(...params);
  res.json({teachers:rows,subjects:db.prepare('SELECT name FROM subjects ORDER BY name').all().map(x=>x.name)});
});

app.get('/api/direction/teachers/:teacherId',requireRole('DIRECTION'),(req,res) => {
  if(!validRecordId(req.params.teacherId)) return res.status(400).json({error:'Identifiant enseignant invalide.'});
  const teacher=db.prepare(`SELECT t.*,w.weekly_hours,w.max_hours_day FROM teachers t LEFT JOIN teacher_workload_summary w ON w.teacher_id=t.teacher_id WHERE t.teacher_id=?`).get(req.params.teacherId);
  if(!teacher) return res.status(404).json({error:'Enseignant introuvable.'});
  const timetable=db.prepare('SELECT lesson_id,day,day_index,shift,slot_code,start_time,end_time,class_id,subject_name,room,color FROM lessons WHERE teacher_id=? AND is_active=1 ORDER BY day_index,slot_code').all(teacher.teacher_id);
  const schedule=db.prepare('SELECT day,shift,shift_start,shift_end,lesson_hours,day_status FROM teacher_work_schedule WHERE teacher_id=? ORDER BY CASE day WHEN \'Lundi\' THEN 1 WHEN \'Mardi\' THEN 2 WHEN \'Mercredi\' THEN 3 WHEN \'Jeudi\' THEN 4 WHEN \'Vendredi\' THEN 5 ELSE 6 END').all(teacher.teacher_id);
  const absences=db.prepare('SELECT absence_id,absence_date,type,reason,substitute,status FROM teacher_absences WHERE teacher_id=? ORDER BY absence_date DESC').all(teacher.teacher_id);
  const classes=db.prepare('SELECT DISTINCT c.class_id,c.name FROM lessons l JOIN classes c ON c.class_id=l.class_id WHERE l.teacher_id=? AND l.is_active=1 ORDER BY c.class_id').all(teacher.teacher_id);
  res.json({teacher,timetable,schedule,absences,classes});
});

app.get('/api/direction/parents',requireRole('DIRECTION'),(req,res) => {
  const q=boundedText(req.query.q,100), status=boundedText(req.query.status,20);
  const clauses=[],params=[];
  if(q){const like=`%${q}%`;clauses.push('(p.full_name LIKE ? OR p.child_name LIKE ? OR p.child_massar_id LIKE ? OR p.class_id LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)');params.push(like,like,like,like,like,like);}
  if(status && ['ACTIVE','PENDING','REJECTED'].includes(status)){clauses.push('p.account_status=?');params.push(status);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const parents=db.prepare(`SELECT p.parent_id,p.full_name,p.email,p.phone,p.student_id,p.child_name,p.child_massar_id,p.class_id,p.class_number,p.registration_status,p.account_status,
    CASE WHEN u.user_id IS NULL THEN 0 ELSE 1 END AS can_login
    FROM parents p LEFT JOIN users u ON u.role='PARENT' AND u.student_id=p.student_id ${where}
    ORDER BY p.class_id,p.class_number LIMIT 200`).all(...params);
  res.json({parents});
});

app.get('/api/direction/classes',requireRole('DIRECTION'),(req,res) => {
  const classes=db.prepare(`SELECT c.class_id,c.name,c.level,c.track,c.language,c.enrollment,COUNT(DISTINCT s.student_id) AS student_count,
    COUNT(DISTINCT l.lesson_id) AS lesson_count
    FROM classes c LEFT JOIN students s ON s.class_id=c.class_id LEFT JOIN lessons l ON l.class_id=c.class_id AND l.is_active=1
    GROUP BY c.class_id ORDER BY c.class_id`).all();
  res.json({classes});
});
app.get('/api/direction/classes/:classId',requireRole('DIRECTION'),(req,res) => {
  const classId=boundedText(req.params.classId,20);
  if(!/^[A-Z0-9_-]{2,20}$/.test(classId)) return res.status(400).json({error:'Classe invalide.'});
  const classInfo=db.prepare('SELECT * FROM classes WHERE class_id=?').get(classId);
  if(!classInfo) return res.status(404).json({error:'Classe introuvable.'});
  const students=db.prepare(`SELECT s.student_id,s.full_name,s.massar_id,s.class_number,p.full_name AS parent_name,p.phone AS parent_phone
    FROM students s LEFT JOIN parents p ON p.student_id=s.student_id WHERE s.class_id=? ORDER BY s.class_number`).all(classId);
  const timetable=db.prepare('SELECT lesson_id,day,day_index,shift,slot_code,start_time,end_time,subject_name,teacher_name,teacher_id,room,color FROM lessons WHERE class_id=? AND is_active=1 ORDER BY day_index,slot_code').all(classId);
  const subjectHours=db.prepare('SELECT subject_name,COUNT(*) AS hours FROM lessons WHERE class_id=? AND is_active=1 GROUP BY subject_name ORDER BY subject_name').all(classId);
  const shifts=db.prepare('SELECT day,shift,shift_start,shift_end,lesson_hours FROM class_weekly_shifts WHERE class_id=? ORDER BY CASE day WHEN \'Lundi\' THEN 1 WHEN \'Mardi\' THEN 2 WHEN \'Mercredi\' THEN 3 WHEN \'Jeudi\' THEN 4 WHEN \'Vendredi\' THEN 5 ELSE 6 END').all(classId);
  res.json({classInfo,students,timetable,subjectHours,shifts});
});

app.get('/api/direction/absences',requireRole('DIRECTION'),(req,res) => {
  const q=boundedText(req.query.q,100), classId=boundedText(req.query.class_id,20), status=boundedText(req.query.status,20);
  const dateFrom=boundedText(req.query.date_from,10), dateTo=boundedText(req.query.date_to,10);
  const limit=Number(req.query.limit||100),offset=Number(req.query.offset||0);
  if(status && !['PRESENT','ABSENT','NOT_RECORDED'].includes(status)) return res.status(400).json({error:'Filtre de présence invalide.'});
  if((dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) || (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo))) return res.status(400).json({error:'Format de date invalide.'});
  if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>100000) return res.status(400).json({error:'Pagination invalide.'});
  const clauses=[],params=[];
  const lessonId=boundedText(req.query.lesson_id,80);
  if(q){const like=`%${q}%`;clauses.push('(a.student_name LIKE ? OR a.massar_id LIKE ? OR a.class_id LIKE ? OR CAST(s.class_number AS TEXT) LIKE ? OR a.subject_name LIKE ? OR l.lesson_id LIKE ?)');params.push(like,like,like,like,like,like);}
  if(lessonId){if(!validRecordId(lessonId))return res.status(400).json({error:'Identifiant de cours invalide.'});clauses.push('a.lesson_id=?');params.push(lessonId);}
  if(classId){clauses.push('a.class_id=?');params.push(classId);}
  if(status){clauses.push('a.status=?');params.push(status);}
  if(dateFrom){clauses.push('a.lesson_date>=?');params.push(dateFrom);}
  if(dateTo){clauses.push('a.lesson_date<=?');params.push(dateTo);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const total=db.prepare(`SELECT COUNT(*) AS n FROM attendance a JOIN students s ON s.student_id=a.student_id JOIN lessons l ON l.lesson_id=a.lesson_id ${where}`).get(...params).n;
  const rows=db.prepare(`SELECT a.attendance_id,a.lesson_id,a.lesson_date,a.day,a.slot_code,a.student_id,a.student_name,a.massar_id,a.class_id,s.class_number,
      a.subject_name,a.teacher_name,a.status,a.access_status,COALESCE(e.status,'') AS explanation_status,e.explanation_id,
      COALESCE(c.corrected_status,'') AS corrected_status,l.lesson_id AS lesson_code
    FROM attendance a JOIN students s ON s.student_id=a.student_id JOIN lessons l ON l.lesson_id=a.lesson_id
    LEFT JOIN absence_explanations e ON e.lesson_id=a.lesson_id AND e.student_id=a.student_id
    LEFT JOIN attendance_corrections c ON c.attendance_id=a.attendance_id ${where}
    ORDER BY a.lesson_date DESC,a.slot_code,a.class_id,s.class_number LIMIT ? OFFSET ?`).all(...params,limit,offset);
  res.json({records:rows,total,limit,offset});
});

app.get('/api/direction/absence-explanations',requireRole('DIRECTION'),(req,res) => {
  const status=boundedText(req.query.status,20),clauses=[],params=[];
  if(status){if(!['EN_ATTENTE','APPROUVEE','REFUSEE'].includes(status))return res.status(400).json({error:'État de justification invalide.'});clauses.push('e.status=?');params.push(status);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const rows=db.prepare(`SELECT e.explanation_id,e.attendance_id,e.student_id,e.student_name,e.massar_id,e.class_id,e.lesson_id,e.absence_date,e.reason,e.status,e.direction_decision,e.decided_by,e.decided_at,
      l.subject_name,l.slot_code,a.status AS attendance_status,a.status AS original_attendance_status,
      (SELECT GROUP_CONCAT(action||' · '||reason||' · '||COALESCE(decided_by,'')||' · '||decided_at,char(10)) FROM absence_explanation_decisions d WHERE d.explanation_id=e.explanation_id) AS history
    FROM absence_explanations e JOIN attendance a ON a.attendance_id=e.attendance_id JOIN lessons l ON l.lesson_id=e.lesson_id ${where}
    ORDER BY CASE e.status WHEN 'EN_ATTENTE' THEN 0 ELSE 1 END,e.created_at DESC`).all(...params);
  const documents=db.prepare(`SELECT d.doc_id,d.explanation_id,d.original_filename,d.content_type,d.size_bytes,d.uploaded_at
    FROM absence_explanation_documents d JOIN absence_explanations e ON e.explanation_id=d.explanation_id ${where}
    ORDER BY d.uploaded_at DESC`).all(...params);
  res.json({explanations:rows,documents});
});
app.post('/api/direction/absence-explanations/:explanationId/decision',requireRole('DIRECTION'),(req,res) => {
  const id=String(req.params.explanationId||''),decision=req.body?.decision,reason=String(req.body?.reason||'').trim();
  if(!validRecordId(id)||!['APPROUVEE','REFUSEE'].includes(decision))return res.status(400).json({error:'Décision de justification invalide.'});
  if(decision==='REFUSEE'&&(reason.length<3||reason.length>500))return res.status(400).json({error:'Un motif de refus de 3 à 500 caractères est obligatoire.'});
  const explanation=db.prepare("SELECT * FROM absence_explanations WHERE explanation_id=? AND status='EN_ATTENTE'").get(id);
  if(!explanation)return res.status(404).json({error:'Justification introuvable ou déjà traitée.'});
  if(effectiveAttendance(explanation.attendance_id)!=='ABSENT')return res.status(409).json({error:'La présence a été corrigée; cette justification ne peut plus être décidée.'});
  const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try {
    const current=db.prepare("SELECT * FROM absence_explanations WHERE explanation_id=? AND status='EN_ATTENTE'").get(id);
    if(!current){db.exec('ROLLBACK');return res.status(409).json({error:'Cette justification a déjà été traitée.'});}
    db.prepare('UPDATE absence_explanations SET status=?,direction_decision=?,decided_by=?,decided_at=? WHERE explanation_id=?').run(decision,decision==='REFUSEE'?reason:'Motif accepté',req.session.user.id,now,id);
    db.prepare('INSERT INTO absence_explanation_decisions(decision_id,explanation_id,action,reason,decided_by,decided_at,source) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,decision,reason,req.session.user.id,now,'LIVE');
    if(decision==='APPROUVEE')closeHoldForAbsence(current.attendance_id,req.session.user.id,'Absence justifiée par la Direction.',now);
    else {
      const attendance=db.prepare('SELECT * FROM attendance WHERE attendance_id=?').get(current.attendance_id);
      if(effectiveAttendance(attendance.attendance_id)==='ABSENT')createHoldForAbsence(attendance,now);
    }
    audit(req.session.user.id,`ABSENCE_EXPLANATION_${decision}`,'absence_explanation',id);
    db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');return res.status(500).json({error:'La décision de justification n’a pas pu être enregistrée.'});}
  res.json({ok:true,message:decision==='APPROUVEE'?'Justification approuvée. La présence reste enregistrée comme absente.':'Justification refusée. Le motif a été conservé.'});
});
app.post('/api/direction/attendance/:attendanceId/corrections',requireRole('DIRECTION'),(req,res) => {
  const id=String(req.params.attendanceId||''),status=req.body?.status,reason=String(req.body?.reason||'').trim();
  if(!validRecordId(id)||!['PRESENT','ABSENT','NOT_RECORDED'].includes(status)||reason.length<5||reason.length>500)return res.status(400).json({error:'État corrigé valide et motif de 5 à 500 caractères requis.'});
  const attendance=db.prepare('SELECT * FROM attendance WHERE attendance_id=?').get(id);
  if(!attendance)return res.status(404).json({error:'Enregistrement de présence introuvable.'});
  const current=effectiveAttendance(id);if(current===status)return res.status(409).json({error:'Cet état est déjà appliqué.'});
  const now=new Date().toISOString(),correctionId=`COR-${crypto.randomUUID()}`;db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO attendance_corrections(correction_id,attendance_id,lesson_id,student_id,massar_id,student_name,original_status,corrected_status,reason,actor,corrected_at,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(correctionId,id,attendance.lesson_id,attendance.student_id,attendance.massar_id,attendance.student_name,current,status,reason,req.session.user.id,now,'Correction append-only; l’événement de présence original est conservé.');
    if(status!=='ABSENT')closeHoldForAbsence(id,req.session.user.id,status==='PRESENT'?'Présence corrigée par la Direction.':'L’état corrigé n’est plus une absence.',now);
    if(status==='ABSENT'&&db.prepare("SELECT 1 FROM absence_explanations WHERE attendance_id=? AND status='APPROUVEE'").get(id)===undefined)createHoldForAbsence(attendance,now);
    audit(req.session.user.id,'ATTENDANCE_CORRECTED','attendance',id);
    db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');return res.status(500).json({error:'La correction n’a pas pu être enregistrée.'});}
  res.status(201).json({ok:true,correction_id:correctionId,message:'Correction enregistrée. La valeur initiale reste conservée.'});
});
app.get('/api/direction/entry-decisions',requireRole('DIRECTION'),(req,res) => {
  const rows=db.prepare(`SELECT d.decision_id,d.status,d.reason,d.authorized_lesson_id,d.authorized_lesson_date,d.direction_decision,d.decided_at,
      a.attendance_id,a.lesson_date AS absence_date,a.student_id,a.student_name,a.massar_id,a.class_id,a.subject_name,a.slot_code,
      h.status AS hold_status
    FROM entry_decisions d JOIN attendance a ON a.attendance_id=d.absence_attendance_id
    JOIN entry_holds h ON h.absence_attendance_id=a.attendance_id AND h.status='ACTIVE'
    ORDER BY CASE d.status WHEN 'EN_ATTENTE' THEN 0 WHEN 'REFUSEE' THEN 1 ELSE 2 END,a.lesson_date DESC`).all();
  res.json({decisions:rows,lessons:db.prepare('SELECT lesson_id,day,slot_code,start_time,end_time,class_id,subject_name FROM lessons WHERE is_active=1 ORDER BY class_id,day_index,start_time').all()});
});
app.post('/api/direction/entry-decisions/:decisionId/decision',requireRole('DIRECTION'),(req,res) => {
  const id=String(req.params.decisionId||''),decision=req.body?.decision,reason=String(req.body?.reason||'').trim();
  const lessonId=String(req.body?.authorized_lesson_id||''),lessonDate=String(req.body?.authorized_lesson_date||'');
  if(!validRecordId(id)||!['AUTORISEE','REFUSEE'].includes(decision)||reason.length<5||reason.length>500)return res.status(400).json({error:'Décision et motif de 5 à 500 caractères requis.'});
  const current=db.prepare("SELECT d.*,a.lesson_date AS absence_date,a.student_id,a.class_id,al.start_time AS absence_start_time,h.status AS hold_status FROM entry_decisions d JOIN attendance a ON a.attendance_id=d.absence_attendance_id JOIN lessons al ON al.lesson_id=a.lesson_id JOIN entry_holds h ON h.absence_attendance_id=a.attendance_id AND h.status='ACTIVE' WHERE d.decision_id=? AND d.status IN ('EN_ATTENTE','REFUSEE','AUTORISEE')").get(id);
  if(!current)return res.status(404).json({error:'Demande de retour introuvable ou déjà traitée.'});
  if(current.hold_status!=='ACTIVE'||effectiveAttendance(current.absence_attendance_id)!=='ABSENT')return res.status(409).json({error:'Cette absence ne crée plus de blocage actif.'});
  let authorizedLesson=null;
  if(decision==='AUTORISEE'){
    if(!validRecordId(lessonId)||!validIsoDate(lessonDate)||lessonDate<current.absence_date||lessonDate<todayInSchoolTimezone())return res.status(400).json({error:'Choisissez un cours futur à la date de l’absence ou à une date ultérieure.'});
    authorizedLesson=db.prepare('SELECT * FROM lessons WHERE lesson_id=? AND class_id=? AND is_active=1').get(lessonId,current.class_id);
    if(!lessonMatchesDate(authorizedLesson,lessonDate))return res.status(400).json({error:'Le cours choisi ne correspond pas à la classe ou au jour indiqué.'});
    if(lessonDate===current.absence_date&&authorizedLesson.start_time<=current.absence_start_time)return res.status(400).json({error:'Choisissez un cours postérieur à l’absence.'});
    if(db.prepare('SELECT 1 FROM attendance WHERE student_id=? AND lesson_id=? AND lesson_date=?').get(current.student_id,lessonId,lessonDate))return res.status(409).json({error:'Cet appel est déjà enregistré. Choisissez un prochain cours sans présence saisie.'});
  }
  const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try {
    const live=db.prepare("SELECT status FROM entry_decisions WHERE decision_id=?").get(id);if(!live||!['EN_ATTENTE','REFUSEE','AUTORISEE'].includes(live.status)){db.exec('ROLLBACK');return res.status(409).json({error:'Cette demande de retour a déjà été traitée.'});}
    db.prepare('UPDATE entry_decisions SET status=?,authorized_lesson_id=?,authorized_lesson_date=?,authorized_by=?,direction_decision=?,decided_at=?,reason=? WHERE decision_id=?').run(decision,decision==='AUTORISEE'?lessonId:'',decision==='AUTORISEE'?lessonDate:'',req.session.user.id,req.session.user.id,now,reason,id);
    db.prepare(`INSERT INTO entry_decision_events(event_id,decision_id,action,reason,actor_user_id,authorized_lesson_id,authorized_lesson_date,created_at,source)
      VALUES(?,?,?,?,?,?,?,?, 'LIVE')`).run(crypto.randomUUID(),id,decision,reason,req.session.user.id,decision==='AUTORISEE'?lessonId:null,decision==='AUTORISEE'?lessonDate:null,now);
    if(decision==='REFUSEE'){
      const hold=db.prepare("SELECT absence_attendance_id FROM entry_holds WHERE student_id=? AND status='ACTIVE' ORDER BY created_at LIMIT 1").get(current.student_id);
      if(hold)db.prepare('UPDATE entry_holds SET closed_at=NULL,closed_by=NULL,close_reason=NULL WHERE absence_attendance_id=?').run(hold.absence_attendance_id);
    }
    audit(req.session.user.id,`ENTRY_RETURN_${decision}`,'entry_decision',id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');return res.status(500).json({error:'La décision de retour n’a pas pu être enregistrée.'});}
  res.json({ok:true,message:decision==='AUTORISEE'?'Retour autorisé pour le cours et la date choisis.':'Retour refusé. Le blocage reste actif.'});
});

app.get('/api/direction/timetable',requireRole('DIRECTION'),(req,res) => {
  const classId=boundedText(req.query.class_id,20), teacherId=boundedText(req.query.teacher_id,40), day=boundedText(req.query.day,20);
  const clauses=[],params=[];
  if(classId){clauses.push('l.class_id=?');params.push(classId);}
  if(teacherId){clauses.push('l.teacher_id=?');params.push(teacherId);}
  if(day){if(!['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'].includes(day))return res.status(400).json({error:'Jour invalide.'});clauses.push('l.day=?');params.push(day);}
  const where=clauses.length?`WHERE ${clauses.join(' AND ')}`:'';
  const lessons=db.prepare(`SELECT l.lesson_id,l.day,l.day_index,l.shift,l.slot_code,l.start_time,l.end_time,l.class_id,l.subject_name,l.teacher_id,l.teacher_name,l.room,l.color
    FROM lessons l WHERE l.is_active=1 ${where ? 'AND '+where.slice(6) : ''} ORDER BY l.day_index,l.start_time,l.class_id LIMIT 500`).all(...params);
  res.json({lessons,classes:db.prepare('SELECT class_id,name FROM classes ORDER BY class_id').all(),teachers:db.prepare('SELECT teacher_id,full_name FROM teachers ORDER BY full_name').all()});
});
app.get('/api/direction/timetable/:lessonId',requireRole('DIRECTION'),(req,res) => {
  if(!validRecordId(req.params.lessonId))return res.status(400).json({error:'Cours invalide.'});
  const lesson=db.prepare('SELECT * FROM lessons WHERE lesson_id=? AND is_active=1').get(req.params.lessonId);
  if(!lesson)return res.status(404).json({error:'Cours introuvable.'});
  res.json({lesson,subjects:db.prepare('SELECT code,name,color FROM subjects ORDER BY name').all(),teachers:db.prepare('SELECT teacher_id,full_name,subject_code FROM teachers ORDER BY full_name').all()});
});
app.put('/api/direction/timetable/:lessonId',requireRole('DIRECTION'),(req,res) => {
  if(!validRecordId(req.params.lessonId))return res.status(400).json({error:'Cours invalide.'});
  const lesson=db.prepare('SELECT * FROM lessons WHERE lesson_id=? AND is_active=1').get(req.params.lessonId);
  if(!lesson)return res.status(404).json({error:'Cours introuvable.'});
  const day=boundedText(req.body?.day,20),slotCode=boundedText(req.body?.slot_code,2),teacherId=boundedText(req.body?.teacher_id,40),subjectCode=boundedText(req.body?.subject_code,20),room=boundedText(req.body?.room,40);
  const dayIndex=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'].indexOf(day)+1,slotTimes={M1:['Matin','08:00','09:00'],M2:['Matin','09:00','10:00'],M3:['Matin','10:00','11:00'],M4:['Matin','11:00','12:00'],S1:['Après-midi','14:00','15:00'],S2:['Après-midi','15:00','16:00'],S3:['Après-midi','16:00','17:00'],S4:['Après-midi','17:00','18:00']},slot=slotTimes[slotCode];
  if(dayIndex<1||!slot||(['Vendredi','Samedi'].includes(day)&&slot[0]!=='Matin'))return res.status(400).json({error:'Jour ou horaire invalide pour l’établissement.'});
  const subject=db.prepare('SELECT code,name,color FROM subjects WHERE code=?').get(subjectCode),teacher=db.prepare("SELECT teacher_id,full_name,subject_code FROM teachers WHERE teacher_id=? AND status='Actif'").get(teacherId);
  if(!subject||!teacher||teacher.subject_code!==subject.code)return res.status(400).json({error:'Choisissez un enseignant qualifié pour la matière sélectionnée.'});
  if(!db.prepare('SELECT 1 FROM class_weekly_shifts WHERE class_id=? AND day=? AND lesson_hours>0').get(lesson.class_id,day))return res.status(400).json({error:'Cette classe n’a pas cours ce jour-là.'});
  if(db.prepare('SELECT 1 FROM lessons WHERE is_active=1 AND lesson_id<>? AND class_id=? AND day=? AND slot_code=?').get(lesson.lesson_id,lesson.class_id,day,slotCode))return res.status(409).json({error:'La classe a déjà un cours sur ce créneau.'});
  if(db.prepare('SELECT 1 FROM lessons WHERE is_active=1 AND lesson_id<>? AND teacher_id=? AND day=? AND slot_code=?').get(lesson.lesson_id,teacherId,day,slotCode))return res.status(409).json({error:'Cet enseignant a déjà un cours sur ce créneau.'});
  const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try{db.prepare(`UPDATE lessons SET day=?,day_index=?,shift=?,slot_code=?,start_time=?,end_time=?,subject_code=?,subject_name=?,teacher_id=?,teacher_name=?,room=?,color=? WHERE lesson_id=?`).run(day,dayIndex,slot[0],slotCode,slot[1],slot[2],subject.code,subject.name,teacher.teacher_id,teacher.full_name,room,subject.color,lesson.lesson_id);audit(req.session.user.id,'TIMETABLE_LESSON_UPDATED','lesson',lesson.lesson_id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');return res.status(500).json({error:'Le cours n’a pas pu être modifié.'});}
  res.json({ok:true,message:'Le cours a été mis à jour.'});
});

app.get('/api/direction/notifications',requireRole('DIRECTION'),(req,res) => {
  const notifications=db.prepare("SELECT notification_id,title,message,created_at,is_read FROM notifications WHERE role='DIRECTION' ORDER BY created_at DESC LIMIT 100").all();
  res.json({notifications});
});
app.patch('/api/direction/notifications/:notificationId/read',requireRole('DIRECTION'),(req,res) => {
  if(!validRecordId(req.params.notificationId)) return res.status(400).json({error:'Notification invalide.'});
  const result=db.prepare("UPDATE notifications SET is_read='true' WHERE notification_id=? AND role='DIRECTION'").run(req.params.notificationId);
  if(!result.changes) return res.status(404).json({error:'Notification introuvable.'});
  audit(req.session.user.id,'NOTIFICATION_READ','notification',req.params.notificationId);
  res.json({ok:true});
});
app.get('/api/direction/settings',requireRole('DIRECTION'),(req,res) => {
  const settings=Object.fromEntries(db.prepare('SELECT setting_key,setting_value FROM school_settings WHERE setting_key IN (\'school_name\',\'school_year\',\'timezone\')').all().map(r=>[r.setting_key,r.setting_value]));
  res.json({settings,rooms:db.prepare('SELECT room_name,active FROM rooms ORDER BY room_name').all(),subjects:db.prepare('SELECT code,name,weekly_hours,color,usual_room FROM subjects ORDER BY name').all()});
});
app.put('/api/direction/settings',requireRole('DIRECTION'),(req,res) => {
  const schoolName=boundedText(req.body?.school_name,120), schoolYear=boundedText(req.body?.school_year,20);
  if(schoolName.length<3 || schoolYear.length<4) return res.status(400).json({error:'Nom de l’établissement ou année scolaire invalide.'});
  const upsert=db.prepare('INSERT INTO school_settings(setting_key,setting_value) VALUES(?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value');
  upsert.run('school_name',schoolName);upsert.run('school_year',schoolYear);
  audit(req.session.user.id,'SCHOOL_SETTINGS_UPDATED','school_settings','school_name,school_year');
  res.json({ok:true});
});

app.use('/api', (req,res) => res.status(404).json({error:'Route API introuvable.'}));
const ROLE_PATHS={DIRECTION:'/admin',TEACHER:'/teacher',PARENT:'/parent'};
const ROLE_PAGES={DIRECTION:'admin.html',TEACHER:'enseignant.html',PARENT:'parent.html'};
app.get('/',(req,res) => {
  if(req.session.user)return res.redirect(ROLE_PATHS[req.session.user.role]||'/');
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(ROOT,'public','index.html'));
});
app.get(['/admin','/parent','/teacher','/direction','/enseignant'],(req,res) => {
  if(!req.session.user)return res.redirect('/');
  if(req.path==='/direction'&&req.session.user.role==='DIRECTION')return res.redirect('/admin');
  if(req.path==='/enseignant'&&req.session.user.role==='TEACHER')return res.redirect('/teacher');
  const role=Object.keys(ROLE_PATHS).find(key=>ROLE_PATHS[key]===req.path);
  if(!role)return res.redirect(ROLE_PATHS[req.session.user.role]||'/');
  if(req.session.user.role!==role)return res.redirect(ROLE_PATHS[req.session.user.role]||'/');
  res.setHeader('Cache-Control','no-store');
  res.sendFile(path.join(ROOT,'public',ROLE_PAGES[role]));
});
app.get('/{*path}', (req,res) => res.redirect('/'));
app.use((error,req,res,next) => {
  const requestId=crypto.randomUUID();
  const detail=String(error.message||'').replace(/[\r\n]+/g,' ').slice(0,180);
  console.error(`[request-error ${requestId}] ${req.method} ${req.path} ${error.code||error.name||'Error'} ${detail}`);
  if(res.headersSent)return next(error);
  res.status(500).json({error:'Une erreur interne est survenue. Réessayez.',request_id:requestId});
});

function start() {
  return app.listen(PORT,HOST,() => console.log(`SMART CLASS local est prêt sur http://${HOST}:${PORT}`));
}
if (require.main === module) start();

module.exports = { app, db, start, insertSeedData, applyMigrations, DB_PATH, findActiveLesson, timeToMinutes, setSchoolClockTestOverride };
