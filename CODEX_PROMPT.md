# CODEX MASTER PROMPT — SMART CLASS (LOCAL WEBSITE ONLY)

Read this whole file before writing code. Then build the application in the NEW folder where this file is placed.

You are building a school website for a person who is learning. Explain actions in simple words. Work carefully, make the real application, and do not only make a design or a screenshot.

## 0. THE MOST IMPORTANT RULE

Build ONE complete website that runs on ONE Windows computer.

The address must be:

`http://127.0.0.1:3000`

This is a brand-new project. Do not use, edit, copy, or depend on the user's old SMART CLASS project.

**Do not use Firebase, Firebase Authentication, Firebase Realtime Database, Firebase Functions, Cloudflare, Workers, ESP32, hosting, tunnels, external databases, paid APIs, or GitHub integrations.**

The website, backend, login, database, attendance rules, and uploaded files must all work locally.

Use:
- Node.js + Express for the one local server.
- HTML, CSS, and plain JavaScript in the browser.
- SQLite for permanent local data.
- bcrypt/bcryptjs for password hashing.
- Server-side sessions stored in SQLite.
- Local disk folders for uploaded photos and files.
- Same-origin API requests only.

Do not add React, Next.js, a second server, or a cloud service. Keep the code easy to understand and maintain.

## 1. SCHOOL AND LANGUAGE

School name: **Établissement Abdlkrim El Khatabi**

School year: **2026–2027**

All visible website text must be in French:
- Page titles
- Buttons
- Menus
- Form labels
- Table headings
- Search hints
- Notifications
- Validation messages
- Error messages
- Empty-state messages
- Reports
- Date and time display

Use French spelling and accents. Use a French locale (`fr-MA`) and the `Africa/Casablanca` timezone.

The code variable names may be English or French, but the user interface must be French.

## 2. LOOK AND FEEL — FOLLOW THESE VISUAL DIRECTIONS

The design must feel like one polished school-management product, not three different websites.

Use a clean, modern, calm design:
- Main background: very light blue-grey, around `#F4F7FC`.
- Main text: dark navy, around `#14213D`.
- Primary blue: around `#2457D6`.
- White cards with soft borders and small shadows.
- Rounded corners, but do not make every item a large pill.
- Clear spacing and readable text.
- Use a consistent icon set. If using an icon library, bundle it locally or use simple inline SVGs. Do not depend on an online icon service.
- Responsive layout: desktop first, but usable on a tablet and phone.
- Add hover, focus, selected, disabled, success, warning and error states.
- Do not make empty dashboards. Every dashboard must use the supplied initial school records.

### 2.1 Main application layout after login

On desktop:
- A fixed left sidebar, about 250–270 pixels wide.
- A main content area fills the remaining width.
- A slim top bar in the main area contains the current page title, global search where useful, notification icon, profile name and a sign-out button.
- The sidebar contains the SMART CLASS logo/name, the user's role, the navigation links for that role, and the signed-in user's name near the bottom.
- The active menu item has a clear blue highlight.
- The sidebar can collapse to icons and can open again.

Do not show a menu item to a role that is not allowed to use it. Also enforce every permission in the server. Hiding a link is not security.

### 2.2 Login and parent registration screen

This is the first screen a visitor sees.

Create ONE elegant login page, similar in simplicity to a familiar social website login page. It is not a real social login and must not use Facebook, Google or Instagram.

Layout:
- Center a large white card on a very light background.
- On the left side of the card, show the SMART CLASS mark, the school name, a short French sentence and a simple school illustration or abstract shapes.
- On the right side, show the form.
- At the top of the form, show two tabs:
  1. `Connexion`
  2. `Inscription parent`
- Clicking a tab must animate the form smoothly from left to right (or right to left), around 250–350 ms. Do not reload the whole page.
- Add a moving underline or sliding tab indicator.
- Respect reduced-motion accessibility settings.

Login form:
- Label 1: `Identifiant`
- Label 2: `Mot de passe`
- A show/hide password eye button.
- A `Se connecter` button.
- A small message area for errors and success.
- Do not ask the user to select their role. The server finds the account and role from the identifier.
- Do not ask for an email on login. Login uses ID + password.

There are NO shared demo accounts and NO generic passwords such as teacher/teacher or parent/parent.
Use the unique initial accounts in `private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv`:
- Direction: one unique `DIR-001` account.
- Each teacher: their own `login_id` from `seed_data/teachers.csv`.
- Each parent: the linked child's Code Massar from `seed_data/parents.csv`.
- Never create a shared teacher or parent shortcut account.

On the first database initialization, read the private CSV on the server only, hash every password with bcrypt, and store only the hashes in SQLite. Do not copy the CSV into `public/`, do not expose it through an API, do not print passwords in logs, and do not include passwords in the browser bundle. Keep the private file outside the public directory. The file is excluded by `.gitignore`.

After a successful login:
- Direction goes to the Direction dashboard.
- Teacher goes to the Teacher dashboard.
- Parent goes to the Parent dashboard for ONLY their linked child.

Never let the user pick a different role in the browser to bypass the real account role.

### 2.3 Parent registration tab

The `Inscription parent` tab slides into view on the same card.

French form fields, in this order:
1. `Nom complet du parent`
2. `Nom complet de l'élève`
3. `Classe`
4. `Numéro dans la classe`
5. `Code Massar`
6. `Adresse e-mail`
7. `Numéro de téléphone`
8. `Créer un mot de passe`
9. `Confirmer le mot de passe`
10. Checkbox: `Je confirme que ces informations sont exactes.`
11. Button: `Envoyer la demande`

Rules:
- A parent account belongs to exactly ONE student.
- The login ID after approval is the student's Code Massar.
- The parent must enter the student's exact Code Massar, name, class and class number.
- Check that the student exists in SQLite.
- Check that the child is not already linked to an approved parent or another pending request.
- Do not allow two parent accounts for one child.
- Store the new request as `EN_ATTENTE`.
- Do not allow a pending parent to log in.
- Show: `Votre demande a été envoyée à la Direction. Vous pourrez vous connecter après validation.`
- Do not tell a stranger whether a guessed Massar ID exists. Use a safe, general response when validation fails.
- Passwords must be hashed. Never save or display plain passwords after registration.
- Direction must see the request and can approve or reject it. A rejection must require a reason.
- When approved, the parent can log in with the child's Massar ID and the password they created.
- Provisioned parent accounts use the unique initial password in `private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv`.

## 2.4 INITIAL ACCOUNTS — NO SHARED DEMO LOGINS

Create only the 71 uniquely credentialed initial accounts provided in the private credentials file. Every teacher and every parent must have their own ID and password. Parent ID is the linked child's Code Massar. Direction ID is `DIR-001`. Do not create generic shortcuts, sample accounts, or a role selector. Store password hashes only.

## 3. THE THREE ROLE AREAS

There are three roles:
1. `DIRECTION`
2. `TEACHER`
3. `PARENT`

Use one shared application layout and shared database, but show a different sidebar and pages for each role.

## 4. DIRECTION PORTAL

Direction's sidebar must contain these pages in this order:

1. `Vue d'ensemble`
2. `Absences`
3. `Enseignants`
4. `Élèves`
5. `Classes`
6. `Parents`
7. `Emploi du temps`
8. `Demandes d'inscription`
9. `Corrections`
10. `Rapports`
11. `Paramètres`

### 4.1 Vue d'ensemble

Show real statistics calculated from the database:
- Total élèves
- Total enseignants
- Total classes
- Présents aujourd'hui
- Absents aujourd'hui
- Justifications en attente
- Demandes de parents en attente
- Élèves avec blocage d'accès actif

Add a small attendance chart for the current current school week and a list of recent events. Do not hardcode fake totals. The values must change when records change.

### 4.2 Absences page

At the top show a search and filters row:
- Search by student's full name.
- Search by Code Massar.
- Search by class.
- Search by number in class.
- Date range.
- Subject/lesson filter.
- Status filter: `Présent`, `Absent`, `Non saisi`, `Bloqué`.

The search must work when the user searches by:
- A student's name.
- One Massar ID.
- A class such as `TCSF2`.
- A class number such as `4` (show number 4 from all classes).
- A combination of filters.

Below, show a clean table. Columns:
- Date
- Élève
- Code Massar
- Classe
- Numéro
- Matière
- Enseignant
- Horaire
- Présence
- Justification
- Accès

Clicking a row opens a detail panel on the right (not a new browser tab). Show the student, the lesson, original attendance, parent details, explanation status, entry hold status and the decision history.

Keep these as separate facts:
- Attendance: `PRESENT` or `ABSENT`.
- Explanation: `EN_ATTENTE`, `APPROUVEE`, or `REFUSEE`.
- Entry decision: `EN_ATTENTE`, `AUTORISEE`, or `REFUSEE`.

Approving an explanation MUST NOT change an `ABSENT` attendance record to `PRESENT`.

### 4.3 Teachers page

Show all 20 teachers in a searchable list/table, sorted by subject then name.

Columns:
- Photo/initials
- Nom complet
- Matière
- Équipe (Matin or Après-midi)
- Classes assignées
- Heures de cours cette semaine
- Statut

Clicking a teacher opens a detail drawer below or on the right, without leaving the page. Show:
- Full profile
- Subject
- Teacher ID
- Email and phone
- Their weekly timetable
- Classes they teach
- Weekly lesson count
- Hours per day
- Their work shift and rest days
- Teacher absence history
- Notifications

Direction can add/edit a teacher, upload a photo, change contact details, and deactivate/reactivate an account. Do not erase historical attendance when a teacher is deactivated.

### 4.4 Students page

Show all 50 students, with search, filters and sorting.

Columns:
- Photo or initials
- Nom complet
- Code Massar
- Classe
- Numéro dans la classe
- Parent
- Téléphone du parent
- Attendance summary
- Statut

Click a student to open a student profile panel. It must show:
- Photo
- Full name
- Code Massar
- Class and class number
- Date of birth
- Parent name, phone and email
- Timetable
- Full attendance history
- Absence explanations
- Entry holds and Direction decisions
- Corrections history

Direction can add/edit a student and upload a student photo. Direction can search by name, Massar ID, class and number.

Add a CSV import flow for student lists, but do not make it necessary for the initial dataset.

### 4.5 Classes page

Show the five classes:
- TCSF1
- TCSF2
- TCSF3
- TCSF4
- TCSF5

Clicking a class opens its detail page in the same application.

At the top show:
- Full class name
- Number of students
- Class teacher/primary contact if configured
- Weekly timetable
- Subject hours summary

Below, use tabs:
- `Élèves`
- `Emploi du temps`
- `Enseignants`
- `Historique des présences`

Clicking a student opens their student profile. Clicking a teacher opens their teacher profile.

Direction can edit class information and the timetable.

### 4.6 Parents page

Show all 50 parent records in a searchable table.

Show:
- Parent name
- Linked child
- Child's Massar ID
- Class
- Email
- Phone
- Registration status
- Account status

Direction can open the parent detail, approve/reject pending registrations, deactivate/reactivate an account, and see the linked child's profile.

One parent must never see or edit another parent's child data.

### 4.7 Emploi du temps — IMPORTANT VISUAL FEATURE

This is a major part of the website.

Use the supplied image in `reference/emploi-du-temps-reference.png` as a visual reference for the timetable board. Do not copy its branding. Recreate the useful layout with the SMART CLASS colors.

The timetable page should look like a real school timetable board.

On desktop, arrange it like this:

**Top toolbar**
- Page title: `Emploi du temps`
- Search field: `Rechercher un enseignant`
- Search field: `Rechercher une classe`
- View buttons: `Jour`, `Semaine`, `Mois`
- Left and right arrows to move between weeks
- A `Aujourd'hui` button
- A settings button for timetable settings

**Left side panel (about 250 px)**
- Blue section header `ENSEIGNANTS`
- Searchable list of teacher names
- Click a teacher to show only that teacher's lessons
- Another blue section header `CLASSES / GROUPES`
- List of TCSF1–TCSF5
- Click a class to show only that class's lessons
- A clear/reset filter button

**Main timetable board**
- Day columns from `Lundi` to `Samedi`.
- No Sunday column.
- Rows for morning:
  - M1 — 08:00–09:00
  - M2 — 09:00–10:00
  - M3 — 10:00–11:00
  - M4 — 11:00–12:00
- A visible break band: `PAUSE — 12:00–14:00`.
- Rows for afternoon:
  - S1 — 14:00–15:00
  - S2 — 15:00–16:00
  - S3 — 16:00–17:00
  - S4 — 17:00–18:00
- Friday and Saturday have morning lessons only; afternoon cells must show that there are no classes.
- The grid must scroll horizontally on small screens.

**Lesson cards**
Every colored card must show:
- Subject name
- Class (for a class view)
- Teacher (when useful)
- Room
- Start and end time

Use the subject color from `seed_data/subjects.csv`. The card must remain readable with good contrast. Do not rely on color alone: always show the subject name and a readable status.

Interactions:
- Click a lesson card to open its details in a drawer.
- Direction can add a lesson.
- Direction can edit lesson subject, teacher, class, room, day and time.
- Direction can move a lesson by drag-and-drop only if the user can also do the same action with keyboard controls or an edit dialog.
- Save changes to SQLite.
- Before saving, check class conflict, teacher conflict, teacher shift, teacher daily hours, and school opening hours.
- If there is a conflict, show a French message that explains exactly what conflicts.
- Never silently overwrite another lesson.
- `Jour`, `Semaine`, and `Mois` controls must actually change the displayed view. If `Mois` is too large to show a full timetable grid, show a readable monthly summary.

### 4.8 Parent registration requests

Show:
- Pending requests first.
- Parent name.
- Child name.
- Class and number.
- Massar ID.
- Email and phone.
- Submitted date.
- Approve button.
- Reject button.

Reject requires a reason. Approve must validate that no other parent is already linked to that child. All decisions must be saved and auditable.

### 4.9 Corrections

Show attendance correction history. Direction can create a correction only with:
- Original attendance record
- New effective status
- Mandatory reason
- Current Direction user
- Current timestamp

Do NOT edit or delete the original attendance event. Save a separate append-only correction event. The UI must show both the original and corrected value.

### 4.10 Reports

Create real database-based reports:
- Attendance by class
- Attendance by student
- Attendance by subject
- Attendance by date/week/month
- Absences justified vs not justified
- Pending explanations
- Entry holds
- Parent registration requests
- Teacher workload

Allow CSV export. Exports must respect role permissions.

### 4.11 Settings

Allow Direction to edit:
- School display name
- School year
- Room list
- Subject list
- Timetable periods
- Maximum teacher hours per day (default 4)
- Logo (local image upload)

Do not offer any cloud, Firebase, ESP32 or deployment settings.

## 5. TEACHER PORTAL

Teacher sidebar:
1. `Mon tableau de bord`
2. `Mon emploi du temps`
3. `Mes classes`
4. `Mes notifications`
5. `Mon profil`

A teacher can only see:
- Their own profile.
- Their own assigned classes.
- Their own lessons.
- Rosters of their assigned classes.
- Their own attendance records and notifications.

### 5.1 Teacher dashboard

Show:
- Teacher full name
- Subject
- Current shift
- Today's lessons
- Next lesson
- Classes assigned
- Weekly hours
- Unread notifications

### 5.2 Teacher timetable board

Show the teacher's own weekly timetable in the same board style as the reference image. Lesson cards show class, subject, room and time.

### 5.3 Taking attendance

When the teacher clicks a lesson card:
- Open the roster for that class and lesson in the same page.
- Show all ten students in class order.
- Show student number, name, Massar ID, photo/initials.
- Give two clear controls: `Présent` and `Absent`.
- Show the current attendance state if it was already submitted.
- Give one button: `Valider l'appel`.

Before submission:
- Check server-side that the teacher owns this lesson.
- Check every student's access hold.
- If a student has an active hold and has not been authorized for this exact lesson, show a red/orange warning:
  `ACCÈS BLOQUÉ — cet élève attend une autorisation de la Direction.`
- Disable both Present and Absent controls for that blocked student. Do not allow the teacher to bypass it.
- Display the date and lesson that caused the hold.
- Display whether an explanation is pending, approved or refused, but do not treat explanation approval as entry authorization.

After the teacher submits attendance:
- Lock the attendance for that lesson.
- Do not let the teacher edit or submit it a second time.
- Only Direction can correct it, using the separate correction process.
- Show `Appel validé` and the submission time.

Do not let a teacher open another teacher's class or submit another teacher's lesson by changing an API URL.

## 6. PARENT PORTAL

Parent sidebar:
1. `Accueil`
2. `Emploi du temps`
3. `Présences et absences`
4. `Justifier une absence`
5. `Notifications`
6. `Mon compte`

A parent sees exactly ONE linked child.

At the top of the parent page show:
- Child photo or initials
- Student name
- Code Massar
- Class
- Number in class
- Parent's name

### 6.1 Parent timetable and attendance board

The parent must see the child's actual class timetable.

Use the same weekly grid style:
- Days Monday to Saturday.
- M1–M4 morning slots.
- Break from 12:00 to 14:00.
- S1–S4 afternoon slots.
- Friday and Saturday morning only.
- Sunday absent.

Each lesson card shows:
- Subject
- Time
- Teacher
- Room
- Attendance result for that lesson

Attendance color:
- Green = `Présent`
- Red = `Absent`
- Grey = `Non saisi`
- Orange = `Accès bloqué` (only when relevant)

Always write the text status. Color alone is not enough.

Clicking a card opens lesson details and shows its attendance record and any explanation/entry decision separately.

### 6.2 Absence explanation

A parent can submit an explanation for an absent lesson:
- Choose one of the child's absent lessons.
- Type the reason.
- Optionally attach a supporting document or image.
- Click `Envoyer à la Direction`.

The explanation is a separate record. It does not edit attendance. An approved explanation still displays `Absent — justifiée`.

A parent cannot:
- Mark attendance.
- Correct attendance.
- Approve their own explanation.
- Authorize school entry.
- View another child.
- View internal Direction notes.

### 6.3 Parent entry permission status

Show:
- Active hold or no hold.
- Which absence started the hold.
- Whether Direction has approved or refused a return.
- The exact lesson for which a return is authorized.
- The decision date and reason that can be shared with the parent.

## 7. SCHOOL RULES AND TIMETABLE MATH

There are five classes, ten students in each class.

Class IDs:
- TCSF1
- TCSF2
- TCSF3
- TCSF4
- TCSF5

Each class has 24 lessons per week, one lesson per hour.

Weekly hours per class:
- Mathématiques: 4
- Français: 3
- Arabe: 3
- Physique-Chimie: 3
- SVT (Sciences de la Vie et de la Terre): 2
- Philosophie: 2
- Histoire-Géographie: 2
- Éducation islamique: 2
- Éducation physique et sportive: 2
- Informatique: 1

Total = 24 hours per class per week.

The subject is confirmed as **SVT — Sciences de la Vie et de la Terre**. Display it as `Sciences de la Vie et de la Terre (SVT)`.

School days:
- Monday
- Tuesday
- Wednesday
- Thursday
- Friday morning only
- Saturday morning only
- Sunday: no school

School time:
- Morning: 08:00–12:00, exactly four 1-hour slots.
- Break: 12:00–14:00, no lessons.
- Afternoon: 14:00–18:00, exactly four 1-hour slots.
- No lesson outside these times.

Class timetable policy:
- A class has only one shift per day: morning OR afternoon, never both.
- The supplied weekly timetable is the source of truth for the seeded shifts.
- Each class has four one-hour lessons on each of its six school days.
- Friday and Saturday are morning only.
- No Sunday lessons.

Teacher policy:
- Each teacher can work at most 4 teaching hours per day.
- A teacher can work in the morning OR afternoon on a given day, never both.
- For the supplied initial schedule, each subject has two specialist teachers: one morning teacher and one afternoon teacher. This gives 20 teachers total and supports parallel classes in the two shifts.
- The supplied initial timetable gives each teacher a clear morning or afternoon team so the supplied timetable is conflict-free.
- In the real application, Direction must be able to configure each teacher's shift separately for each weekday. For example, a teacher may work Monday morning and Thursday afternoon, but must never work both morning and afternoon on the same day.
- When Direction changes a teacher's daily shift, validate every existing lesson and show conflicts before saving.
- No teacher can teach two classes in the same slot.
- Direction can edit work schedules later, but the same rules must always be validated.
- No teacher can be double-booked.
- A teacher may have a rest day or an empty slot.
- Do not fill an empty slot with a fake lesson.

The generated timetable in `seed_data/weekly_timetable.csv` already contains 120 lessons. Use it. Do not randomly create a second timetable that breaks its conflicts or weekly subject hours.

## 8. ATTENDANCE, ABSENCE, AND ENTRY RULES — NEVER BREAK THESE

These are separate records and decisions.

### Attendance
- A lesson attendance is either `PRESENT` or `ABSENT`.
- The teacher submits it once.
- After submission it is locked.
- Original attendance events are preserved.

### Absence explanation
- A parent submits an explanation for an absence.
- Direction may approve or reject it.
- Approval means the absence is justified.
- Approval NEVER turns `ABSENT` into `PRESENT`.
- Approval alone NEVER releases an entry hold.

### Entry hold
- When a student is marked absent, create an active entry hold.
- Every later lesson is blocked until Direction explicitly decides the return.
- A teacher cannot bypass the hold, even by clicking Present.
- A student with an active hold must show a visible warning in the teacher roster.

### Return authorization
- Direction can approve or refuse a return.
- An authorization must be linked to one specific upcoming lesson.
- The authorization is valid only for that lesson.
- If refused or still pending, the hold remains active.
- When the student attends the specifically authorized return lesson, close the hold with an audit record.
- Never convert the earlier absence to present.

### Corrections
- Only Direction can correct attendance.
- The correction requires a reason.
- Preserve the original attendance event.
- Save a new append-only correction record with old value, new value, actor and timestamp.
- Do not let a teacher or parent edit a correction record.
- Show both original and corrected data in history.

## 9. THE PROVIDED INITIAL SCHOOL DATA — USE IT AS THE STARTING DATABASE

The supplied records are the initial records to load into the local school application. Do not create a separate demo mode and do not invent shared demo users. These records are generated placeholders prepared for this project; they are NOT verified official identities, official Massar records, real contact details, or verified historical attendance. The Direction must verify and replace any incorrect generated details before the application is used operationally with real families. Display a clear, non-alarming notice in the Direction area that initial generated identity/contact/history data require verification.

The folder `seed_data/` contains:
- `classes.csv`
- `subjects.csv`
- `students.csv`
- `parents.csv`
- `teachers.csv`
- `teacher_assignments.csv`
- `teacher_work_schedule.csv`
- `weekly_timetable.csv`
- `attendance_initiale.csv`
- `absence_explanations.csv`
- `entry_decisions.csv`
- `attendance_corrections.csv`
- `parent_registration_requests.csv` (header only; no pending requests at startup)
- `teacher_absences.csv`
- `notifications.csv`
- `teacher_workload_summary.csv`
- `seed-data.json`

A separate private input file contains the one-time initial passwords:
- `private_input/COMPTES_INITIAUX_CONFIDENTIELS.csv`
- `private_input/COMPTES_INITIAUX_CONFIDENTIELS.txt`

Never put anything from `private_input/` under `public/`. Never return plaintext passwords from an API. Never log credentials. `.gitignore` already excludes `private_input/`.

Initial records:
- 5 classes.
- 50 students: 10 in each class.
- 50 parents: exactly one linked child per parent; all 50 parent accounts are provisioned and active at startup.
- 20 teachers: 10 subjects × 2 shift teams.
- 1 Direction account.
- 71 unique accounts in total: 1 Direction + 20 teachers + 50 parents.
- 120 weekly lessons: 24 per class.
- 1,200 generated initial attendance rows.
- No initial pending parent registration requests. New registration requests created later must appear in Direction's `Demandes d'inscription` page.

Login rules:
- Direction uses the unique identifier `DIR-001` and its individual password from the private credentials file.
- Each teacher uses their own `login_id` from `teachers.csv` and their own password from the private credentials file.
- Each parent uses the linked child's Code Massar as the login ID and their own password from the private credentials file.
- Do not add `administration/administration`, `teacher/teacher`, or `parent/parent` accounts.
- Students do not have login accounts or a student portal.

The supplied initial attendance records include examples of present and absent lessons, absence explanations, entry holds, lesson-specific return decisions, and a separate attendance correction. These are generated sample history records, not verified facts about real students. Preserve their semantics and keep the provenance marker `INITIAL_GENERATED_UNVERIFIED` so the Direction can identify them for validation or replacement.

Import the data idempotently on first run. On later restarts, do not duplicate or reset records. Do not overwrite user edits. Use a migration/version marker and explicit confirmation for any future full reseed. Load credentials only during the initial account-seeding step, hash with bcrypt, then keep only hashes in SQLite.

## 10. DATABASE DESIGN

Create a normalized SQLite database. At minimum, use tables for:
- users
- sessions (or SQLite session store)
- classes
- students
- parents
- teachers
- subjects
- rooms
- lessons / timetable
- attendance
- attendance_corrections
- absence_explanations
- entry_holds
- entry_decisions
- parent_registration_requests
- notifications
- uploaded_files
- school_settings
- audit_log

Use foreign keys. Add useful indexes for:
- Massar ID
- Student name
- Class
- Teacher
- Lesson date
- Attendance status
- Pending registration status

Use transactions for multi-step actions.

Do not store all application data in one giant JSON field. Use proper columns and relationships.

## 11. FILE UPLOADS

Create local folders automatically:
- `uploads/students/`
- `uploads/teachers/`
- `uploads/parents/`
- `uploads/absence-documents/`
- `uploads/school/`

Allow photo upload for students and teachers.
Allow a parent to attach a supporting file to an absence explanation.
Allow Direction to change the school logo.

Security:
- Accept only allowed image types for photos (JPEG, PNG, WebP).
- Check the real file type, not only the filename extension.
- Limit photos to 5 MB.
- Limit supporting documents to 8 MB.
- Use safe random server-side filenames.
- Do not allow executable uploads.
- Never trust a path supplied by the browser.
- Store file metadata in SQLite.
- Serve uploads safely from the same local server.

## 12. SECURITY AND PERMISSIONS

Even though this is a local-only application, implement good basic security:
- Hash passwords using bcrypt/bcryptjs.
- Store sessions in SQLite, not plain localStorage.
- Use HttpOnly and SameSite cookies.
- Regenerate session on login.
- Add logout that destroys the server session.
- Validate every request on the server.
- Add role middleware for every protected API route.
- Parents only get data for their linked child.
- Teachers only get data for their own lessons/classes.
- Direction can manage school records.
- Validate form data on the server.
- Escape user-supplied text when rendering.
- Use parameterized SQL statements.
- Add safe upload validation.
- Use same-origin requests.
- Do not expose session secrets or password hashes in API responses.
- Do not include real-world secrets or external service credentials.

## 13. USER EXPERIENCE DETAILS

Every page must have:
- A clear title.
- A useful subtitle if needed.
- A visible main action.
- Search/filter controls where a list is large.
- Loading state.
- Empty state.
- Error state.
- Success message.
- Confirmation dialog before destructive actions.
- Keyboard focus indicators.
- Responsive behavior.

No button may be decorative. Every button must work, or be disabled with a clear French explanation.

Do not use browser `alert()` as the main interface. Use small French toast messages and accessible modal dialogs.

Do not display fake numbers that are not calculated from SQLite.

## 14. PROJECT FILES AND STARTUP

Create a clean, simple project structure. You may improve this but keep it understandable:

```
SMART CLASS WEB ONLY/
  public/
    index.html
    css/
    js/
    assets/
  uploads/
    students/
    teachers/
    parents/
    absence-documents/
    school/
  data/
    smart-class.db
  seed_data/
    (the supplied CSV and JSON files)
  server.js
  package.json
  .gitignore
  README_FR.md
```

Create package scripts:
- `npm start` — start the local application.
- `npm run seed` — seed the database once or safely refresh only the initial database when explicitly requested.
- `npm run check` — run useful local checks.

The normal user should only need:

1. Open PowerShell in the project folder.
2. Run `npm install` the first time.
3. Run `npm start`.
4. Open `http://127.0.0.1:3000`.

The server must create the SQLite database and folders if they do not exist.

Do not silently erase an existing database. Never reset user data on normal startup.

README_FR.md must explain startup and how to use the unique initial accounts in simple French.

## 15. BUILD ORDER — DO THE WORK IN THIS ORDER

Do not try to build everything as one huge untested block.

### Phase 1 — Project foundation
- Inspect the supplied seed data.
- Create package.json and server.js.
- Create the SQLite schema.
- Create the one local server.
- Create login, logout and server-side permissions.
- Make the login/register screen.
- Seed the initial records once.
- Start it and confirm login works.

### Phase 2 — Shared layout
- Create the sidebar and top bar.
- Create French navigation for each role.
- Create notifications and profile menu.
- Make all navigation items work.

### Phase 3 — Direction
- Build overview.
- Build students.
- Build teachers.
- Build parents.
- Build classes.
- Build parent registration requests.
- Build absences and explanations.
- Build entry decisions.
- Build corrections.
- Build reports and settings.

### Phase 4 — Timetable
- Build the visual timetable board based on the reference image.
- Add teacher and class filters.
- Add day/week/month views.
- Add lesson detail drawer.
- Add editing and validation.
- Test all no-conflict rules.

### Phase 5 — Teacher
- Build teacher dashboard.
- Build their timetable.
- Build assigned class roster.
- Build attendance taking and locking.
- Build blocked-student warnings.
- Build notifications.

### Phase 6 — Parent
- Build linked-child dashboard.
- Build the weekly timetable with attendance colors.
- Build absence explanation form.
- Build entry permission status.
- Confirm parent cannot see another student.

### Phase 7 — Final verification
Verify:
- Direction login works.
- Teacher login works.
- Parent login works.
- Each role is redirected correctly.
- A parent only sees one child.
- A teacher only sees their own classes.
- Direction sees all 50 students, 50 parents and 20 teachers.
- All five class timetables show 24 lessons each.
- No Sunday lessons.
- No Friday/Saturday afternoon lessons.
- No lesson between 12:00 and 14:00.
- No teacher has more than 4 teaching hours per day.
- No teacher is scheduled in both shifts on the same day.
- No teacher is double-booked.
- Attendance locks after submission.
- Blocked students cannot be marked present by a teacher.
- Explanation approval does not change an absence to present.
- Direction return authorization is for one specific lesson.
- Attendance corrections preserve the original event.
- Student and teacher photo uploads work.
- Database records persist after restarting the server.
- Search by name, Massar ID, class and class number works.
- All visible text is French.

## 16. HOW TO WORK WITH THE USER

The user is a beginner and prefers small, clear steps.

- Do not make changes to the old project.
- Work only in this new project folder.
- Do not ask the user to configure Firebase or any cloud service.
- Do not ask for GitHub.
- Do not ask many questions.
- If a detail is not specified, make a sensible choice and document it.
- If you find a problem, explain it simply and fix it.
- Do not claim that a feature works until you have checked it.
- Keep the project local and private.
- Show the exact one command needed to start the finished site.

## FINAL GOAL

The user should be able to open one local link, sign in as Direction, Teacher or Parent, and use a real French school-management website.

Direction must be able to manage students, parents, teachers, classes, timetable, absences, explanations, entry permissions and reports.

Teachers must be able to view their timetable and submit attendance, with blocked students protected.

Parents must be able to see only their child, view the weekly timetable and attendance, and submit absence explanations.

Build the real working application. Do not stop after a mockup.
