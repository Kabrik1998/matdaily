import { loadAppState, markContactMessageRead, refreshAppState, removeContactMessage, saveAppState, saveTaskRecord, saveUserRecord } from "./database.js";
import { supabase } from "./supabaseClient.js";

const curriculum = [
  level(1, "Liczby", [
    topic("1.1", "Własności liczb", 5),
    topic("1.2", "Działania na liczbach", 5),
    topic("1.3", "Ułamki", 5),
    topic("1.4", "Obliczenia praktyczne", 5),
    topic("1.5", "Podsumowanie", 5)
  ]),
  level(2, "Procenty", [
    topic("2.1", "Procenty", 5),
    topic("2.2", "Obliczenia procentowe w praktyce", 5),
    topic("2.3", "Podsumowanie", 5)
  ]),
  level(3, "Algebra i równania", [
    topic("3.1", "Wyrażenia algebraiczne", 5),
    topic("3.2", "Równania", 5),
    topic("3.3", "Zadania tekstowe", 5),
    topic("3.4", "Podsumowanie", 5)
  ]),
  level(4, "Potęgi i pierwiastki", [
    topic("4.1", "Potęgi", 5),
    topic("4.2", "Pierwiastki", 5),
    topic("4.3", "Podsumowanie", 5)
  ]),
  level(5, "Planimetria", [
    topic("5.1", "Własności figur płaskich. Przystawanie figur", 5),
    topic("5.2", "Twierdzenie Pitagorasa", 5),
    topic("5.3", "Pola i obwody figur", 5),
    topic("5.4", "Układ współrzędnych", 5),
    topic("5.5", "Podsumowanie", 5)
  ]),
  level(6, "Bryły", [
    topic("6.1", "Graniastosłupy", 6),
    topic("6.2", "Ostrosłupy", 6),
    topic("6.3", "Podsumowanie", 6)
  ]),
  level(7, "Statystyka i prawdopodobieństwo", [
    topic("7.1", "Statystyka", 4),
    topic("7.2", "Rachunek prawdopodobieństwa", 4)
  ]),
  level(8, "Dowodzenie", [
    topic("8.1", "Zadania na dowodzenie", 4)
  ])
];

const flatTopics = curriculum.flatMap((item) => item.topics);
const totalCurriculumDays = flatTopics.reduce((sum, item) => sum + item.days, 0);
const today = () => new Date().toISOString().slice(0, 10);
const app = document.querySelector("#app");
const STUDENT_REMEMBER_KEY = "matdaily-remembered-student-login";
const STUDENT_REMEMBER_NEVER_KEY = "matdaily-never-ask-remember-student-password";

let state = await loadState();
let session = {
  role: "guest",
  studentId: null,
  teacherId: null,
  view: "home",
  teacherTab: "dashboard",
  loginRole: null,
  resultsClassId: null,
  resultsStudentId: null,
  teacherClassId: null,
  teacherClassResultsId: null,
  adminStudentProfileId: null,
  adminStudentProfileReturnClassId: null,
  rememberStudentPrompt: null,
  showRememberPasswordPrompt: false,
  deleteClassMode: false,
  teacherNotice: null,
  teacherLastStudent: null,
  userFilters: {},
  editRepetytoriumId: null,
  previewFullSheetId: null,
  editFullSheetId: null,
  bankOpen: {}
};
let dailyRun = null;
let miniRun = null;
let fullSheetRun = null;
let taskDraftAttachments = emptyAttachments();
let isSavingTask = false;

function level(number, name, topics) {
  topics.forEach((entry) => {
    entry.levelNumber = number;
    entry.levelName = name;
  });
  return { number, name, topics };
}

function topic(number, name, days) {
  return { id: number, number, name, days };
}

function normalizeAnswer(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

async function loadState() {
  return loadAppState(seedState, normalizeState, emptyState);
}

function normalizeState(data) {
  const progress = data.progress || {};
  Object.keys(progress).forEach((studentId) => {
    progress[studentId] = normalizeProgress(progress[studentId]);
  });
  const users = data.users || [];
  const now = new Date().toISOString();
  users.forEach((item) => {
    if (!item.createdAt) item.createdAt = now;
    if (item.isActive === undefined) item.isActive = !isInactiveByDate(item.lastActive || item.lastLogin || item.createdAt);
    if (!item.activityStatus) item.activityStatus = item.isActive ? "active" : "inactive";
  });
  (data.teachers || []).forEach((teacher) => {
    if (!teacher.status) teacher.status = "approved";
    if (!teacher.registeredAt) teacher.registeredAt = users.find((item) => item.id === teacher.userId)?.createdAt || now;
  });
  markInactiveAccounts(data);
  return {
    ...data,
    users,
    progress,
    readyMiniSheets: data.readyMiniSheets || [],
    fullSheets: data.fullSheets || [],
    repetytoriumContent: data.repetytoriumContent || [],
    contactMessages: data.contactMessages || [],
    activityLog: data.activityLog || []
  };
}

function saveState(options = {}) {
  return saveAppState(state, session.role).catch((error) => {
    console.error("Nie udało się zapisać danych MatDaily.", error);
    if (!options.silent) alert("Nie udało się zapisać danych w bazie. Sprawdź konfigurację Supabase.");
    if (options.silent) throw error;
  });
}

function seedState() {
  const tasks = buildSeedTasks();
  const progress = { "student-1": defaultProgress() };

  return {
    users: [],
    teachers: [],
    classes: [],
    students: [],
    tasks,
    progress,
    attempts: [],
    solvedTasks: [],
    dailyAccess: [],
    miniSheets: [],
    readyMiniSheets: [],
    fullSheets: [],
    repetytoriumContent: [],
    contactMessages: []
  };
}

function emptyState() {
  return {
    users: [],
    teachers: [],
    classes: [],
    students: [],
    tasks: [],
    progress: {},
    attempts: [],
    solvedTasks: [],
    dailyAccess: [],
    miniSheets: [],
    readyMiniSheets: [],
    fullSheets: [],
    repetytoriumContent: [],
    contactMessages: [],
    activityLog: []
  };
}

function user(id, role, login, password, name, extra = {}) {
  return { id, role, login, password, name, ...extra };
}

function defaultProgress() {
  return normalizeProgress({
    topicId: "1.1",
    dayInTopic: 1,
    totalWorkDays: 0,
    points: 0
  });
}

function normalizeProgress(progress) {
  return {
    topicId: progress?.topicId || "1.1",
    dayInTopic: progress?.dayInTopic || 1,
    totalWorkDays: progress?.totalWorkDays || 0,
    points: progress?.points || 0,
    gems: progress?.gems || 0,
    activityDates: progress?.activityDates || [],
    streakBonusesAwarded: progress?.streakBonusesAwarded || 0,
    sheetResults: progress?.sheetResults || []
  };
}

function buildSeedTasks() {
  const specific = [
    ["1.1", "daily", "open", "Czy liczba 24 jest parzysta?", "Sprawdź, czy dzieli się przez 2.", ["tak"]],
    ["1.1", "daily", "open", "Podaj dzielnik liczby 18 większy od 3 i mniejszy od 10.", "Wypisz dzielniki 18.", ["6", "9"]],
    ["1.1", "mini", "closed", "Najmniejsza liczba pierwsza to...", "Liczba pierwsza ma dokładnie dwa dzielniki.", ["2"]],
    ["1.1", "mini", "open", "Czy 1 jest liczbą pierwszą?", "Liczba pierwsza ma dwa dzielniki.", ["nie"]],
    ["1.2", "daily", "open", "Oblicz: 18 + 7 · 2", "Najpierw mnożenie.", ["32"]],
    ["1.2", "daily", "open", "Oblicz: 45 - 5 · 6", "Najpierw mnożenie.", ["15"]],
    ["1.3", "daily", "open", "Skróć ułamek 6/12.", "Podziel licznik i mianownik przez 6.", ["1/2", "0,5", "0.5"]],
    ["2.1", "daily", "open", "Ile to 25% z 80?", "25% to jedna czwarta.", ["20"]],
    ["2.2", "daily", "open", "Cena 100 zł wzrosła o 10%. Jaka jest nowa cena?", "Dodaj 10% ceny.", ["110", "110 zł", "110zl"]],
    ["3.1", "daily", "open", "Uprość: 2x + 3x", "Dodaj współczynniki przy x.", ["5x"]],
    ["3.2", "daily", "open", "Rozwiąż równanie x + 4 = 9.", "Odejmij 4 od obu stron.", ["5", "x=5"]],
    ["4.1", "daily", "open", "Oblicz 2^4.", "2 · 2 · 2 · 2.", ["16"]],
    ["4.2", "daily", "open", "Oblicz âš81.", "Szukasz liczby, której kwadrat to 81.", ["9"]],
    ["5.2", "daily", "open", "Trójkąt prostokątny ma przyprostokątne 3 i 4. Ile ma przeciwprostokątna?", "Użyj 3-4-5.", ["5"]],
    ["6.1", "daily", "open", "Ile wierzchołków ma prostopadłościan?", "Policz narożniki pudełka.", ["8"]],
    ["7.1", "daily", "open", "Średnia liczb 2, 4, 6 wynosi...", "Dodaj liczby i podziel przez 3.", ["4"]],
    ["8.1", "daily", "open", "Czy suma dwóch liczb parzystych jest parzysta?", "Zapisz je jako 2a i 2b.", ["tak"]]
  ];

  const generated = [];
  flatTopics.forEach((t) => {
    for (let i = 1; i <= 8; i += 1) {
      generated.push(makeTask(t.id, "daily", i % 2 ? "open" : "closed", `${t.number} Zadanie dzienne ${i}: oblicz ${i + t.levelNumber} + ${i}.`, "Dodaj składniki po kolei.", [String(i + t.levelNumber + i)]));
    }
    for (let i = 1; i <= 7; i += 1) {
      generated.push(makeTask(t.id, "mini", i <= 4 ? "closed" : "open", `${t.number} Miniarkusz ${i}: podaj wynik ${i * 2} + ${t.levelNumber}.`, "Dodaj małą liczbę do liczby parzystej.", [String(i * 2 + t.levelNumber)]));
    }
  });

  return [...specific.map((row, index) => makeTask(...row, `task-special-${index + 1}`)), ...generated];
}

function emptyAttachments() {
  return { content: [], hint: [], answers: [], solution: [] };
}

function makeTask(topicId, taskType, answerKind, content, hint, answers, id = uid("task"), solution = "", attachments = emptyAttachments()) {
  const topicData = flatTopics.find((t) => t.id === topicId);
  return {
    id,
    topicId,
    levelNumber: topicData.levelNumber,
    content,
    hint,
    solution,
    taskType,
    answerKind,
    answers,
    attachments,
    createdBy: "teacher-1"
  };
}

function splitAnswerVariants(value) {
  return String(value || "").split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function answerToString(answer) {
  if (answer && typeof answer === "object") return JSON.stringify(answer);
  return String(answer || "");
}

function currentUser() {
  if (session.role === "student") return getUserByStudent(session.studentId);
  if (session.role === "teacher") return getUserByTeacher(session.teacherId);
  if (session.role === "admin") return state.users.find((item) => item.role === "admin") || { name: "Administrator" };
  return { name: "Tryb demonstracyjny" };
}

function getUserByStudent(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  return state.users.find((item) => item.id === student.userId);
}

function getUserByTeacher(teacherId) {
  const teacher = state.teachers.find((item) => item.id === teacherId);
  return state.users.find((item) => item.id === teacher?.userId);
}

function currentTeacher() {
  return state.teachers.find((item) => item.id === session.teacherId) || null;
}

function isAdminUser() {
  return session.role === "admin" || currentUser()?.role === "admin";
}

function isTeacherApproved(teacher) {
  return !!teacher && teacher.status === "approved";
}

function teacherProfileForUser(userData) {
  if (!userData || userData.role !== "teacher") return null;
  let teacher = state.teachers.find((item) => item.userId === userData.id);
  if (teacher) return teacher;
  teacher = {
    id: userData.teacherId || `teacher-${userData.id}`,
    userId: userData.id,
    status: userData.status || "approved",
    school: userData.school || "",
    city: userData.city || "",
    note: userData.note || "",
    registeredAt: userData.createdAt || new Date().toISOString()
  };
  state.teachers.push(teacher);
  return teacher;
}

function studentProfileForUser(userData) {
  if (!userData || userData.role !== "student") return null;
  let student = state.students.find((item) => item.userId === userData.id);
  if (student) return student;
  student = {
    id: userData.studentId || `student-${userData.id}`,
    userId: userData.id,
    classId: userData.classId || null,
    teacherId: userData.teacherId || null,
    source: userData.source || "self"
  };
  state.students.push(student);
  state.progress[student.id] = state.progress[student.id] || defaultProgress();
  return student;
}

function teacherStatusLabel(status) {
  if (status === "approved") return "zaakceptowany";
  if (status === "rejected") return "odrzucony";
  return "oczekuje";
}

function teacherClassesForCurrentUser() {
  if (isAdminUser()) return state.classes;
  return state.classes.filter((classData) => classData.teacherId === session.teacherId);
}

function teacherStudentsForCurrentUser() {
  const classIds = new Set(teacherClassesForCurrentUser().map((classData) => classData.id));
  return state.students.filter((student) => classIds.has(student.classId) || student.teacherId === session.teacherId);
}

function inactiveCutoffDate() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  return cutoff;
}

function isInactiveByDate(value, cutoff = inactiveCutoffDate()) {
  return Boolean(value) && new Date(value) < cutoff;
}

function isAccountActive(userData) {
  if (!userData) return false;
  return userData.isActive !== false && userData.activityStatus !== "inactive";
}

function markInactiveAccounts(data = state) {
  const cutoff = inactiveCutoffDate();
  (data.users || []).forEach((userData) => {
    if (userData.role === "admin") return;
    const lastActive = userData.lastActive || userData.lastLogin || userData.createdAt;
    if (isInactiveByDate(lastActive, cutoff)) {
      userData.isActive = false;
      userData.activityStatus = "inactive";
    }
  });
}

function touchUserActivity(userId, type = "activity") {
  const userData = state.users.find((item) => item.id === userId);
  if (!userData) return;
  const now = new Date().toISOString();
  userData.lastActive = now;
  userData.isActive = true;
  userData.activityStatus = "active";
  if (type === "login") userData.lastLogin = now;
}

function touchCurrentUserActivity(type = "activity") {
  const userData = currentUser();
  if (userData?.id) touchUserActivity(userData.id, type);
}

function isSelfRegisteredStudent(student) {
  return student?.source === "self" || (!student?.teacherId && !student?.classId);
}

function inactiveStudentAccounts(cutoff = new Date(Date.now() - 304 * 24 * 60 * 60 * 1000)) {
  return state.students.filter((student) => {
    const userData = getUserByStudent(student.id);
    const lastActive = userData?.lastActive || userData?.lastLogin || userData?.createdAt;
    return lastActive && new Date(lastActive) < cutoff;
  });
}

function getProgress(studentId = session.studentId) {
  if (session.role === "guest") return state.progress["student-1"];
  return state.progress[studentId];
}

function getTopic(topicId) {
  return flatTopics.find((item) => item.id === topicId);
}

function getTaskAttachments(taskData, field) {
  return taskData.attachments?.[field] || [];
}

function renderImages(images, className = "task-images") {
  if (!images.length) return "";
  return `
    <div class="${className}">
      ${images.map((image, index) => `<img src="${image.dataUrl}" alt="${escapeHtml(image.name || `Załącznik ${index + 1}`)}" />`).join("")}
    </div>
  `;
}

function render() {
  const studentShellViews = new Set(["student", "fullSheetsStudent", "studentSettings"]);
  app.innerHTML = `
    <main class="shell">
      ${session.role !== "guest" && !(session.role === "student" && studentShellViews.has(session.view)) && !((session.role === "teacher" || session.role === "admin") && session.view === "teacher") ? topbar() : ""}
      ${route()}
    </main>
  `;
  bindEvents();
}

function topbar() {
  const user = currentUser();
  return `
    <header class="topbar">
      <div class="brand" role="button" data-action="home">
        <div class="logo">M</div>
        <div>
          <div class="brand-title">MatDaily</div>
          <div class="brand-subtitle">${escapeHtml(user.name)}</div>
        </div>
      </div>
      <nav class="actions">
        ${session.role === "student" || session.role === "guest" ? `<button class="btn ghost" data-view="student">Panel ucznia</button>` : ""}
        ${session.role === "teacher" || session.role === "admin" ? `<button class="btn ghost" data-view="teacher">Panel ${session.role === "admin" ? "administratora" : "nauczyciela"}</button>` : ""}
        ${session.role !== "guest" || session.view !== "home" ? `<button class="btn" data-action="logout">Wyloguj</button>` : ""}
      </nav>
    </header>
  `;
}

function route() {
  if (session.view === "login") return loginView(session.loginRole || "student");
  if (session.view === "contact") return contactView();
  if (session.view === "student") return studentDashboard();
  if (session.view === "daily") return dailyView();
  if (session.view === "mini") return miniView();
  if (session.view === "fullSheetsStudent") return studentFullSheetsView();
  if (session.view === "repetytorium") return studentRepetytoriumView();
  if (session.view === "studentSettings") return studentSettingsView();
  if (session.view === "results") return resultsView();
  if (session.view === "teacher") return teacherDashboard();
  return homeView();
}

function homeView() {
  return `
    <section class="home-screen" id="top">
      <div class="home-pattern home-pattern-left" aria-hidden="true"></div>
      <div class="home-pattern home-pattern-right" aria-hidden="true"></div>
      <header class="home-navbar">
        <a class="home-nav-brand" href="#top" aria-label="MatDaily">
          <span class="home-nav-cube" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <path d="M32 7 53 19.5v25L32 57 11 44.5v-25Z" />
              <path d="M32 7v25M11 19.5 32 32l21-12.5M32 32v25" />
              <path d="m18.5 24 13.5 8 13.5-8M18.5 40 32 48l13.5-8" />
            </svg>
          </span>
          <strong>MatDaily</strong>
        </a>
        <nav class="home-nav-links" aria-label="Nawigacja strony glownej">
          <a href="#info-platform">O platformie</a>
          <a href="#info-how">Jak dzia&#322;a</a>
          <a href="#info-teachers">Dla nauczycieli</a>
          <button type="button" data-view="contact">Kontakt</button>
        </nav>
      </header>

      <div class="home-hero">
        <div class="home-copy">
          <h1>MatDaily</h1>
          <p class="home-tagline">Codzienna matematyka <span>bez stresu.</span></p>
          <p class="home-lead compact">2 zadania dziennie. Ma&#322;e kroki. Du&#380;y post&#281;p.</p>
        </div>
        <div class="home-hero-art" aria-hidden="true">
          <div class="home-reference-visual"></div>
        </div>
      </div>

      <div class="home-role-grid" id="home-login-options">
        <article class="home-role-card student-card">
          <h2>Ucze&#324;</h2>
          <p>Zaloguj si&#281; na swoje konto, rozwi&#261;zuj zadania, zdobywaj punkty i &#347;led&#378; swoje post&#281;py.</p>
          <button class="btn primary home-login-btn" data-login="student">Logowanie ucznia &#8594;</button>
        </article>
        <article class="home-role-card teacher-card">
          <h2>Nauczyciel</h2>
          <p>Zaloguj si&#281; na konto nauczyciela, prowad&#378; klasy, uczni&#243;w i sprawdzaj ich wyniki.</p>
          <button class="btn primary home-login-btn" data-login="teacher">Logowanie nauczyciela &#8594;</button>
        </article>
        <article class="home-role-card guest-card">
          <h2>Demo</h2>
          <p>Wypr&#243;buj aplikacj&#281; bez logowania i zobacz jak dzia&#322;a MatDaily.</p>
          <button class="btn primary home-login-btn" data-action="guest">Wej&#347;cie bez logowania &#8594;</button>
        </article>
      </div>

      <div class="home-info-strip">
        ${homeInfoItem("Dwa zadania dziennie", "Kr&#243;tki trening, kt&#243;ry &#322;atwo zrobi&#263; regularnie.", "calendar")}
        ${homeInfoItem("Miniarkusze", "Szybkie zestawy do sprawdzania wiedzy w praktyce.", "file")}
        ${homeInfoItem("Post&#281;py i wyniki", "Widzisz punkty, histori&#281; i sw&#243;j rozw&#243;j.", "chart")}
        ${homeInfoItem("Bezpiecze&#324;stwo", "Dane ucznia s&#261; uporz&#261;dkowane i chronione.", "lock")}
      </div>
      ${homeInfoPanel("info-platform", "O platformie", "MatDaily to aplikacja do systematycznej nauki matematyki przed egzaminem ósmoklasisty. Ucze&#324; każdego dnia rozwiązuje krótkie zestawy zadań, utrwala najważniejsze działy i widzi swoje postępy. Aplikacja pomaga uczyć się małymi krokami, bez stresu i bez odkładania nauki na ostatnią chwilę.")}
      ${homeInfoPanel("info-how", "Jak to działa?", "Ucze&#324; codziennie wykonuje dwa zadania dopasowane do aktualnego działu. Może też rozwiązywać miniarkusze, pełne arkusze egzaminacyjne i korzystać z repetytorium. System zapisuje wyniki, punkty, poziom oraz serię dni nauki, dzięki czemu uczeń widzi, jak regularna praca przekłada się na postęp.")}
      ${homeInfoPanel("info-teachers", "Dla nauczycieli", "Nauczyciel może dodawać klasy, dodawać uczniów, widzieć wyniki uczniów oraz sprawdzać statystyki klasy i uczniów.")}
    </section>
  `;
}

function homeInfoItem(title, body, iconName) {
  return `
    <div class="home-info-item">
      <div class="home-info-dot">${icon(iconName)}</div>
      <div><strong>${title}</strong><span>${body}</span></div>
    </div>
  `;
}

function contactView() {
  return `
    <section class="contact-screen">
      <div class="home-pattern home-pattern-left" aria-hidden="true"></div>
      <div class="home-pattern home-pattern-right" aria-hidden="true"></div>
      <article class="contact-card">
        <button class="contact-back" type="button" data-action="home">Wróć</button>
        <div class="contact-brand">
          <span class="home-nav-cube" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <path d="M32 7 53 19.5v25L32 57 11 44.5v-25Z" />
              <path d="M32 7v25M11 19.5 32 32l21-12.5M32 32v25" />
              <path d="m18.5 24 13.5 8 13.5-8M18.5 40 32 48l13.5-8" />
            </svg>
          </span>
          <strong>MatDaily</strong>
        </div>
        <div class="section-head compact-head">
          <div>
            <h1>Kontakt</h1>
            <p>Masz pytanie, pomys&#322; albo chcesz zg&#322;osi&#263; problem? Napisz wiadomo&#347;&#263; do administratora platformy.</p>
          </div>
        </div>
        <form class="form contact-form" data-form-contact>
          <div class="field">
            <label>Imi&#281; / podpis</label>
            <input name="name" autocomplete="name" required />
          </div>
          <div class="field">
            <label>Adres e-mail nadawcy</label>
            <input name="email" type="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label>Tre&#347;&#263; wiadomo&#347;ci</label>
            <textarea name="message" required></textarea>
          </div>
          <button class="btn primary" type="submit">Wy&#347;lij wiadomo&#347;&#263;</button>
        </form>
      </article>
    </section>
  `;
}

function homeInfoPanel(id, title, body) {
  return `
    <aside class="home-info-panel" id="${id}" aria-labelledby="${id}-title">
      <a class="home-panel-backdrop" href="#top" aria-label="Zamknij"></a>
      <div class="home-panel-card">
        <a class="home-panel-close" href="#top" aria-label="Zamknij">×</a>
        <h2 id="${id}-title">${title}</h2>
        <p>${body}</p>
      </div>
    </aside>
  `;
}

function icon(name) {
  const icons = {
    home: `<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M4 10h16M8 15l2 2 5-5"/></svg>`,
    file: `<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg>`,
    clipboard: `<svg viewBox="0 0 24 24"><path d="M9 4h6l1 2h3v15H5V6h3z"/><path d="M9 13l2 2 4-5M9 18h6"/></svg>`,
    book: `<svg viewBox="0 0 24 24"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H20v18H7.5A3.5 3.5 0 0 0 4 23z"/><path d="M4 5.5V23M8 6h8"/></svg>`,
    chart: `<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M6 16v-4M11 16V8M16 16V5"/><path d="m6 12 5-4 5-3"/></svg>`,
    logout: `<svg viewBox="0 0 24 24"><path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4M18 12H9"/></svg>`,
    user: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>`,
    graduation: `<svg viewBox="0 0 24 24"><path d="m3 8 9-4 9 4-9 4z"/><path d="M7 10v5c3 2 7 2 10 0v-5"/><path d="M21 8v6"/></svg>`,
    rocket: `<svg viewBox="0 0 24 24"><path d="M14 4c3 0 5-1 6-2-1 5-3 10-8 14l-4-4C10 8 12 5 14 4Z"/><path d="M7 13l-3 1 3-5M11 17l-1 3 5-3"/><circle cx="15" cy="8" r="1.5"/></svg>`,
    lock: `<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
    star: `<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6-4.4-4.3 6.1-.9z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
    users: `<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    layers: `<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></svg>`,
    shield: `<svg viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-5"/></svg>`,
    mail: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15Z"/></svg>`
  };
  return icons[name] || icons.star;
}

function loginView(role) {
  const isStudent = role === "student";
  const title = isStudent? "Konto ucznia" : "Konto nauczyciela";
  const mode = session.loginMode || "login";
  return `
    <section class="auth-screen">
      <div class="auth-card">
        <button class="auth-back" type="button" data-action="home">Wróć</button>
        <div class="auth-heading">
          <span class="auth-kicker">MatDaily</span>
          <h1>${title}</h1>
        </div>
        <div class="auth-tabs" role="tablist">
          <button class="${mode === "login" ? "active" : ""}" type="button" data-auth-mode="login">Logowanie</button>
          <button class="${mode === "register" ? "active" : ""}" type="button" data-auth-mode="register">Rejestracja</button>
        </div>
        ${mode === "register" ? (isStudent? studentRegisterForm() : teacherRegisterForm()) : loginForm(role)}
      </div>
    </section>
  `;
}

function loginForm(role) {
  const rememberedStudent = role === "student" ? getRememberedStudentCredentials() : null;
  return `
    <form class="form auth-form" data-form-login="${role}" autocomplete="off" autoComplete="off" data-clear-login-form>
      <div class="grid two">
        <div class="field">
          <label>${role === "teacher" ? "Email lub login" : "Login"}</label>
          <input name="login" value="${escapeHtml(rememberedStudent?.login || "")}" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-lpignore="true" data-1p-ignore required />
        </div>
        <div class="field">
          <label>Has&#322;o</label>
          <input name="matdaily-password-field" value="${escapeHtml(rememberedStudent?.password || "")}" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="password" data-lpignore="true" data-1p-ignore required />
        </div>
      </div>
      <div class="actions">
        <button class="btn primary" type="submit">Zaloguj si&#281;</button>
      </div>
    </form>
  `;
}

function studentRegisterForm() {
  return `
    <form class="form auth-form" data-form-register-student autocomplete="off" autoComplete="off">
      <div class="grid two">
        <div class="field"><label>Imi&#281; lub nick</label><input name="name" required /></div>
        <div class="field"><label>Login</label><input name="login" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" required /></div>
        <div class="field"><label>Has&#322;o</label><input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="password" required /></div>
        <div class="field"><label>Powtórz has&#322;o</label><input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="repeat" required /></div>
      </div>
      <div class="actions"><button class="btn primary" type="submit">Zarejestruj ucznia</button></div>
    </form>
  `;
}

function teacherRegisterForm() {
  return `
    <form class="form auth-form" data-form-register-teacher autocomplete="off" autoComplete="off">
      <div class="grid two">
        <div class="field"><label>Imi&#281; i nazwisko</label><input name="name" required /></div>
        <div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" required /></div>
        <div class="field"><label>Login</label><input name="login" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" required /></div>
        <div class="field"><label>Has&#322;o</label><input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="password" required /></div>
        <div class="field"><label>Powtórz has&#322;o</label><input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="repeat" required /></div>
        <div class="field"><label>Nazwa szko&#322;y</label><input name="school" required /></div>
        <div class="field"><label>Miejscowo&#347;&#263;</label><input name="city" required /></div>
      </div>
      <div class="field"><label>Krótka informacja / uwagi <span class="muted">(opcjonalnie)</span></label><textarea name="note" class="medium-textarea"></textarea></div>
      <div class="actions"><button class="btn primary" type="submit">Wy&#347;lij zg&#322;oszenie</button></div>
    </form>
  `;
}

function studentDashboard() {
  const progress = getProgress();
  const topicData = getTopic(progress.topicId);
  const access = getAccess(session.studentId || "student-1");
  const user = currentUser();
  const isGuest = session.role === "guest";
  const firstName = (user.name || "Jan").split(" ")[0];
  const greeting = isGuest? "Witaj!" : `Witaj, ${escapeHtml(firstName)}!`;
  const userPillTitle = `Poziom ${topicData.levelNumber}`;
  const userPillSubtitle = `Temat: ${escapeHtml(topicData.name)}`;
  const progressPct = Math.min(100, Math.round((progress.points / 500) * 100));
  const streakDays = currentStreakDays(progress);
  const streakStep = streakDays % 5;
  const streakPct = streakDays? (streakStep === 0 ? 100 : (streakStep / 5) * 100) : 0;
  return `
    <section class="student-shell">
      <aside class="student-sidebar">
        <div class="student-logo" data-action="home">
          <div class="student-cube-logo" aria-hidden="true">
            <svg viewBox="0 0 72 72">
              <path d="M36 5 62 20v31L36 67 10 51V20z" />
              <path d="M36 5v31M10 20l26 16 26-16M36 36v31M10 51l26-15 26 15" />
              <path d="M23 13v31M49 13v31" />
            </svg>
          </div>
          <strong>MatDaily</strong>
        </div>
        <nav class="student-nav">
          <button class="active" data-view="student">${icon("home")}<span>Panel ucznia</span></button>
          <button data-view="daily">${icon("calendar")}<span>Dwa zadania dziennie</span></button>
          <button data-view="mini">${icon("file")}<span>Miniarkusz</span></button>
          <button data-view="fullSheetsStudent">${icon("clipboard")}<span>Arkusze egzaminacyjne</span></button>
          <button data-view="repetytorium">${icon("book")}<span>Repetytorium</span></button>
          <button data-view="results">${icon("chart")}<span>Wyniki</span></button>
          ${session.role === "student" ? `<button data-view="studentSettings">${icon("settings")}<span>Ustawienia</span></button>` : ""}
          ${session.role === "student" ? `<button data-action="logout">${icon("logout")}<span>Wyloguj</span></button>` : ""}
        </nav>
        <div class="student-sidebar-footer">MatDaily 2026</div>
      </aside>
      <div class="student-main">
        <header class="student-userbar">
          <div class="student-user-pill">
            <span class="role-icon small">${icon("user")}</span>
            <div>
              <strong>${userPillTitle}</strong>
              <span>${userPillSubtitle}</span>
            </div>
          </div>
        </header>

        <div class="student-welcome-grid">
          <div class="student-welcome">
            <div class="student-welcome-copy">
              <h1>${greeting}</h1>
              <p>Gotowy na kolejne matematyczne wyzwania?</p>
            </div>
          </div>
        </div>

        <div class="student-card-grid">
          ${studentActionCard("Dwa zadania dziennie", access.dailyDone ? "Wykonane dzisiaj. Wróć jutro po kolejną porcję." : "Każdego dnia czekają na Ciebie 2 nowe zadania.", "Rozwiąż teraz", "daily", "mint", "calendar")}
          ${studentActionCard("Miniarkusz", access.miniDone ? "Miniarkusz na dziś jest już zamknięty." : "Sprawdź swoją wiedzę w losowym miniarkuszu.", "Przejdź do miniarkusza", "mini", "violet", "file")}
          ${studentActionCard("Arkusze egzaminacyjne", "Rozwiązuj pełne arkusze egzaminacyjne z poprzednich lat.", "Rozwiąż arkusz", "fullSheetsStudent", "blue", "clipboard")}
          ${studentActionCard("Repetytorium", "Przypomnij sobie najważniejsze zagadnienia i ćwicz krok po kroku.", "Przejdź do repetytorium", "repetytorium", "orange", "book")}
          ${studentActionCard("Moje wyniki", "Sprawdź swoje postępy, punkty i historię aktywności.", "Zobacz wyniki", "results", "mint", "chart")}
        </div>

        <div class="student-progress-panel">
          <div class="progress-block">
            <div class="progress-star">${icon("star")}</div>
            <div>
              <h3>Twój postęp</h3>
              <p>Poziom ${topicData.levelNumber} · ${progress.points} / 500 pkt</p>
              <div class="progress-track"><div class="progress-bar" style="--value:${progressPct}%"></div></div>
            </div>
          </div>
          <div class="progress-block streak-block">
            <div>
              <h3>Twoja seria nauki</h3>
              <p><strong>${streakDays} ${streakLabel(streakDays)} z rzędu</strong></p>
              <div class="progress-track"><div class="progress-bar" style="--value:${streakPct}%"></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function studentActionCard(title, body, cta, view, tone, iconName) {
  return `
    <article class="student-action-card ${tone}">
      <div class="student-action-icon">${icon(iconName)}</div>
      <h3>${title}</h3>
      <p>${body}</p>
      <button class="btn" ${view ? `data-view="${view}"` : "type=\"button\""}>${cta} →</button>
    </article>
  `;
}

function studentPanelShell(activeView, content) {
  const progress = getProgress(session.studentId || "student-1");
  const topicData = getTopic(progress.topicId);
  const menu = [
    ["student", "Panel ucznia", "home"],
    ["daily", "Dwa zadania dziennie", "calendar"],
    ["mini", "Miniarkusz", "file"],
    ["fullSheetsStudent", "Arkusze egzaminacyjne", "clipboard"],
    ["repetytorium", "Repetytorium", "book"],
    ["results", "Wyniki", "chart"],
    ...(session.role === "student" ? [["studentSettings", "Ustawienia", "settings"]] : [])
  ];
  return `
    <section class="student-shell">
      <aside class="student-sidebar">
        <div class="student-logo" data-action="home">
          <div class="student-cube-logo" aria-hidden="true">
            <svg viewBox="0 0 72 72">
              <path d="M36 5 62 20v31L36 67 10 51V20z" />
              <path d="M36 5v31M10 20l26 16 26-16M36 36v31M10 51l26-15 26 15" />
              <path d="M23 13v31M49 13v31" />
            </svg>
          </div>
          <strong>MatDaily</strong>
        </div>
        <nav class="student-nav">
          ${menu.map(([view, label, iconName]) => `<button class="${activeView === view ? "active" : ""}" data-view="${view}">${icon(iconName)}<span>${label}</span></button>`).join("")}
          ${session.role === "student" ? `<button data-action="logout">${icon("logout")}<span>Wyloguj</span></button>` : ""}
        </nav>
        <div class="student-sidebar-footer">MatDaily 2026</div>
      </aside>
      <div class="student-main">
        <header class="student-userbar">
          <div class="student-user-pill compact">
            <span class="role-icon small">${icon("user")}</span>
            <div>
              <strong>Poziom ${topicData.levelNumber}</strong>
              <span>Temat: ${escapeHtml(topicData.name)}</span>
            </div>
          </div>
        </header>
        ${studentRememberPrompt()}
        ${content}
      </div>
    </section>
  `;
}

function studentRememberPrompt() {
  if (session.role !== "student" || !session.showRememberPasswordPrompt || !session.rememberStudentPrompt || localStorage.getItem(STUDENT_REMEMBER_NEVER_KEY) === "true") return "";
  return `
    <div class="student-remember-prompt">
      <div>
        <strong>Czy chcesz zapamiętać hasło na tym urządzeniu?</strong>
        <p>To ułatwi szybsze logowanie następnym razem.</p>
      </div>
      <div class="actions">
        <button class="btn primary" data-remember-student-password="yes">Tak, zapamiętaj</button>
        <button class="btn" data-remember-student-password="later">Nie teraz</button>
        <button class="btn" data-remember-student-password="never">Nigdy nie pytaj</button>
      </div>
    </div>
  `;
}

function studentSettingsView() {
  if (session.role !== "student") return blockedView("Brak dostępu", "Ustawienia są dostępne po zalogowaniu ucznia.", "student");
  return studentPanelShell("studentSettings", `
    <section class="section">
      <div class="section-head">
        <div>
          <h1>Ustawienia</h1>
          <p>Zmień hasło do swojego konta.</p>
        </div>
        <button class="btn" data-view="student">Wróć</button>
      </div>
      <div class="teacher-form-card student-settings-card">
        ${session.studentNotice ? `<div class="teacher-notice">${escapeHtml(session.studentNotice)}</div>` : ""}
        <form class="form" data-form-student-settings autocomplete="off" autoComplete="off">
          <div class="grid two">
            <div class="field">
              <label>Nowe hasło</label>
              <input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="password" required />
            </div>
            <div class="field">
              <label>Powtórz nowe hasło</label>
              <input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="repeat" required />
            </div>
          </div>
          <button class="btn primary" type="submit">Zapisz zmiany</button>
        </form>
      </div>
    </section>
  `);
}

function studentFullSheetsView() {
  const sheets = state.fullSheets || [];
  if (fullSheetRun) return studentFullSheetRunView();
  return studentPanelShell("fullSheetsStudent", `
    <section class="section">
      <div class="section-head">
        <div>
          <h1>Arkusze egzaminacyjne</h1>
          <p>Wybierz arkusz i rozwiąż go online.</p>
        </div>
        <button class="btn" data-view="student">Wróć</button>
      </div>
      <div class="task-bank">
        ${sheets.map((sheet) => `
          <article class="bank-task student-sheet-card">
            <div class="bank-task-head">
              <div>
                <h2>${escapeHtml(sheet.name)}</h2>
                <p class="muted">${escapeHtml(sheet.description || "Arkusz egzaminacyjny")} · ${sheet.tasks?.length || 0} zadań</p>
              </div>
              <button class="btn primary" data-start-full-sheet="${sheet.id}">Rozwiąż online</button>
            </div>
            ${sheet.instructions ? `<p>${escapeHtml(sheet.instructions)}</p>` : ""}
          </article>
        `).join("") || `<p class="muted">Brak dostępnych arkuszy egzaminacyjnych.</p>`}
      </div>
    </section>
  `);
}

function studentFullSheetRunView() {
  const sheet = (state.fullSheets || []).find((item) => item.id === fullSheetRun.sheetId);
  if (!sheet) {
    fullSheetRun = null;
    return studentFullSheetsView();
  }
  return studentPanelShell("fullSheetsStudent", `
    <section class="section">
      <div class="section-head">
        <div>
          <h1>${escapeHtml(sheet.name)}</h1>
          <p>${escapeHtml(sheet.description || "Arkusz egzaminacyjny")}</p>
        </div>
        <button class="btn" data-cancel-full-sheet>Wróć do arkuszy</button>
      </div>
      ${sheet.instructions ? `<div class="exam-instructions"><strong>Instrukcje dla ucznia</strong><p>${escapeHtml(sheet.instructions)}</p></div>` : ""}
      <form class="form" data-form-student-full-sheet>
        ${sheet.tasks.map((task, index) => `
          <article class="exam-task">
            <div class="exam-task-head">
              <h3>Zadanie ${index + 1}</h3>
              <span class="pill">${task.answerKind === "closed" ? "zamknięte" : "otwarte"}</span>
            </div>
            ${taskContentBlock(task)}
            ${studentAnswerControl(task)}
            ${openTaskSolutionPhotoControl(task)}
          </article>
        `).join("")}
        <button class="btn primary" type="submit">Zakończ arkusz / Sprawdź</button>
      </form>
    </section>
  `);
}

function progressPanel(progress) {
  const topicData = getTopic(progress.topicId);
  const pct = Math.round(((progress.dayInTopic - 1) / topicData.days) * 100);
  return `
    <div class="panel section">
      <div class="grid four">
        <div>
          <div class="muted">Aktualny level</div>
          <div class="metric">${topicData.levelNumber}</div>
        </div>
        <div>
          <div class="muted">Dzień tematu</div>
          <div class="metric">${progress.dayInTopic}/${topicData.days}</div>
        </div>
        <div>
          <div class="muted">Dni pracy</div>
          <div class="metric">${progress.totalWorkDays}</div>
        </div>
        <div>
          <div class="muted">Całość kursu</div>
          <div class="metric">${Math.min(totalCurriculumDays, progress.totalWorkDays)}/${totalCurriculumDays}</div>
        </div>
      </div>
      <div class="progress-track" style="margin-top: 16px;"><div class="progress-bar" style="--value:${pct}%"></div></div>
    </div>
  `;
}

function dailyView() {
  const studentId = session.studentId || "student-1";
  const access = getAccess(studentId);
  const progress = getProgress(studentId);
  const topicData = getTopic(progress.topicId);
  if (access.dailyDone) {
    return blockedView("Dwa zadania dzienne są już wykonane", "Dzisiaj zadanie dzienne jest zamknięte. Jutro aplikacja odblokuje następną parę zadań.", "student");
  }
  if (!dailyRun) dailyRun = startDailyRun(studentId);
  if (!dailyRun.currentTask) {
    return blockedView("Brakuje zadań w aktualnym temacie", "Nauczyciel może dodać więcej zadań dla tego levelu i tematu.", "student");
  }
  const feedback = dailyRun.feedback || null;
  return `
    <section class="section">
      <div class="section-head">
        <div>
          <h1>Dwa zadania dziennie</h1>
          <p>${topicData.number} ${topicData.name} · zadanie ${dailyRun.correctCount + 1} z 2</p>
        </div>
      </div>
      <div class="task-box">
        <form class="task-answer-form" data-form-daily>
          ${taskContentBlock(dailyRun.currentTask)}
          <div class="answer-row">
            ${studentAnswerControl(dailyRun.currentTask, "answer", feedback)}
            <button class="btn primary" type="submit">${feedback ? "Dalej" : "Sprawdź"}</button>
          </div>
          ${feedback ? `<div class="task-feedback ${feedback.correct ? "ok" : "no"}">${feedback.correct ? "Brawo! Bardzo dobrze!" : "Przykro mi, spróbuj jeszcze raz."}</div>` : ""}
          ${openTaskSolutionPhotoControl(dailyRun.currentTask)}
        </form>
      </div>
      <div class="footer-note">Po błędnej odpowiedzi aplikacja losuje inne zadanie z tego samego tematu.</div>
    </section>
  `;
}

function startDailyRun(studentId) {
  return {
    studentId,
    correctCount: 0,
    hadMistake: false,
    feedback: null,
    currentTask: pickDailyTask(studentId),
    usedInRun: []
  };
}

function pickDailyTask(studentId, excludeIds = []) {
  const progress = getProgress(studentId);
  const solved = new Set(state.solvedTasks.filter((item) => item.studentId === studentId).map((item) => item.taskId));
  const pool = state.tasks.filter((task) =>
    task.taskType === "daily" &&
    task.topicId === progress.topicId &&
    !solved.has(task.id) &&
    !excludeIds.includes(task.id)
  );
  return randomItem(pool);
}

function miniView() {
  const studentId = session.studentId || "student-1";
  const access = getAccess(studentId);
  if (access.miniDone) {
    return blockedView("Miniarkusz wykonany", "Dostęp do kolejnego miniarkusza wróci jutro.", "student");
  }
  if (!miniRun) miniRun = startMiniRun(studentId);
  if (!miniRun.readyMiniSheetId && miniRun.tasks.length < 6) {
    return blockedView("Brakuje zadań do miniarkusza", "Potrzebne są 4 zadania zamknięte i 2 otwarte z aktualnego tematu.", "student");
  }
  return `
    <section class="section">
      <div class="section-head">
        <div>
          <h1>Miniarkusz</h1>
          <p>${miniRun.sheetName ? escapeHtml(miniRun.sheetName) : "4 zadania zamknięte i 2 otwarte. Możesz oddać raz dziennie."}</p>
        </div>
      </div>
      <form class="form" data-form-mini>
        ${miniRun.tasks.map((task, index) => `
          <div class="mini-task">
            <strong>${index + 1}. ${task.answerKind === "closed" ? "Zadanie zamknięte" : "Zadanie otwarte"}</strong>
            ${taskContentBlock(task)}
            ${studentAnswerControl(task)}
            ${openTaskSolutionPhotoControl(task)}
          </div>
        `).join("")}
        <button class="btn primary" type="submit">Oddaj miniarkusz</button>
      </form>
    </section>
  `;
}

function startMiniRun(studentId) {
  const progress = getProgress(studentId);
  const readySheets = (state.readyMiniSheets || []).filter((sheet) => sheet.topicId === progress.topicId);
  const selectedSheet = randomItem(readySheets);
  if (selectedSheet) {
    const tasks = selectedSheet.taskIds.map((taskId) => state.tasks.find((task) => task.id === taskId)).filter(Boolean);
    if (tasks.length >= 1) {
      return {
        studentId,
        readyMiniSheetId: selectedSheet.id,
        sheetName: selectedSheet.name,
        tasks
      };
    }
  }
  const tasksForTopic = state.tasks.filter((task) => task.taskType === "mini" && task.topicId === progress.topicId);
  return {
    studentId,
    readyMiniSheetId: null,
    sheetName: null,
    tasks: [
      ...shuffle(tasksForTopic.filter((task) => task.answerKind === "closed")).slice(0, 4),
      ...shuffle(tasksForTopic.filter((task) => task.answerKind === "open")).slice(0, 2)
    ]
  };
}

function collectTaskAnswer(form, taskData) {
  return String(form.get(`answer-${taskData.id}`) || form.get("answer") || "").trim();
}

function isTrueFalseTask(taskData) {
  return taskData?.questionType === "true_false" || taskData?.questionType === "closed-true-false";
}

function isAbCdTask(taskData) {
  return taskData?.questionType === "ab_cd" || taskData?.questionType === "closed-two-answers";
}

function isDoubleChoiceTask(taskData) {
  return taskData?.questionType === "double_choice" || taskData?.questionType === "closed-double-choice";
}

function isOpenTask(taskData) {
  return taskData?.answerKind === "open" || taskData?.questionType === "open" || !taskData?.questionType;
}

function taskContentBlock(taskData) {
  if (isTrueFalseTask(taskData) || isAbCdTask(taskData)) return "";
  return `
    <div class="task-text">${escapeHtml(taskData.content)}</div>
    ${renderImages(getTaskAttachments(taskData, "content"))}
  `;
}

function answerFeedbackClass(feedback) {
  if (!feedback) return "";
  return feedback.correct ? "correct" : "incorrect";
}

function selectedFeedbackClass(feedback, isSelected) {
  if (!feedback || !isSelected) return "";
  return `selected ${answerFeedbackClass(feedback)}`;
}

function studentAnswerControl(taskData, fieldName = `answer-${taskData.id}`, feedback = null) {
  if (isDoubleChoiceTask(taskData)) {
    const steps = taskData.steps || {
      step1: { options: ["TAK", "NIE"], correct: "" },
      step2: { options: ["1", "2", "3"], correct: "" }
    };
    const selected = String(feedback?.answer || ",").split(",");
    return `
      <input type="hidden" name="${fieldName}" data-student-double-choice-value="${escapeHtml(taskData.id)}" />
      <div class="true-false-student" data-student-double-choice-group="${escapeHtml(taskData.id)}">
        <div class="true-false-part">
          <strong>KROK 1</strong>
          <div class="abcd-choice-row">
            ${(steps.step1?.options || ["TAK", "NIE"]).map((value) => `
              <button
                class="abcd-choice student-double-choice-choice ${selectedFeedbackClass(feedback, selected[0] === value)}"
                type="button"
                data-student-double-choice="${escapeHtml(value)}"
                data-step-key="step1"
                data-task-id="${escapeHtml(taskData.id)}"
                data-field-name="${escapeHtml(fieldName)}"
              >${escapeHtml(value)}</button>
            `).join("")}
          </div>
        </div>
        <div class="true-false-part">
          <strong>KROK 2</strong>
          <div class="abcd-choice-row">
            ${(steps.step2?.options || ["1", "2", "3"]).map((value) => `
              <button
                class="abcd-choice student-double-choice-choice ${selectedFeedbackClass(feedback, selected[1] === value)}"
                type="button"
                data-student-double-choice="${escapeHtml(value)}"
                data-step-key="step2"
                data-task-id="${escapeHtml(taskData.id)}"
                data-field-name="${escapeHtml(fieldName)}"
              >${escapeHtml(value)}</button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }
  if (isTrueFalseTask(taskData) || isAbCdTask(taskData)) {
    const parts = taskData.contentParts?.length ? taskData.contentParts : [
      { content: taskData.content || "", text: taskData.content || "", correct: "", options: isAbCdTask(taskData) ? ["A", "B"] : ["P", "F"] },
      { content: "", text: "", correct: "", options: isAbCdTask(taskData) ? ["C", "D"] : ["P", "F"] }
    ];
    const groupName = isAbCdTask(taskData) ? "ab-cd" : "true-false";
    const selected = String(feedback?.answer || ",").split(",");
    return `
      <input type="hidden" name="${fieldName}" data-student-two-part-value="${escapeHtml(taskData.id)}" />
      <div class="true-false-student" data-student-two-part-group="${escapeHtml(taskData.id)}">
        ${parts.slice(0, 2).map((part, index) => `
          <div class="true-false-part">
            <div class="task-text">${escapeHtml(part.content || part.text || "")}</div>
            ${renderImages(part.attachments || [], "task-images")}
            <div class="abcd-choice-row">
              ${(part.options || (groupName === "ab-cd" ? (index === 0 ? ["A", "B"] : ["C", "D"]) : ["P", "F"])).map((value) => `
                <button
                  class="abcd-choice student-two-part-choice ${selectedFeedbackClass(feedback, selected[index] === value)}"
                  type="button"
                  data-student-two-part-choice="${value}"
                  data-part-index="${index}"
                  data-task-id="${escapeHtml(taskData.id)}"
                  data-field-name="${escapeHtml(fieldName)}"
                >${value === "P" ? "Prawda" : value === "F" ? "Fałsz" : value}</button>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }
  if (taskData?.questionType !== "closed-abcd") {
    return `<input class="${answerFeedbackClass(feedback)}" name="${fieldName}" value="${escapeHtml(feedback?.answer || "")}" placeholder="Wpisz odpowiedź" autocomplete="off" required ${feedback ? "readonly" : ""} />`;
  }
  const selected = String(feedback?.answer || "").trim().toUpperCase();
  return `
    <input type="hidden" name="${fieldName}" data-student-abcd-value="${escapeHtml(taskData.id)}" />
    <div class="abcd-choice-row student-abcd-row" data-student-abcd-group="${escapeHtml(taskData.id)}">
      ${["A", "B", "C", "D"].map((option) => `
        <button
          class="abcd-choice student-abcd-choice ${selectedFeedbackClass(feedback, selected === option)}"
          type="button"
          data-student-abcd-choice="${option}"
          data-task-id="${escapeHtml(taskData.id)}"
          data-field-name="${escapeHtml(fieldName)}"
        >${option}</button>
      `).join("")}
    </div>
  `;
}

function openTaskSolutionPhotoControl(taskData) {
  if (!isOpenTask(taskData)) return "";
  return `
    <div class="open-solution-upload">
      <p class="muted">Wpisz sam wynik końcowy.</p>
    </div>
  `;
}

function resultsView() {
  const studentId = session.studentId || "student-1";
  const progress = getProgress(studentId);
  const topicData = getTopic(progress.topicId);
  const access = getAccess(studentId);
  const attempts = state.attempts.filter((item) => item.studentId === studentId).slice(-20).reverse();
  return `
    <section class="section">
      <div class="section-head">
        <div>
          <h1>Moje wyniki</h1>
          <p>${topicData.levelNumber}. ${topicData.levelName} · ${topicData.number} ${topicData.name}</p>
        </div>
        <button class="btn" data-view="student">Wróć</button>
      </div>
      <div class="grid four">
        <div class="card"><div class="muted">Punkty</div><div class="metric">${progress.points}</div></div>
        <div class="card"><div class="muted">Wykonane dni</div><div class="metric">${progress.totalWorkDays}</div></div>
        <div class="card"><div class="muted">Dwa zadania</div><span class="pill ${access.dailyDone ? "ok" : "no"}">${access.dailyDone ? "dzisiaj tak" : "dzisiaj nie"}</span></div>
        <div class="card"><div class="muted">Miniarkusz</div><span class="pill ${access.miniDone ? "ok" : "no"}">${access.miniDone ? "dzisiaj tak" : "dzisiaj nie"}</span></div>
      </div>
      <div class="panel section">
        <h2>Arkusze egzaminacyjne</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Arkusz</th><th>Wynik</th></tr></thead>
            <tbody>
              ${(progress.sheetResults || []).map((result) => `<tr>
                <td>${escapeHtml(result.date || "-")}</td>
                <td>${escapeHtml(result.sheetName || "Arkusz")}</td>
                <td>${result.correctCount || 0}/${result.total || 0}</td>
              </tr>`).join("") || `<tr><td colspan="3">Brak rozwiązanych arkuszy.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel section">
        <h2>Historia rozwiązanych zadań</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Typ</th><th>Zadanie</th><th>Odpowiedź</th><th>Wynik</th><th>Punkty</th></tr></thead>
            <tbody>
              ${attempts.map((attempt) => {
                const taskData = state.tasks.find((task) => task.id === attempt.taskId);
                return `<tr>
                  <td>${attempt.date}</td>
                  <td>${attempt.context}</td>
                  <td>${escapeHtml(taskData ? taskData.content : "Usunięte zadanie")}</td>
                  <td>${escapeHtml(attempt.answer)}</td>
                  <td><span class="pill ${attempt.correct? "ok" : "no"}">${attempt.correct? "poprawnie" : "błąd"}</span></td>
                  <td>${attempt.points}</td>
                </tr>`;
              }).join("") || `<tr><td colspan="6">Brak prób.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function studentRepetytoriumView() {
  const studentId = session.studentId || "student-1";
  const progress = getProgress(studentId);
  const currentTopic = getTopic(progress.topicId);
  const levels = curriculum.filter((levelData) => levelData.number <= currentTopic.levelNumber);
  return `
    <section class="section">
      <div class="section-head">
        <div>
          <h1>Repetytorium</h1>
          <p>Materiały uporządkowane według leveli i tematów. Aktualnie jesteś przy: ${currentTopic.number} ${escapeHtml(currentTopic.name)}.</p>
        </div>
        <button class="btn" data-view="student">Wróć</button>
      </div>
      <div class="task-bank">
        ${levels.map((levelData) => studentRepetytoriumLevel(levelData)).join("")}
      </div>
    </section>
  `;
}

function studentRepetytoriumLevel(levelData) {
  const count = (state.repetytoriumContent || []).filter((item) => item.levelNumber === levelData.number).length;
  const key = `student-rep:level:${levelData.number}`;
  return `
    <details class="bank-level" data-bank-key="${key}" ${session.bankOpen[key] ? "open" : ""}>
      <summary>Level ${levelData.number} · ${escapeHtml(levelData.name)} <span>${count} treści</span></summary>
      <div class="bank-topics">
        ${levelData.topics.map((topicData) => {
          const items = (state.repetytoriumContent || []).filter((item) => item.topicId === topicData.id);
          const topicKey = `student-rep:topic:${topicData.id}`;
          return `
            <details class="bank-topic" data-bank-key="${topicKey}" ${session.bankOpen[topicKey] ? "open" : ""}>
              <summary>${topicData.number} ${escapeHtml(topicData.name)} <span>${items.length} treści</span></summary>
              <div class="bank-task-list">
                ${items.map((item) => repetytoriumContentCard(item, false)).join("") || `<p class="muted">Brak treści w tym temacie.</p>`}
              </div>
            </details>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function teacherDashboard() {
  if (session.role !== "teacher" && session.role !== "admin") return blockedView("Brak dostępu", "Panel nauczyciela jest zabezpieczony przed kontami uczniów.", "home");
  const teacherUser = currentUser();
  const admin = isAdminUser();
  return `
    <section class="teacher-shell">
      <aside class="teacher-sidebar">
          <button class="teacher-logo" data-teacher-tab="dashboard" type="button">
            <div class="student-cube-logo" aria-hidden="true">
            <svg viewBox="0 0 72 72">
              <path d="M36 5 62 20v31L36 67 10 51V20z" />
              <path d="M36 5v31M10 20l26 16 26-16M36 36v31M10 51l26-15 26 15" />
              <path d="M23 13v31M49 13v31" />
            </svg>
          </div>
            <div>
              <strong>MatDaily</strong>
              <span>${admin ? "Panel administratora" : "Panel nauczyciela"}</span>
            </div>
          </button>
        <nav class="teacher-nav">
          ${teacherSidebarMenu(admin)}
          <button data-action="logout">${icon("logout")}<span>Wyloguj</span></button>
        </nav>
        <div class="teacher-sidebar-footer">MatDaily 2026</div>
      </aside>
      <div class="teacher-main">
        <header class="teacher-userbar">
          <div class="teacher-user-actions">
            <div class="teacher-user-pill">
              ${icon("user")}
              <div>
                <strong>${escapeHtml(teacherUser.name)}</strong>
              </div>
            </div>
          </div>
        </header>
        ${teacherTabView()}
      </div>
    </section>
  `;
}

function teacherMenuItem(id, label, iconName) {
  return `<button class="${session.teacherTab === id ? "active" : ""}" data-teacher-tab="${id}">${icon(iconName)}<span>${label}</span></button>`;
}

function teacherSidebarMenu(admin) {
  const items = admin
    ? [
        ["dashboard", "Panel główny", "home"],
        ["classes", "Klasy i uczniowie", "users"],
        ["tasks", "Zadania", "layers"],
        ["readyMini", "Miniarkusze", "clipboard"],
        ["fullSheets", "Arkusze", "book"],
        ["repetytorium", "Repetytorium", "book"],
        ["teacherVerification", "Weryfikacja nauczycieli", "shield"],
        ["teacherUsers", "Użytkownicy nauczyciele", "users"],
        ["studentUsers", "Użytkownicy uczniowie", "graduation"],
        ["messages", "Wiadomości", "mail"],
        ["settings", "Ustawienia", "settings"]
      ]
    : [
        ["dashboard", "Panel główny", "home"],
        ["classes", "Moje klasy", "users"],
        ["students", "Moi uczniowie", "graduation"],
        ["results", "Wyniki uczniów", "chart"],
        ["stats", "Statystyki", "chart"],
        ["tasks", "Zadania - podgląd", "layers"],
        ["readyMini", "Miniarkusze - podgląd", "clipboard"],
        ["fullSheets", "Arkusze - podgląd", "book"],
        ["repetytorium", "Repetytorium - podgląd", "book"],
        ["settings", "Ustawienia", "settings"]
      ];
  return items.map(([id, label, iconName]) => teacherMenuItem(id, label, iconName)).join("");
}

function teacherTabTitle() {
  const labels = {
    dashboard: "Panel nauczyciela",
    classes: "Klasy i uczniowie",
    addClass: "Dodaj klasę",
    addStudent: "Dodaj ucznia",
    tasks: "Bank zadań",
    add: "Dodaj zadanie",
    createMini: "Dodaj miniarkusz",
    miniSheets: "Miniarkusze",
    readyMini: "Miniarkusze",
    addFullSheet: "Dodaj arkusz",
    sheets: "Arkusze",
    fullSheets: "Arkusze",
    repetytorium: "Repetytorium",
    addRepetytorium: "Dodaj treść do repetytorium",
    results: "Wyniki",
    students: "Moi uczniowie",
    stats: "Statystyki",
    teacherVerification: "Weryfikacja nauczycieli",
    teacherUsers: "Użytkownicy nauczyciele",
    studentUsers: "Użytkownicy uczniowie",
    messages: "Wiadomo&#347;ci",
    visitStats: "Statystyki wejść",
    settings: "Ustawienia"
  };
  return labels[session.teacherTab] || "Panel nauczyciela";
}

function teacherTabSubtitle() {
  const labels = {
    dashboard: "Szybki dostęp do klas, zadań i wyników.",
    classes: "Zarządzaj klasami, kontami uczniów i dostępami.",
    addClass: "Utwórz nową klasę i wróć do listy uczniów.",
    addStudent: "Dodaj ucznia do klasy. Login i hasło wygenerują się automatycznie.",
    tasks: "Przeglądaj zadania dzienne i zadania do miniarkuszy według leveli oraz tematów.",
    add: "Dodaj zadanie tekstowe lub obrazkowe bez zmiany zasad sprawdzania.",
    createMini: "Zbuduj gotowy miniarkusz z dowolnej liczby zadań.",
    miniSheets: "Przeglądaj i usuwaj utworzone miniarkusze.",
    readyMini: "Przeglądaj i usuwaj utworzone miniarkusze.",
    addFullSheet: "Przygotuj szkielet pełnego arkusza egzaminacyjnego.",
    sheets: "Zobacz zapisane pełne arkusze.",
    fullSheets: "Zobacz zapisane pełne arkusze.",
    repetytorium: "Przeglądaj materiały uporządkowane według leveli i tematów.",
    addRepetytorium: "Wklej teorię, notatki, wyjaśnienia lub obrazki dla uczniów.",
    results: "Sprawdź wyniki klas i szczegóły pracy uczniów.",
    students: "Lista uczniów z Twoich klas.",
    stats: "Podsumowanie aktywności i wyników Twoich uczniów.",
    teacherUsers: "Lista wszystkich kont nauczycieli, ich statusów i aktywności.",
    studentUsers: "Samodzielnie zarejestrowani uczniowie bez kont dodanych przez nauczycieli.",
    messages: "Przegl&#261;daj wiadomo&#347;ci wys&#322;ane z formularza kontaktowego.",
    visitStats: "Analizuj wejścia na stronę według typu i okresu.",
    settings: "Zmień dane logowania i nazwę konta nauczyciela."
  };
  return labels[session.teacherTab] || "Wybierz sekcję z menu bocznego.";
}

function teacherTabView() {
  if (session.teacherTab === "dashboard") return teacherHome();
  if (session.teacherTab === "results") return teacherResults();
  if (session.teacherTab === "students") return teacherStudentsOverview();
  if (session.teacherTab === "stats") return teacherStatsOverview();
  if (session.teacherTab === "tasks") return teacherTasks();
  if (session.teacherTab === "add") return teacherAddTask();
  if (session.teacherTab === "createMini") return teacherCreateMiniSheet();
  if (session.teacherTab === "readyMini") return teacherReadyMiniSheets();
  if (session.teacherTab === "addClass") return teacherAddClassView();
  if (session.teacherTab === "addStudent") return teacherAddStudentView();
  if (session.teacherTab === "addFullSheet") return teacherAddFullSheet();
  if (session.teacherTab === "fullSheets") return teacherFullSheets();
  if (session.teacherTab === "repetytorium") return teacherRepetytorium();
  if (session.teacherTab === "addRepetytorium") return teacherAddRepetytorium();
  if (session.teacherTab === "activity") return teacherFullActivity();
  if (session.teacherTab === "visitStats") return teacherVisitStats();
  if (session.teacherTab === "teacherVerification") return teacherVerificationView();
  if (session.teacherTab === "teacherUsers") return teacherUsersView();
  if (session.teacherTab === "studentUsers") return studentUsersView();
  if (session.teacherTab === "messages") return teacherMessages();
  if (session.teacherTab === "settings") return teacherSettings();
  return teacherClasses();
}

function teacherStatCard(title, value, label, iconName) {
  return `
    <article class="teacher-stat-card">
      <span class="teacher-dashboard-icon">${icon(iconName)}</span>
      <div>
        <strong>${value}</strong>
        <span>${title}</span>
        <small>${label}</small>
      </div>
    </article>
  `;
}

function teacherAlert(label, value, iconName) {
  return `
    <div class="teacher-alert-item">
      <span>${icon(iconName)}</span>
      <div>
        <strong>${value || 0}</strong>
        <p>${label}</p>
      </div>
    </div>
  `;
}

function teacherDashboardCard(title, body, iconName, tab) {
  return `
    <button class="teacher-dashboard-card" data-teacher-tab="${tab}" type="button">
      <span class="teacher-dashboard-icon">${icon(iconName)}</span>
      <strong>${title}</strong>
      <span>${body}</span>
    </button>
  `;
}

function teacherSummaryItem(label, value) {
  return `
    <div class="card teacher-summary-item">
      <span class="muted">${label}</span>
      <strong>${value ?? 0}</strong>
    </div>
  `;
}

function teacherClasses() {
  if (session.teacherClassId) return teacherClassDetails(session.teacherClassId);
  const classes = teacherClassesForCurrentUser();
  const admin = isAdminUser();
  return `
    <div class="panel teacher-classes-panel">
      ${admin && session.deleteClassMode ? "" : `
        <div class="teacher-section-actions teacher-section-actions-only">
          <div class="actions">
            <button class="btn" data-teacher-tab="addClass">Dodaj klasę</button>
            <button class="btn" data-teacher-tab="addStudent">Dodaj ucznia</button>
            ${admin ? `<button class="btn danger" data-toggle-delete-class>Usuń klasę</button>` : ""}
          </div>
        </div>
      `}
      ${admin && session.deleteClassMode ? teacherDeleteClassPicker(classes) : `
        <div class="teacher-class-list">
          ${classes.map((classData) => teacherClassCard(classData, admin)).join("") || `<p class="muted">Brak klas. Dodaj pierwszł klasę z menu po lewej.</p>`}
        </div>
      `}
    </div>
  `;
}

function teacherClassCard(classData, admin = false) {
  const students = state.students.filter((student) => student.classId === classData.id);
  if (admin) return `
    <article class="teacher-class-card teacher-class-card-clickable" data-open-class="${classData.id}" role="button" tabindex="0" aria-label="Otwórz klasę ${escapeHtml(classData.name)}">
      <div class="bank-task-head">
        <div>
          <h2>${escapeHtml(classData.name)}</h2>
          <p class="muted">${students.length} uczniów</p>
        </div>
        <span class="teacher-class-open-hint">Otwórz klasę</span>
      </div>
    </article>
  `;
  return `
    <article class="teacher-class-card">
      <div class="bank-task-head">
        <div>
          <h2>${escapeHtml(classData.name)}</h2>
          <p class="muted">${students.length} uczniów</p>
        </div>
        <div class="actions">
          <button class="btn" data-open-class="${classData.id}">Edytuj klasę</button>
          <button class="btn danger" data-delete-class="${classData.id}">Usuń klasę</button>
        </div>
      </div>
    </article>
  `;
}

function teacherDeleteClassPicker(classes) {
  return `
    <div class="teacher-delete-class-panel">
      <div>
        <strong>Wybierz klasę do usunięcia</strong>
        <p class="muted">Klasa zostanie usunięta dopiero po potwierdzeniu.</p>
      </div>
      <div class="teacher-class-list">
        ${classes.map((classData) => {
          const students = state.students.filter((student) => student.classId === classData.id);
          return `
            <button class="teacher-class-delete-choice" data-pick-delete-class="${classData.id}" type="button">
              <span>
                <strong>${escapeHtml(classData.name)}</strong>
                <small>${students.length} uczniów</small>
              </span>
              <span>Usuń</span>
            </button>
          `;
        }).join("") || `<p class="muted">Brak klas do usunięcia.</p>`}
      </div>
      <button class="btn" data-cancel-delete-class>Wróć do listy klas</button>
    </div>
  `;
}

function teacherSettings() {
  const userData = currentUser();
  return `
    <div class="teacher-form-card">
      ${session.teacherNotice ? `<div class="teacher-notice">${escapeHtml(session.teacherNotice)}</div>` : ""}
      <h2>Ustawienia</h2>
      <p class="muted">Zmień dane konta nauczyciela.</p>
      <form class="form" data-form-teacher-settings autocomplete="off" autoComplete="off">
        <div class="field">
          <label>Imię i nazwisko</label>
          <input name="name" value="${escapeHtml(userData.name || "")}" required />
        </div>
        <div class="field">
          <label>Login</label>
          <input name="login" value="${escapeHtml(userData.login || "")}" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" required />
        </div>
        <div class="grid two">
          <div class="field">
            <label>Nowe hasło</label>
            <input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="password" />
          </div>
          <div class="field">
            <label>Powtórz nowe hasło</label>
            <input name="matdaily-password-field" type="password" autocomplete="off" autoComplete="off" autocapitalize="off" autoCapitalize="off" autocorrect="off" autoCorrect="off" spellcheck="false" spellCheck="false" data-password-role="repeat" />
          </div>
        </div>
        <button class="btn primary" type="submit">Zapisz zmiany</button>
      </form>
    </div>
  `;
}

function teacherMessages() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Wiadomości są dostępne tylko dla administratora.", "teacher");
  const messages = getContactMessages();
  return `
    <div class="panel teacher-messages-panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Wiadomo&#347;ci</h2>
          <p>Wiadomo&#347;ci wys&#322;ane przez formularz kontaktowy.</p>
        </div>
      </div>
      <div class="teacher-message-list">
        ${messages.length ? messages.map((entry) => {
          return `
            <article class="teacher-message-card ${entry.isRead ? "is-read" : "is-unread"}">
              <div class="teacher-message-head">
                <div>
                  <strong>${escapeHtml(entry.name || "Nadawca")}</strong>
                  <span>${escapeHtml(entry.email || "")}</span>
                </div>
                <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
              </div>
              <p>${escapeHtml(entry.message || "")}</p>
              <span class="muted">Status: ${entry.isRead ? "przeczytana" : "nieprzeczytana"}</span>
              <div class="actions">
                ${entry.isRead ? `<span class="teacher-read-badge">Przeczytana</span>` : `<button class="btn" data-read-contact-message="${entry.id}">Oznacz jako przeczytana</button>`}
                <button class="btn danger" data-delete-contact-message="${entry.id}">Usu&#324;</button>
              </div>
            </article>
          `;
        }).join("") : `<p class="muted">Brak wiadomo&#347;ci do wy&#347;wietlenia.</p>`}
      </div>
    </div>
  `;
}

function teacherVerificationView() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Ta sekcja jest dostępna tylko dla administratora.", "teacher");
  const teachers = state.users
    .filter((userData) => userData.role === "teacher")
    .map((userData) => ({ teacher: teacherProfileForUser(userData), userData }))
    .filter(({ teacher, userData }) => userData && teacher && (teacher.status === "pending" || userData.status === "pending"))
    .sort((a, b) => new Date(b.teacher.registeredAt || b.userData.createdAt || 0) - new Date(a.teacher.registeredAt || a.userData.createdAt || 0));
  return `
    <div class="panel teacher-messages-panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Weryfikacja nauczycieli</h2>
          <p>Zgłoszenia nauczycieli oczekujące na decyzję administratora.</p>
        </div>
      </div>
      <div class="teacher-message-list">
        ${teachers.map(({ teacher, userData }) => `
          <article class="teacher-message-card">
            <div class="teacher-message-head">
              <div>
                <strong>${escapeHtml(userData.name)}</strong>
                <span>${escapeHtml(userData.email || "-")} · login: ${escapeHtml(userData.login)}</span>
              </div>
              <time>${formatDateTime(teacher.registeredAt || userData.createdAt)}</time>
            </div>
            <p><strong>Szkoła:</strong> ${escapeHtml(teacher.school || "-")} · <strong>Miejscowość:</strong> ${escapeHtml(teacher.city || "-")}</p>
            ${teacher.note? `<p>${escapeHtml(teacher.note)}</p>` : ""}
            <div class="actions">
              <span class="pill">${teacherStatusLabel(teacher.status)}</span>
              <button class="btn" data-approve-teacher="${teacher.id}">Akceptuj</button>
              <button class="btn" data-reject-teacher="${teacher.id}">Odrzuć</button>
              <button class="btn danger" data-delete-teacher-request="${teacher.id}">Usuń</button>
            </div>
          </article>
        `).join("") || `<p class="muted">Brak zgłoszeń nauczycieli.</p>`}
      </div>
    </div>
  `;
}

function userManagementControls(kind) {
  const filters = session.userFilters || {};
  const search = filters[`${kind}Search`] || "";
  const status = filters[`${kind}Status`] || "all";
  const statusOptions = kind === "teacher"
    ? [
        ["all", "Wszyscy"],
        ["active", "Aktywni"],
        ["inactive", "Nieaktywni"],
        ["pending", "Oczekujący"],
        ["approved", "Zaakceptowani"],
        ["rejected", "Odrzuceni"]
      ]
    : [
        ["all", "Wszyscy"],
        ["active", "Aktywni"],
        ["inactive", "Nieaktywni"]
      ];
  return `
    <div class="teacher-user-tools">
      <div class="field">
        <label>Wyszukaj</label>
        <input data-user-search="${kind}" value="${escapeHtml(search)}" placeholder="Login, nazwa, e-mail..." />
      </div>
      <div class="field">
        <label>Filtr</label>
        <select data-user-status="${kind}">
          ${statusOptions.map(([value, label]) => `<option value="${value}" ${status === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>
    </div>
  `;
}

function teacherUsersView() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Ta sekcja jest dostępna tylko dla administratora.", "teacher");
  const filters = session.userFilters || {};
  const search = normalizeAnswer(filters.teacherSearch || "");
  const status = filters.teacherStatus || "all";
  const rows = state.teachers
    .map((teacher) => {
      const userData = state.users.find((item) => item.id === teacher.userId);
      const teacherClassIds = new Set(state.classes.filter((classData) => classData.teacherId === teacher.id).map((classData) => classData.id));
      const classCount = teacherClassIds.size;
      const studentCount = state.students.filter((student) => student.teacherId === teacher.id || teacherClassIds.has(student.classId)).length;
      return { teacher, userData, classCount, studentCount };
    })
    .filter(({ teacher, userData }) => {
      if (!userData || userData.role !== "teacher") return false;
      const active = isAccountActive(userData);
      if (status === "active" && !active) return false;
      if (status === "inactive" && active) return false;
      if (["pending", "approved", "rejected"].includes(status) && teacher.status !== status) return false;
      if (!search) return true;
      return normalizeAnswer(`${userData.name} ${userData.login} ${userData.email || ""} ${teacher.school || ""} ${teacher.city || ""}`).includes(search);
    })
    .sort((a, b) => new Date(b.teacher.registeredAt || b.userData?.createdAt || 0) - new Date(a.teacher.registeredAt || a.userData?.createdAt || 0));

  return `
    <div class="panel teacher-user-panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Użytkownicy nauczyciele</h2>
          <p>Wszystkie konta nauczycieli: oczekujące, zaakceptowane i odrzucone.</p>
        </div>
      </div>
      ${userManagementControls("teacher")}
      <div class="table-wrap teacher-user-table">
        <table>
          <thead>
            <tr>
              <th>Imię i nazwisko</th>
              <th>Login</th>
              <th>E-mail</th>
              <th>Szkoła</th>
              <th>Status</th>
              <th>Rejestracja</th>
              <th>Ostatnia aktywność</th>
              <th>Klasy</th>
              <th>Uczniowie</th>
              <th>Konto</th>
              <th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ teacher, userData, classCount, studentCount }) => `
              <tr>
                <td>${escapeHtml(userData.name || "-")}</td>
                <td>${escapeHtml(userData.login || "-")}</td>
                <td>${escapeHtml(userData.email || "-")}</td>
                <td>${escapeHtml(teacher.school || "-")}<br><span class="muted">${escapeHtml(teacher.city || "-")}</span></td>
                <td><span class="pill">${escapeHtml(teacher.status || "pending")}</span></td>
                <td>${formatDateTimeSafe(teacher.registeredAt || userData.createdAt)}</td>
                <td>${formatDateTimeSafe(userData.lastActive || userData.lastLogin)}</td>
                <td>${classCount}</td>
                <td>${studentCount}</td>
                <td>${isAccountActive(userData) ? "aktywne" : "nieaktywne"}</td>
                <td>
                  <div class="actions compact">
                    <button class="btn" data-approve-teacher="${teacher.id}">Akceptuj</button>
                    <button class="btn" data-reject-teacher="${teacher.id}">Odrzuć</button>
                    <button class="btn" data-edit-teacher-user="${teacher.id}">Edytuj</button>
                    <button class="btn danger" data-delete-teacher-account="${teacher.id}">Usuń konto</button>
                  </div>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="11">Brak nauczycieli do wyświetlenia.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function studentUsersView() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Ta sekcja jest dostępna tylko dla administratora.", "teacher");
  if (session.adminStudentProfileId) return adminStudentProfileView(session.adminStudentProfileId);
  const filters = session.userFilters || {};
  const search = normalizeAnswer(filters.studentSearch || "");
  const status = filters.studentStatus || "all";
  const rows = state.users
    .filter((userData) => userData.role === "student")
    .map((userData) => studentProfileForUser(userData))
    .filter(Boolean)
    .filter(isSelfRegisteredStudent)
    .map((student) => {
      const userData = state.users.find((item) => item.id === student.userId);
      const progress = normalizeProgress(state.progress[student.id]);
      const solvedCount = state.solvedTasks.filter((item) => item.studentId === student.id).length;
      const classData = state.classes.find((item) => item.id === student.classId);
      return { student, userData, progress, solvedCount, classData };
    })
    .filter(({ student, userData, classData }) => {
      if (!userData || userData.role !== "student") return false;
      const active = isAccountActive(userData);
      if (status === "active" && !active) return false;
      if (status === "inactive" && active) return false;
      if (!search) return true;
      return normalizeAnswer(`${userData.name} ${userData.login} ${classData?.name || ""} ${student.classId || ""}`).includes(search);
    })
    .sort((a, b) => new Date(b.userData.createdAt || 0) - new Date(a.userData.createdAt || 0));

  return `
    <div class="panel teacher-user-panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Użytkownicy uczniowie</h2>
          <p>Samodzielnie zarejestrowani uczniowie, którzy nie zostali dodani przez nauczyciela.</p>
        </div>
      </div>
      ${userManagementControls("student")}
      <div class="table-wrap teacher-user-table">
        <table>
          <thead>
            <tr>
              <th>Login</th>
              <th>Nick / imię</th>
              <th>Rejestracja</th>
              <th>Ostatnia aktywność</th>
              <th>Punkty</th>
              <th>Rozwiązane zadania</th>
              <th>Klasa</th>
              <th>Konto</th>
              <th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ student, userData, progress, solvedCount, classData }) => `
              <tr>
                <td>${escapeHtml(userData.login || "-")}</td>
                <td>${escapeHtml(userData.name || "-")}</td>
                <td>${formatDateTimeSafe(userData.createdAt)}</td>
                <td>${formatDateTimeSafe(userData.lastActive || userData.lastLogin)}</td>
                <td>${progress.points || 0}</td>
                <td>${solvedCount}</td>
                <td>${classData ? escapeHtml(classData.name) : "nie należy do klasy"}</td>
                <td>${isAccountActive(userData) ? "aktywne" : "nieaktywne"}</td>
                <td>
                  <div class="actions compact">
                    <button class="btn" data-edit-student-user="${student.id}">Edytuj</button>
                    <button class="btn danger" data-delete-student-account="${student.id}">Usuń konto</button>
                  </div>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="9">Brak samodzielnie zarejestrowanych uczniów.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function adminStudentProfileView(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  const userData = student ? state.users.find((item) => item.id === student.userId) : null;
  if (!student || !userData) {
    session.adminStudentProfileId = null;
    return studentUsersView();
  }
  const classData = state.classes.find((item) => item.id === student.classId);
  const progress = normalizeProgress(state.progress[student.id] || defaultProgress());
  const attempts = (state.attempts || []).filter((attempt) => attempt.studentId === student.id);
  const dailyAttempts = attempts.filter((attempt) => attempt.context === "daily");
  const miniAttempts = attempts.filter((attempt) => attempt.context === "mini");
  const sheetAttempts = attempts.filter((attempt) => attempt.context === "sheet");
  const miniSheets = (state.miniSheets || []).filter((sheet) => sheet.studentId === student.id);
  const sheetResults = progress.sheetResults || [];
  const repetytoriumEntries = getActivityEntries().filter((entry) => entry.studentId === student.id && entry.type === "repetytorium");
  const difficultTopics = studentDifficultTopics(attempts);
  const newCredentials = session.generatedStudentCredentials?.studentId === student.id ? session.generatedStudentCredentials : null;
  return `
    <div class="teacher-results-detail admin-student-profile">
      <div class="panel">
        <div class="section-head" style="margin-top:0;">
          <div>
            <h2>${escapeHtml(userData.name || "Uczeń")}</h2>
            <p>${escapeHtml(classData?.name || "konto samodzielne")} · szczegółowy profil ucznia</p>
          </div>
          <button class="btn" data-admin-student-profile-back>Wróć</button>
        </div>
        ${session.teacherNotice ? `<div class="teacher-notice">${escapeHtml(session.teacherNotice)}</div>` : ""}
        <div class="grid five teacher-metrics">
          <div class="card"><div class="muted">Imię / nick</div><div class="metric small">${escapeHtml(userData.name || "-")}</div></div>
          <div class="card"><div class="muted">Login</div><div class="metric small">${escapeHtml(userData.login || "-")}</div></div>
          <div class="card"><div class="muted">Punkty</div><div class="metric">${progress.points || 0}</div></div>
          <div class="card"><div class="muted">Utworzono</div><div class="metric small">${formatDateTimeSafe(userData.createdAt)}</div></div>
          <div class="card"><div class="muted">Ostatnia aktywność</div><div class="metric small">${formatDateTimeSafe(userData.lastActive || userData.lastLogin || (progress.activityDates || []).slice(-1)[0])}</div></div>
        </div>
      </div>

      <div class="panel">
        <h2>Aktywność w zadaniach dziennych</h2>
        <div class="grid four teacher-metrics">
          <div class="card"><div class="muted">Dni pracy</div><div class="metric">${new Set(dailyAttempts.map((item) => item.date)).size || progress.totalWorkDays || 0}</div></div>
          <div class="card"><div class="muted">Zadania</div><div class="metric">${dailyAttempts.length}</div></div>
          <div class="card"><div class="muted">Poprawnie</div><div class="metric">${dailyAttempts.filter((item) => item.correct).length}</div></div>
          <div class="card"><div class="muted">Błędnie</div><div class="metric">${dailyAttempts.filter((item) => !item.correct).length}</div></div>
        </div>
        ${studentAttemptDateTable(dailyAttempts, "Brak danych o zadaniach dziennych.")}
      </div>

      <div class="panel">
        <h2>Aktywność w miniarkuszach</h2>
        <div class="grid three teacher-metrics">
          <div class="card"><div class="muted">Miniarkusze</div><div class="metric">${miniSheets.length}</div></div>
          <div class="card"><div class="muted">Poprawnie</div><div class="metric">${miniAttempts.filter((item) => item.correct).length}</div></div>
          <div class="card"><div class="muted">Błędnie</div><div class="metric">${miniAttempts.filter((item) => !item.correct).length}</div></div>
        </div>
        ${miniSheets.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Wynik</th><th>Punkty</th></tr></thead>
              <tbody>${miniSheets.map((sheet) => `<tr><td>${escapeHtml(sheet.date || "-")}</td><td>${sheet.correctCount || 0}/${sheet.answers?.length || 0}</td><td>${sheet.points || 0}</td></tr>`).join("")}</tbody>
            </table>
          </div>
        ` : `<p class="muted">Brak danych.</p>`}
      </div>

      <div class="panel">
        <h2>Aktywność w arkuszach egzaminacyjnych</h2>
        <div class="grid three teacher-metrics">
          <div class="card"><div class="muted">Arkusze</div><div class="metric">${sheetResults.length}</div></div>
          <div class="card"><div class="muted">Poprawnie</div><div class="metric">${sheetAttempts.filter((item) => item.correct).length}</div></div>
          <div class="card"><div class="muted">Błędnie</div><div class="metric">${sheetAttempts.filter((item) => !item.correct).length}</div></div>
        </div>
        ${sheetResults.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Arkusz</th><th>Wynik</th></tr></thead>
              <tbody>${sheetResults.map((result) => `<tr><td>${escapeHtml(result.date || "-")}</td><td>${escapeHtml(result.sheetName || "-")}</td><td>${result.correctCount || 0}/${result.total || 0}</td></tr>`).join("")}</tbody>
            </table>
          </div>
        ` : `<p class="muted">Brak danych.</p>`}
      </div>

      <div class="panel">
        <h2>Repetytorium</h2>
        <p class="muted">Wejścia: ${repetytoriumEntries.length}</p>
        ${repetytoriumEntries.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Dział / temat</th><th>Szczegóły</th></tr></thead>
              <tbody>${repetytoriumEntries.map((entry) => `<tr><td>${formatDateTimeSafe(entry.createdAt)}</td><td>${escapeHtml(entry.className || "-")}</td><td>${escapeHtml(entry.details || entry.description || "-")}</td></tr>`).join("")}</tbody>
            </table>
          </div>
        ` : `<p class="muted">Brak danych.</p>`}
      </div>

      <div class="panel">
        <h2>Największe problemy ucznia</h2>
        <p>${difficultTopics ? escapeHtml(difficultTopics) : "Za mało danych, aby określić największe trudności."}</p>
      </div>

      <div class="panel">
        <h2>Dane logowania</h2>
        <p class="muted">Aktualny login: ${escapeHtml(userData.login || "-")}</p>
        ${newCredentials ? `
          <div class="generated-account">
            <strong>Nowe dane logowania zostały zapisane.</strong>
            <span>Login: ${escapeHtml(newCredentials.login)}</span>
            <span>Hasło: ${escapeHtml(newCredentials.password)}</span>
            <button class="btn" data-copy-student-credentials data-copy-login="${escapeHtml(newCredentials.login)}" data-copy-password="${escapeHtml(newCredentials.password)}">Kopiuj dane logowania</button>
          </div>
        ` : ""}
        <div class="actions">
          <button class="btn primary" data-regenerate-student-login="${student.id}">Wygeneruj nowy login i hasło</button>
        </div>
      </div>
    </div>
  `;
}

function studentAttemptDateTable(attempts, emptyText) {
  if (!attempts.length) return `<p class="muted">${emptyText}</p>`;
  const rows = Object.values(attempts.reduce((acc, attempt) => {
    const key = attempt.date || dateKey(attempt.createdAt);
    acc[key] = acc[key] || { date: key, count: 0, correct: 0, wrong: 0 };
    acc[key].count += 1;
    if (attempt.correct) acc[key].correct += 1;
    else acc[key].wrong += 1;
    return acc;
  }, {})).sort((a, b) => b.date.localeCompare(a.date));
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Liczba zadań</th><th>Wynik</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${row.count}</td><td>${row.correct} poprawnie · ${row.wrong} błędnie</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function teacherClassDetails(classId) {
  const classData = state.classes.find((item) => item.id === classId);
  if (!classData || (!isAdminUser() && classData.teacherId !== session.teacherId)) {
    session.teacherClassId = null;
    session.teacherClassResultsId = null;
    return teacherClasses();
  }
  const students = state.students.filter((student) => student.classId === classData.id);
  if (isAdminUser() && session.teacherClassResultsId === classData.id) return teacherClassResultsView(classData, students);
  const adminActions = `
    <button class="btn" data-class-back>Wróć do listy klas</button>
    <button class="btn" data-class-results="${classData.id}">Wyniki klasy</button>
    <button class="btn primary" data-print-class="${classData.id}">Drukuj loginy i hasła klasy</button>
  `;
  const teacherActions = `
    <button class="btn" data-class-back>Wróć do listy klas</button>
    <button class="btn" data-rename-class="${classData.id}">Zmień nazwę</button>
    <button class="btn primary" data-print-class="${classData.id}">Drukuj loginy i hasła klasy</button>
  `;
  return `
    <div class="teacher-results-detail">
      <div class="panel">
        <div class="section-head" style="margin-top:0;">
          <div>
            <h2>${escapeHtml(classData.name)}</h2>
            <p>${students.length} uczniów · loginy i hasła klasy</p>
          </div>
          <div class="actions">
            ${isAdminUser() ? adminActions : teacherActions}
          </div>
        </div>
        <div class="teacher-student-list">
          ${students.map((student) => {
            const userData = getUserByStudent(student.id);
            return `
              <div class="teacher-student-row">
                <div>
                  <strong>${escapeHtml(userData.name)}</strong>
                  <span>Login: ${escapeHtml(userData.login)} · Hasło: ${escapeHtml(userData.password)}</span>
                </div>
                <div class="actions">
                  <button class="btn" data-edit-student="${student.id}">Edytuj</button>
                  <button class="btn danger" data-delete-student="${student.id}">Usuń ucznia</button>
                </div>
              </div>
            `;
          }).join("") || `<p class="muted">Brak uczniów w tej klasie.</p>`}
        </div>
      </div>
    </div>
  `;
}

function teacherAddClassView() {
  return `
    <div class="teacher-section-actions teacher-section-actions-only">
      <button class="btn" data-teacher-tab="classes">Wróć</button>
    </div>
    <div class="teacher-form-card">
      ${session.teacherNotice ? `<div class="teacher-notice">${escapeHtml(session.teacherNotice)}</div>` : ""}
      <h2>Dodaj klasę</h2>
      <p class="muted">Po utworzeniu klasy możesz od razu przypisać do niej uczniów.</p>
      <form class="form" data-form-class>
        <div class="field"><label>Nazwa klasy</label><input name="name" placeholder="np. 7C" required /></div>
        <button class="btn primary" type="submit">Utwórz klasę</button>
      </form>
    </div>
  `;
}

function teacherAddStudentView() {
  const lastStudent = session.teacherLastStudent;
  return `
    <div class="teacher-section-actions teacher-section-actions-only">
      <button class="btn" data-teacher-tab="classes">Wróć</button>
    </div>
    <div class="teacher-form-card">
      ${session.teacherNotice ? `<div class="teacher-notice">${escapeHtml(session.teacherNotice)}</div>` : ""}
      <h2>Dodaj ucznia</h2>
      <p class="muted">Login i hasło zostaną wygenerowane automatycznie i będą widoczne przy uczniu w sekcji klas.</p>
      <form class="form" data-form-student>
        <div class="field"><label>Imię i nazwisko</label><input name="name" required /></div>
        <div class="field"><label>Klasa</label><select name="classId">${teacherClassesForCurrentUser().map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select></div>
        <button class="btn primary" type="submit">Dodaj i wygeneruj konto</button>
      </form>
      ${lastStudent? `
        <div class="generated-account">
          <strong>${escapeHtml(lastStudent.name)}</strong>
          <span>Klasa: ${escapeHtml(lastStudent.className)}</span>
          <span>Login: ${escapeHtml(lastStudent.login)}</span>
          <span>Hasło: ${escapeHtml(lastStudent.password)}</span>
        </div>
      ` : ""}
    </div>
  `;
}

function teacherStudentsOverview() {
  const students = teacherStudentsForCurrentUser();
  return `
    <div class="panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Moi uczniowie</h2>
          <p>Uczniowie przypisani do Twoich klas.</p>
        </div>
      </div>
      <div class="teacher-student-list">
        ${students.map((student) => {
          const userData = getUserByStudent(student.id);
          const classData = state.classes.find((item) => item.id === student.classId);
          const progress = state.progress[student.id] || defaultProgress();
          const topicData = getTopic(progress.topicId);
          return `
            <div class="teacher-student-row">
              <div>
                <strong>${escapeHtml(userData?.name || "Uczeń")}</strong>
                <span>${escapeHtml(classData?.name || "bez klasy")} · login: ${escapeHtml(userData?.login || "-")} · poziom ${topicData.levelNumber}</span>
              </div>
              <button class="btn" data-student-details="${student.id}">Szczegóły</button>
            </div>
          `;
        }).join("") || `<p class="muted">Brak uczniów do wyświetlenia.</p>`}
      </div>
    </div>
  `;
}

function teacherClassResultsView(classData, students) {
  return `
    <div class="teacher-results-detail">
      <div class="panel">
        <div class="section-head" style="margin-top:0;">
          <div>
            <h2>Wyniki klasy ${escapeHtml(classData.name)}</h2>
            <p>${students.length} uczniów · podsumowanie postępów</p>
          </div>
          <div class="actions">
            <button class="btn" data-class-results-back>Wróć do klasy</button>
            <button class="btn" data-class-back>Wróć do listy klas</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Uczeń</th>
                <th>Punkty</th>
                <th>Rozwiązane zadania</th>
                <th>Ostatnia aktywność</th>
                <th>Średnia skuteczność</th>
              </tr>
            </thead>
            <tbody>
              ${students.map((student) => {
                const userData = getUserByStudent(student.id);
                const progress = normalizeProgress(state.progress[student.id] || defaultProgress());
                const attempts = (state.attempts || []).filter((attempt) => attempt.studentId === student.id);
                const solvedCount = (state.solvedTasks || []).filter((item) => item.studentId === student.id).length || attempts.length;
                const correct = attempts.filter((attempt) => attempt.correct).length;
                const success = attempts.length ? `${Math.round((correct / attempts.length) * 100)}%` : "brak danych";
                const lastActivity = userData?.lastActive || userData?.lastLogin || (progress.activityDates || []).slice(-1)[0];
                return `
                  <tr>
                    <td>${escapeHtml(userData?.name || "Uczeń")}</td>
                    <td>${progress.points || 0}</td>
                    <td>${solvedCount}</td>
                    <td>${formatDateTimeSafe(lastActivity)}</td>
                    <td>${success}</td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="5">Brak uczniów w tej klasie.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function teacherStatsOverview() {
  const students = teacherStudentsForCurrentUser();
  const studentIds = new Set(students.map((student) => student.id));
  const attempts = (state.attempts || []).filter((attempt) => studentIds.has(attempt.studentId));
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const success = attempts.length ? Math.round((correct / attempts.length) * 100) : 0;
  const activeSevenDays = students.filter((student) => {
    const progress = state.progress[student.id] || defaultProgress();
    const cutoff = lastNDates(7)[0];
    return (progress.activityDates || []).some((date) => date >= cutoff);
  }).length;
  return `
    <div class="panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Statystyki</h2>
          <p>Podsumowanie pracy uczniów z Twoich klas.</p>
        </div>
      </div>
      <div class="grid four teacher-metrics">
        <div class="card"><div class="muted">Uczniowie</div><div class="metric">${students.length}</div></div>
        <div class="card"><div class="muted">Podejścia</div><div class="metric">${attempts.length}</div></div>
        <div class="card"><div class="muted">Skuteczność</div><div class="metric">${success}%</div></div>
        <div class="card"><div class="muted">Aktywni 7 dni</div><div class="metric">${activeSevenDays}</div></div>
      </div>
    </div>
  `;
}

function teacherResults() {
  const classes = teacherClassesForCurrentUser();
  if (!session.resultsClassId) {
    return `
      <div class="panel">
        <h2>Wyniki uczniów</h2>
        <p class="muted">Wybierz klasę, żeby zobaczyć wyniki tylko jej uczniów.</p>
        <ul class="compact-list class-list section">
          ${classes.map((classData) => {
            const studentCount = state.students.filter((student) => student.classId === classData.id).length;
            return `<li>
              <div>
                <strong>${escapeHtml(classData.name)}</strong>
                <span class="muted">${studentCount} uczniów</span>
              </div>
              <button class="btn primary" data-results-class="${classData.id}">Pokaż wyniki</button>
            </li>`;
          }).join("") || `<li>Brak klas.</li>`}
        </ul>
      </div>
    `;
  }
  const classData = classes.find((item) => item.id === session.resultsClassId);
  if (!classData) {
    session.resultsClassId = null;
    return teacherResults();
  }
  const classStudents = state.students.filter((student) => student.classId === session.resultsClassId);
  if (session.resultsStudentId) return teacherStudentDetails(session.resultsStudentId, classData);
  const classPoints = classStudents.map((student) => normalizeProgress(state.progress[student.id] || defaultProgress()).points);
  const averagePoints = classPoints.length ? Math.round(classPoints.reduce((sum, points) => sum + points, 0) / classPoints.length) : 0;
  const activeToday = classStudents.filter((student) => {
    const access = getAccess(student.id);
    return access.dailyDone || access.miniDone;
  }).length;
  return `
    <div class="panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Wyniki klasy ${escapeHtml(classData ? classData.name : "")}</h2>
          <p>Widoczni są tylko uczniowie z wybranej klasy.</p>
        </div>
        <button class="btn" data-results-back>Wróć do listy klas</button>
      </div>
      <div class="grid four teacher-metrics">
        <div class="card"><div class="muted">Uczniowie</div><div class="metric">${classStudents.length}</div></div>
        <div class="card"><div class="muted">Średnie punkty</div><div class="metric">${averagePoints}</div></div>
        <div class="card"><div class="muted">Aktywni dziś</div><div class="metric">${activeToday}</div></div>
        <div class="card"><div class="muted">Miniarkusze</div><div class="metric">${state.miniSheets.filter((sheet) => classStudents.some((student) => student.id === sheet.studentId)).length}</div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Uczeń</th><th>Login</th><th>Level</th><th>Temat</th><th>Punkty</th><th>Dni</th><th>Miniarkusze</th><th>Arkusze</th><th>Seria</th><th></th></tr></thead>
          <tbody>${classStudents.map((student) => {
            const userData = getUserByStudent(student.id);
            const progress = normalizeProgress(state.progress[student.id] || defaultProgress());
            const topicData = getTopic(progress.topicId);
            const miniCount = state.miniSheets.filter((sheet) => sheet.studentId === student.id).length;
            return `<tr>
              <td>${escapeHtml(userData.name)}</td>
              <td>${escapeHtml(userData.login)}</td>
              <td>${topicData.levelNumber}</td>
              <td>${topicData.number} ${escapeHtml(topicData.name)}</td>
              <td>${progress.points}</td>
              <td>${progress.totalWorkDays}</td>
              <td>${miniCount}</td>
              <td>0</td>
              <td>${currentStreakDays(progress)} dni</td>
              <td><button class="btn" data-results-student="${student.id}">Szczegóły</button></td>
            </tr>`;
          }).join("") || `<tr><td colspan="10">Brak uczniów w tej klasie.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function teacherStudentDetails(studentId, classData) {
  const student = state.students.find((item) => item.id === studentId);
  const userData = student? getUserByStudent(student.id) : null;
  const progress = normalizeProgress(state.progress[studentId] || defaultProgress());
  const topicData = getTopic(progress.topicId);
  const attempts = state.attempts.filter((attempt) => attempt.studentId === studentId);
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const wrong = attempts.filter((attempt) => !attempt.correct).length;
  const total = correct + wrong;
  const success = total ? Math.round((correct / total) * 100) : null;
  const miniCount = state.miniSheets.filter((sheet) => sheet.studentId === studentId).length;
  const difficultTopics = studentDifficultTopics(attempts);
  return `
    <div class="teacher-results-detail">
      <div class="panel">
        <div class="section-head" style="margin-top:0;">
          <div>
            <h2>${escapeHtml(userData ? userData.name : "Uczeń")}</h2>
            <p>${escapeHtml(classData ? classData.name : "")} · login: ${escapeHtml(userData ? userData.login : "-")}</p>
          </div>
          <button class="btn" data-results-class-back>Wróć do klasy</button>
        </div>
        <div class="grid four teacher-metrics">
          <div class="card"><div class="muted">Level</div><div class="metric">${topicData.levelNumber}</div></div>
          <div class="card"><div class="muted">Punkty</div><div class="metric">${progress.points}</div></div>
          <div class="card"><div class="muted">Miniarkusze</div><div class="metric">${miniCount}</div></div>
          <div class="card"><div class="muted">Seria</div><div class="metric">${currentStreakDays(progress)}</div></div>
        </div>
        <p class="muted">Aktualny temat: ${topicData.number} ${escapeHtml(topicData.name)} · wykonane dni: ${progress.totalWorkDays} · miniarkusze: ${miniCount} · arkusze: 0</p>
      </div>
      <div class="panel">
        <h2>Statystyki ucznia</h2>
        ${total ? `
          <div class="grid four teacher-metrics">
            <div class="card"><div class="muted">Skuteczność</div><div class="metric">${success}%</div></div>
            <div class="card"><div class="muted">Poprawne</div><div class="metric">${correct}</div></div>
            <div class="card"><div class="muted">Błędne</div><div class="metric">${wrong}</div></div>
            <div class="card"><div class="muted">Aktywność</div><div class="metric">${progress.activityDates.length}</div></div>
          </div>
          <p><strong>Najtrudniejsze tematy:</strong> ${difficultTopics || "Brak wyraźnych trudności."}</p>
          <p><strong>Tematy wymagające powtórki:</strong> ${difficultTopics || "Brak danych do wskazania powtórki."}</p>
        ` : `<p class="muted">Brak wystarczających danych do statystyk.</p>`}
      </div>
      <div class="panel">
        <h2>Historia aktywności</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Tryb</th><th>Zadanie</th><th>Odpowiedź</th><th>Wynik</th><th>Punkty</th></tr></thead>
            <tbody>${attempts.slice().reverse().map((attempt) => {
              const task = state.tasks.find((item) => item.id === attempt.taskId);
              return `<tr>
                <td>${attempt.date}</td>
                <td>${attempt.context === "daily" ? "zadania dzienne" : attempt.context === "sheet" ? "arkusz" : "miniarkusz"}</td>
                <td>${escapeHtml(task ? task.content || "Zadanie obrazkowe" : "-")}</td>
                <td>${escapeHtml(attempt.answer)}</td>
                <td><span class="pill ${attempt.correct? "ok" : "no"}">${attempt.correct? "dobrze" : "źle"}</span></td>
                <td>${attempt.points}</td>
              </tr>`;
            }).join("") || `<tr><td colspan="6">Brak aktywności.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function studentDifficultTopics(attempts) {
  const wrongByTopic = attempts.filter((attempt) => !attempt.correct).reduce((acc, attempt) => {
    const task = state.tasks.find((item) => item.id === attempt.taskId);
    if (!task) return acc;
    const topicData = getTopic(task.topicId);
    const key = `${topicData.number} ${topicData.name}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(wrongByTopic)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${escapeHtml(name)} (${count})`)
    .join(", ");
}

function teacherTasks() {
  return `
    <div class="panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Bank zadań</h2>
          <p>Zadania uporządkowane według leveli i tematów.</p>
        </div>
        ${isAdminUser() ? `<button class="btn primary" data-teacher-tab="add">Dodaj zadanie</button>` : ""}
      </div>
      <div class="task-bank">
        ${teacherTaskBankSection("daily", "Zadania dzienne")}
        ${teacherTaskBankSection("mini", "Zadania do miniarkuszy")}
      </div>
    </div>
  `;
}

function teacherTaskBankSection(taskType, label) {
  const count = state.tasks.filter((task) => task.taskType === taskType).length;
  const key = `section:${taskType}`;
  return `
    <details class="bank-level bank-section" data-bank-key="${key}" ${session.bankOpen[key] ? "open" : ""}>
      <summary>${label} <span>${count} zadań</span></summary>
      <div class="bank-topics">
        ${curriculum.map((levelData) => teacherTaskBankLevel(levelData, taskType)).join("")}
      </div>
    </details>
  `;
}

function taskQuestionTypeLabel(task) {
  return {
    "closed-abcd": "zamknięte a,b,c,d",
    ab_cd: "zamknięte A,B lub C,D",
    true_false: "zamknięte Prawda/Fałsz",
    "closed-true-false": "zamknięte Prawda/Fałsz",
    "closed-two-answers": "zamknięte A,B lub C,D",
    double_choice: "zamknięte podwójny wybór",
    "closed-double-choice": "zamknięte podwójny wybór",
    open: "otwarte"
  }[task?.questionType || "open"] || (task?.answerKind === "closed" ? "zamknięte" : "otwarte");
}

function bankTaskBody(task, levelData, topicData) {
  const place = `<div><span class="muted">Miejsce</span><p>Level ${levelData.number} · ${escapeHtml(levelData.name)} · ${topicData.number} ${escapeHtml(topicData.name)}</p></div>`;
  if (isTrueFalseTask(task) || isAbCdTask(task)) {
    const parts = task.contentParts?.length ? task.contentParts : [
      { content: task.content || "", text: task.content || "", correct: "" },
      { content: "", text: "", correct: "" }
    ];
    return `
      ${place}
      ${parts.slice(0, 2).map((part, index) => `
        <div><span class="muted">Treść ${index + 1}</span><p>${escapeHtml(part.content || part.text || "")}</p></div>
        ${renderImages(part.attachments || [], "task-images bank-images")}
      `).join("")}
      <div><span class="muted">Poprawna odpowiedź</span><p>${escapeHtml(task.correctAnswer || (task.answers || []).join("; "))}</p></div>
      <div><span class="muted">Rozwiązanie</span><p>${escapeHtml(task.solution || "Brak dodatkowego rozwiązania.")}</p></div>
      ${renderImages(getTaskAttachments(task, "solution"), "task-images bank-images")}
    `;
  }
  if (isDoubleChoiceTask(task)) {
    return `
      ${place}
      <div><span class="muted">Treść</span><p>${escapeHtml(task.content)}</p></div>
      ${renderImages(getTaskAttachments(task, "content"), "task-images bank-images")}
      <div><span class="muted">Poprawna odpowiedź</span><p>${escapeHtml(task.correctAnswer || (task.answers || []).join("; "))}</p></div>
      <div><span class="muted">Rozwiązanie</span><p>${escapeHtml(task.solution || "Brak dodatkowego rozwiązania.")}</p></div>
      ${renderImages(getTaskAttachments(task, "solution"), "task-images bank-images")}
    `;
  }
  const answerText = task.correctAnswer || (task.answers || []).join("; ");
  return `
    ${place}
    <div><span class="muted">Treść</span><p>${escapeHtml(task.content)}</p></div>
    ${renderImages(getTaskAttachments(task, "content"), "task-images bank-images")}
    <div><span class="muted">Wskazówka</span><p>${escapeHtml(task.hint)}</p></div>
    ${renderImages(getTaskAttachments(task, "hint"), "task-images bank-images")}
    <div><span class="muted">Poprawna odpowiedź</span><p>${escapeHtml(answerText)}</p></div>
    <div><span class="muted">Rozwiązanie</span><p>${escapeHtml(task.solution || "Brak dodatkowego rozwiązania.")}</p></div>
    ${renderImages(getTaskAttachments(task, "solution"), "task-images bank-images")}
  `;
}

function teacherTaskBankLevel(levelData, taskType) {
  const levelTaskCount = state.tasks.filter((task) => task.levelNumber === levelData.number && task.taskType === taskType).length;
  const key = `${taskType}:level:${levelData.number}`;
  return `
    <details class="bank-level" data-bank-key="${key}" ${session.bankOpen[key] ? "open" : ""}>
      <summary>Level ${levelData.number} · ${escapeHtml(levelData.name)} <span>${levelTaskCount} zadań</span></summary>
      <div class="bank-topics">
        ${levelData.topics.map((topicData) => {
          const tasks = state.tasks.filter((task) => task.topicId === topicData.id && task.taskType === taskType);
          const topicKey = `${taskType}:topic:${topicData.id}`;
          return `
            <details class="bank-topic" data-bank-key="${topicKey}" ${session.bankOpen[topicKey] ? "open" : ""}>
              <summary>${topicData.number} ${escapeHtml(topicData.name)} <span>${tasks.length} zadań</span></summary>
              <div class="bank-task-list">
                ${tasks.map((task, index) => `
                  <article class="bank-task">
                    <div class="bank-task-head">
                      <strong>Zadanie ${index + 1}</strong>
                      <div class="actions">
                        <span class="pill">${task.taskType === "daily" ? "dzienne" : "miniarkusz"}</span>
                        <span class="pill">${escapeHtml(taskQuestionTypeLabel(task))}</span>
                      </div>
                    </div>
                    <div class="bank-task-body">
                      ${bankTaskBody(task, levelData, topicData)}
                    </div>
                    ${isAdminUser() ? `<div class="actions"><button class="btn" data-edit-task="${task.id}">Edytuj</button><button class="btn danger" data-delete-task="${task.id}">Usuń zadanie</button></div>` : ""}
                  </article>
                `).join("") || `<p class="muted">Brak zadań w tym temacie.</p>`}
              </div>
            </details>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function teacherAddTask() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Dodawanie zadań jest dostępne tylko dla administratora.", "teacher");
  const editTask = session.editTaskId ? state.tasks.find((task) => task.id === session.editTaskId) : null;
  const editQuestionType = editTask?.questionType || "open";
  const editIsTrueFalse = editQuestionType === "true_false" || editQuestionType === "closed-true-false";
  const editIsAbCd = editQuestionType === "ab_cd" || editQuestionType === "closed-two-answers";
  const editIsDoubleChoice = editQuestionType === "double_choice" || editQuestionType === "closed-double-choice";
  const editTrueFalseParts = editTask?.contentParts || [{ content: "", text: "", correct: "" }, { content: "", text: "", correct: "" }];
  const editAbCdParts = editTask?.contentParts || [
    { content: "", text: "", options: ["A", "B"], correct: "" },
    { content: "", text: "", options: ["C", "D"], correct: "" }
  ];
  const editDoubleChoiceSteps = editTask?.steps || {
    step1: { options: ["TAK", "NIE"], correct: "" },
    step2: { options: ["1", "2", "3"], correct: "" }
  };
  const selectedTopicId = editTask?.topicId || flatTopics[0].id;
  const selectedTopic = getTopic(selectedTopicId);
  if (editTask) {
    taskDraftAttachments.content = JSON.parse(JSON.stringify(getTaskAttachments(editTask, "content")));
    taskDraftAttachments.solution = JSON.parse(JSON.stringify(getTaskAttachments(editTask, "solution")));
    taskDraftAttachments.trueFalseText1 = JSON.parse(JSON.stringify(editTrueFalseParts[0]?.attachments || []));
    taskDraftAttachments.trueFalseText2 = JSON.parse(JSON.stringify(editTrueFalseParts[1]?.attachments || []));
    taskDraftAttachments.abCdText1 = JSON.parse(JSON.stringify(editAbCdParts[0]?.attachments || []));
    taskDraftAttachments.abCdText2 = JSON.parse(JSON.stringify(editAbCdParts[1]?.attachments || []));
  }
  return `
    <div class="panel">
      <h2>${editTask ? "Edytuj zadanie" : "Dodaj zadanie"}</h2>
      <form class="form" data-form-task>
        ${editTask ? `<input type="hidden" name="id" value="${escapeHtml(editTask.id)}" />` : ""}
        <div class="grid two">
          <div class="field"><label>Do którego levelu dodać zadanie?</label><select name="levelNumber" data-task-level>${curriculum.map((levelData) => `<option value="${levelData.number}" ${levelData.number === selectedTopic.levelNumber ? "selected" : ""}>Level ${levelData.number} - ${escapeHtml(levelData.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Do którego tematu dodać zadanie?</label><select name="topicId" data-task-topic>${flatTopics.map((t) => `<option value="${t.id}" data-level="${t.levelNumber}" ${t.id === selectedTopicId ? "selected" : ""}>${t.number} ${escapeHtml(t.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Typ zadania</label><select name="taskType"><option value="daily" ${editTask?.taskType === "daily" ? "selected" : ""}>Zadanie dzienne</option><option value="mini" ${editTask?.taskType === "mini" ? "selected" : ""}>Zadanie do miniarkusza</option></select></div>
          <div class="field"><label>Rodzaj</label><select name="questionType" data-task-question-type>
            <option value="closed-abcd" ${editTask?.questionType === "closed-abcd" ? "selected" : ""}>zamknięte a,b,c,d</option>
            <option value="true_false" ${editIsTrueFalse ? "selected" : ""}>zamknięte Prawda/Fałsz</option>
            <option value="ab_cd" ${editIsAbCd ? "selected" : ""}>zamknięte A,B lub C,D</option>
            <option value="double_choice" ${editIsDoubleChoice ? "selected" : ""}>zamknięte podwójny wybór</option>
            <option value="open" ${!editTask?.questionType || editTask?.questionType === "open" ? "selected" : ""}>otwarte</option>
          </select></div>
        </div>
        ${pasteField("content", "Treść zadania", "large-textarea", "Wklej treść zadania albo obrazek.", true, editTask?.content || "")}
        <div class="field true-false-builder" data-answer-true-false-field hidden>
          ${pasteField("trueFalseText1", "Treść 1", "medium-textarea", "Wklej pierwszą część zadania albo obrazek.", true, editTrueFalseParts[0]?.content || editTrueFalseParts[0]?.text || "")}
          <input type="hidden" name="trueFalseCorrect1" value="${escapeHtml(editIsTrueFalse ? editTrueFalseParts[0]?.correct || "" : "")}" />
          <div class="abcd-choice-row">
            ${["P", "F"].map((value) => `<button class="abcd-choice ${editIsTrueFalse && editTrueFalseParts[0]?.correct === value ? "selected" : ""}" type="button" data-admin-true-false-choice="${value}" data-part-index="1">${value === "P" ? "Prawda" : "Fałsz"}</button>`).join("")}
          </div>
          ${pasteField("trueFalseText2", "Treść 2", "medium-textarea", "Wklej drugą część zadania albo obrazek.", true, editTrueFalseParts[1]?.content || editTrueFalseParts[1]?.text || "")}
          <input type="hidden" name="trueFalseCorrect2" value="${escapeHtml(editIsTrueFalse ? editTrueFalseParts[1]?.correct || "" : "")}" />
          <div class="abcd-choice-row">
            ${["P", "F"].map((value) => `<button class="abcd-choice ${editIsTrueFalse && editTrueFalseParts[1]?.correct === value ? "selected" : ""}" type="button" data-admin-true-false-choice="${value}" data-part-index="2">${value === "P" ? "Prawda" : "Fałsz"}</button>`).join("")}
          </div>
        </div>
        <div class="field true-false-builder" data-answer-ab-cd-field hidden>
          ${pasteField("abCdText1", "Treść 1", "medium-textarea", "Wklej pierwszą część zadania albo obrazek.", true, editAbCdParts[0]?.content || editAbCdParts[0]?.text || "")}
          <input type="hidden" name="abCdCorrect1" value="${escapeHtml(editIsAbCd ? editAbCdParts[0]?.correct || "" : "")}" />
          <div class="abcd-choice-row">
            ${["A", "B"].map((value) => `<button class="abcd-choice ${editIsAbCd && editAbCdParts[0]?.correct === value ? "selected" : ""}" type="button" data-admin-ab-cd-choice="${value}" data-part-index="1">${value}</button>`).join("")}
          </div>
          ${pasteField("abCdText2", "Treść 2", "medium-textarea", "Wklej drugą część zadania albo obrazek.", true, editAbCdParts[1]?.content || editAbCdParts[1]?.text || "")}
          <input type="hidden" name="abCdCorrect2" value="${escapeHtml(editIsAbCd ? editAbCdParts[1]?.correct || "" : "")}" />
          <div class="abcd-choice-row">
            ${["C", "D"].map((value) => `<button class="abcd-choice ${editIsAbCd && editAbCdParts[1]?.correct === value ? "selected" : ""}" type="button" data-admin-ab-cd-choice="${value}" data-part-index="2">${value}</button>`).join("")}
          </div>
        </div>
        <div class="field true-false-builder" data-answer-double-choice-field hidden>
          <strong>KROK 1</strong>
          <input type="hidden" name="doubleChoiceStep1" value="${escapeHtml(editIsDoubleChoice ? editDoubleChoiceSteps.step1?.correct || "" : "")}" />
          <div class="abcd-choice-row">
            ${["TAK", "NIE"].map((value) => `<button class="abcd-choice ${editIsDoubleChoice && editDoubleChoiceSteps.step1?.correct === value ? "selected" : ""}" type="button" data-admin-double-choice="${value}" data-step-key="step1">${value}</button>`).join("")}
          </div>
          <strong>KROK 2</strong>
          <input type="hidden" name="doubleChoiceStep2" value="${escapeHtml(editIsDoubleChoice ? editDoubleChoiceSteps.step2?.correct || "" : "")}" />
          <div class="abcd-choice-row">
            ${["1", "2", "3"].map((value) => `<button class="abcd-choice ${editIsDoubleChoice && editDoubleChoiceSteps.step2?.correct === value ? "selected" : ""}" type="button" data-admin-double-choice="${value}" data-step-key="step2">${value}</button>`).join("")}
          </div>
        </div>
        <div class="field" data-answer-text-field>
          <label>Odpowiedź</label>
          <textarea name="answers" class="medium-textarea" placeholder="Wpisz jedną lub kilka odpowiedzi, oddzielone średnikiem.">${escapeHtml((editTask?.answers || []).join("; "))}</textarea>
        </div>
        <div class="field" data-answer-abcd-field hidden>
          <label>Poprawna odpowiedź</label>
          <input type="hidden" name="correctAbcd" value="${escapeHtml(editTask?.questionType === "closed-abcd" ? String(editTask?.answers?.[0] || "").toUpperCase() : "")}" />
          <div class="abcd-choice-row">
            ${["A", "B", "C", "D"].map((option) => `<button class="abcd-choice ${editTask?.questionType === "closed-abcd" && String(editTask?.answers?.[0] || "").toUpperCase() === option ? "selected" : ""}" type="button" data-admin-abcd-choice="${option}">${option}</button>`).join("")}
          </div>
        </div>
        ${pasteField("solution", "Rozwiązanie", "medium-textarea", "Opcjonalnie wklej rozwiązanie.", false, editTask?.solution || "")}
        <div class="actions">
          <button class="btn primary" type="submit">${editTask ? "Zapisz zmiany" : "Dodaj zadanie"}</button>
          <button class="btn" type="button" id="cancel-add-task-button">Anuluj</button>
        </div>
      </form>
    </div>
  `;
}

function teacherCreateMiniSheet() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Tworzenie miniarkuszy jest dostępne tylko dla administratora.", "teacher");
  const editItem = (state.readyMiniSheets || []).find((sheet) => sheet.id === session.editReadyMiniId);
  const editTasks = editItem ? editItem.taskIds.map((taskId) => state.tasks.find((task) => task.id === taskId)).filter(Boolean) : [];
  const selectedTopicId = editItem?.topicId || flatTopics[0].id;
  const selectedTopic = getTopic(selectedTopicId);
  return `
    <div class="teacher-form-card full-sheet-form">
      <h2>${editItem ? "Edytuj miniarkusz" : "Dodaj miniarkusz"}</h2>
      <p class="muted">Dodaj dowolną liczbę zadań. Każde zadanie może mieć tekst, obrazek i typ: zamknięte albo otwarte.</p>
      <form class="form" data-form-ready-mini>
        ${editItem ? `<input type="hidden" name="id" value="${editItem.id}" />` : ""}
        <div class="field"><label>Nazwa miniarkusza</label><input name="name" value="${escapeHtml(editItem?.name || "")}" placeholder="np. Miniarkusz 1.1 - własności liczb" required /></div>
        <div class="grid two">
          <div class="field"><label>Level</label><select name="levelNumber" data-task-level>${curriculum.map((levelData) => `<option value="${levelData.number}" ${levelData.number === selectedTopic.levelNumber ? "selected" : ""}>Level ${levelData.number} - ${escapeHtml(levelData.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Temat</label><select name="topicId" data-task-topic>${flatTopics.map((t) => `<option value="${t.id}" data-level="${t.levelNumber}" ${t.id === selectedTopicId ? "selected" : ""}>${t.number} ${escapeHtml(t.name)}</option>`).join("")}</select></div>
        </div>
        <div class="mini-sheet-task-list" data-mini-sheet-task-list>
          ${(editTasks.length ? editTasks : [null]).map((task, index) => miniSheetTaskEditor(index, task)).join("")}
        </div>
        <button class="btn" type="button" data-add-mini-task>Dodaj kolejne zadanie</button>
        <button class="btn primary" type="submit">Zapisz miniarkusz</button>
      </form>
    </div>
  `;
}

function miniSheetTaskEditor(index, task = null) {
  const number = index + 1;
  const defaultKind = task?.answerKind || (index < 4 ? "closed" : "open");
  return `
    <section class="mini-builder-task full-sheet-task" data-mini-sheet-task data-index="${index}">
      <div class="section-head" style="margin-top:0;">
        <h3>Zadanie <span data-task-number>${number}</span></h3>
        <div class="actions sheet-task-controls">
          <button class="btn" type="button" data-move-mini-task="up">Wyżej</button>
          <button class="btn" type="button" data-move-mini-task="down">Niżej</button>
          <button class="btn danger" type="button" data-remove-mini-task>Usuń zadanie</button>
        </div>
      </div>
      <div class="field compact-field">
        <label>Typ zadania</label>
        <select name="mini-${index}-answerKind">
          <option value="closed" ${defaultKind === "closed" ? "selected" : ""}>Zadanie zamknięte</option>
          <option value="open" ${defaultKind === "open" ? "selected" : ""}>Zadanie otwarte</option>
        </select>
      </div>
      ${pasteField(`mini-${index}-content`, "Treść zadania", "medium-textarea", "Wklej tekst albo obrazek zadania.", true, task?.content || "")}
      ${pasteField(`mini-${index}-answers`, "Prawidłowe odpowiedzi", "medium-textarea", "Oddziel odpowiedzi średnikiem albo nową linię.", true, task?.answers?.join("; ") || "")}
    </section>
  `;
}

function teacherReadyMiniSheets() {
  const sheets = state.readyMiniSheets || [];
  return `
    <div class="panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Moje miniarkusze</h2>
          <p>Gotowe miniarkusze przypisane do leveli i tematów.</p>
        </div>
        ${isAdminUser() ? `<button class="btn primary" data-teacher-tab="createMini">Dodaj miniarkusz</button>` : ""}
      </div>
      <div class="task-bank">
        ${sheets.map((sheet) => readyMiniSheetCard(sheet)).join("") || `<p class="muted">Nie utworzono jeszcze miniarkuszy.</p>`}
      </div>
    </div>
  `;
}

function readyMiniSheetCard(sheet) {
  const topicData = getTopic(sheet.topicId);
  const tasks = sheet.taskIds.map((taskId) => state.tasks.find((task) => task.id === taskId)).filter(Boolean);
  return `
    <article class="bank-task">
      <div class="bank-task-head">
        <div>
          <strong>${escapeHtml(sheet.name)}</strong>
          <p class="muted">Level ${topicData.levelNumber} · ${escapeHtml(topicData.levelName)} · ${topicData.number} ${escapeHtml(topicData.name)} · ${tasks.length} zadań</p>
        </div>
        <div class="actions">
          ${isAdminUser() ? `<button class="btn" data-edit-ready-mini="${sheet.id}">Edytuj</button><button class="btn danger" data-delete-ready-mini="${sheet.id}">Usuń miniarkusz</button>` : ""}
        </div>
      </div>
      <div class="bank-task-list">
        ${tasks.map((task, index) => `
          <div class="mini-task">
            <strong>${index + 1}. ${escapeHtml(task.content || "Zadanie obrazkowe")}</strong>
            ${renderImages(getTaskAttachments(task, "content"))}
            <span class="pill">${task.answerKind === "closed" ? "zamknięte" : "otwarte"}</span>
            <div><span class="muted">Odpowiedzi</span><p>${escapeHtml(task.answers.join("; "))}</p></div>
            ${renderImages(getTaskAttachments(task, "answers"), "task-images bank-images")}
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function teacherRepetytorium() {
  return `
    <div class="panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Repetytorium</h2>
          <p>Treści uporządkowane według leveli i tematów.</p>
        </div>
        ${isAdminUser() ? `<button class="btn primary" data-teacher-tab="addRepetytorium">Dodaj treść</button>` : ""}
      </div>
      <div class="task-bank">
        ${curriculum.map((levelData) => teacherRepetytoriumLevel(levelData)).join("")}
      </div>
    </div>
  `;
}

function teacherRepetytoriumLevel(levelData) {
  const count = (state.repetytoriumContent || []).filter((item) => item.levelNumber === levelData.number).length;
  const key = `rep:level:${levelData.number}`;
  return `
    <details class="bank-level" data-bank-key="${key}" ${session.bankOpen[key] ? "open" : ""}>
      <summary>Level ${levelData.number} · ${escapeHtml(levelData.name)} <span>${count} treści</span></summary>
      <div class="bank-topics">
        ${levelData.topics.map((topicData) => {
          const items = (state.repetytoriumContent || []).filter((item) => item.topicId === topicData.id);
          const topicKey = `rep:topic:${topicData.id}`;
          return `
            <details class="bank-topic" data-bank-key="${topicKey}" ${session.bankOpen[topicKey] ? "open" : ""}>
              <summary>${topicData.number} ${escapeHtml(topicData.name)} <span>${items.length} treści</span></summary>
              <div class="bank-task-list">
                ${items.map((item) => repetytoriumContentCard(item, isAdminUser())).join("") || `<p class="muted">Brak treści w tym temacie.</p>`}
              </div>
            </details>
          `;
        }).join("")}
      </div>
    </details>
  `;
}

function repetytoriumContentCard(item, teacherControls) {
  const topicData = getTopic(item.topicId);
  return `
    <article class="bank-task repetytorium-card">
      <div class="bank-task-head">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p class="muted">Level ${topicData.levelNumber} · ${escapeHtml(topicData.levelName)} · ${topicData.number} ${escapeHtml(topicData.name)}</p>
        </div>
        ${teacherControls ? `<div class="actions"><button class="btn" data-edit-repetytorium="${item.id}">Edytuj</button><button class="btn danger" data-delete-repetytorium="${item.id}">Usuń</button></div>` : ""}
      </div>
      ${item.summary ? `<p class="repetytorium-summary">${escapeHtml(item.summary)}</p>` : ""}
      <div class="bank-task-body">
        <div><span class="muted">Podgląd treści</span><p>${escapeHtml(item.contentText || "Treść obrazkowa")}</p></div>
        ${renderImages(item.attachments?.content || [], "task-images bank-images")}
      </div>
    </article>
  `;
}

function teacherAddRepetytorium() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Edycja repetytorium jest dostępna tylko dla administratora.", "teacher");
  const editItem = session.editRepetytoriumId ? (state.repetytoriumContent || []).find((item) => item.id === session.editRepetytoriumId) : null;
  if (editItem) {
    taskDraftAttachments.content = JSON.parse(JSON.stringify(editItem.attachments?.content || []));
  }
  return `
    <div class="teacher-form-card repetytorium-form">
      <h2>${editItem ? "Edytuj treść repetytorium" : "Dodaj treść do repetytorium"}</h2>
      <p class="muted">Wklej tekst, gotową teorię lub obrazek bezpośrednio w polu treści.</p>
      <form class="form" data-form-repetytorium>
        <input type="hidden" name="id" value="${editItem ? escapeHtml(editItem.id) : ""}" />
        <div class="field"><label>Tytuł treści</label><input name="title" value="${editItem ? escapeHtml(editItem.title) : ""}" placeholder="np. Własności liczb · najważniejsze zasady" required /></div>
        <div class="grid two">
          <div class="field"><label>Level</label><select name="levelNumber" data-task-level>${curriculum.map((levelData) => `<option value="${levelData.number}" ${editItem?.levelNumber === levelData.number ? "selected" : ""}>Level ${levelData.number} - ${escapeHtml(levelData.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Temat</label><select name="topicId" data-task-topic>${flatTopics.map((t) => `<option value="${t.id}" data-level="${t.levelNumber}" ${editItem?.topicId === t.id ? "selected" : ""}>${t.number} ${escapeHtml(t.name)}</option>`).join("")}</select></div>
        </div>
        ${pasteField("content", "Treść", "large-textarea", "Wklej długą treść, listę, akapity albo obrazek ze schowka przez Ctrl + V.", true, editItem?.contentText || "")}
        <div class="field"><label>Krótkie podsumowanie</label><textarea name="summary" class="medium-textarea" placeholder="Opcjonalnie: najważniejsze informacje w 2-3 zdaniach.">${editItem ? escapeHtml(editItem.summary || "") : ""}</textarea></div>
        <button class="btn primary" type="submit">Zapisz treść</button>
      </form>
    </div>
  `;
}

function teacherAddFullSheet() {
  if (!isAdminUser()) return blockedView("Brak dostępu", "Tworzenie arkuszy jest dostępne tylko dla administratora.", "teacher");
  const editSheet = session.editFullSheetId ? (state.fullSheets || []).find((sheet) => sheet.id === session.editFullSheetId) : null;
  if (editSheet) {
    editSheet.tasks.forEach((task, index) => {
      taskDraftAttachments[`sheet-${index}-content`] = JSON.parse(JSON.stringify(task.attachments?.content || []));
      taskDraftAttachments[`sheet-${index}-answers`] = JSON.parse(JSON.stringify(task.attachments?.answers || []));
    });
  }
  return `
    <div class="teacher-form-card full-sheet-form">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>${editSheet? "Edytuj arkusz" : "Dodaj arkusz"}</h2>
          <p class="muted">${editSheet? "Wprowadź zmiany w arkuszu, zadaniach, kolejności i odpowiedziach." : "Utwórz pełny arkusz egzaminacyjny i dodaj tyle zadań, ile potrzebujesz."}</p>
        </div>
        ${editSheet? `<button class="btn" type="button" data-preview-full-sheet="${editSheet.id}">Podgląd arkusza</button>` : ""}
      </div>
      ${session.teacherNotice ? `<div class="teacher-notice">${escapeHtml(session.teacherNotice)}</div>` : ""}
      <form class="form" data-form-full-sheet>
        <input type="hidden" name="id" value="${editSheet? escapeHtml(editSheet.id) : ""}" />
        <div class="grid two">
          <div class="field"><label>Nazwa arkusza</label><input name="name" value="${escapeHtml(editSheet?.name || "")}" placeholder="np. Arkusz próbny 2026" required /></div>
          <div class="field"><label>Rok / opis</label><input name="description" value="${escapeHtml(editSheet?.description || "")}" placeholder="np. maj 2026, zestaw próbny" /></div>
        </div>
        <div class="field"><label>Instrukcje wypełnienia arkusza</label><textarea name="instructions" class="large-textarea" placeholder="np. Na rozwiązanie arkusza masz 100 minut. Zapisuj wszystkie obliczenia.">${escapeHtml(editSheet?.instructions || "")}</textarea></div>
        <div class="full-sheet-task-list" data-full-sheet-task-list>
          ${(editSheet?.tasks?.length ? editSheet.tasks : [null]).map((task, index) => fullSheetTaskEditor(index, task)).join("")}
        </div>
        <button class="btn" type="button" data-add-sheet-task>Dodaj kolejne zadanie</button>
        <button class="btn primary" type="submit">${editSheet? "Zapisz zmiany" : "Zapisz arkusz"}</button>
      </form>
    </div>
  `;
}

function fullSheetTaskEditor(index, task = null) {
  const number = index + 1;
  return `
    <section class="mini-builder-task full-sheet-task" data-full-sheet-task data-index="${index}">
      <input type="hidden" name="sheet-${index}-id" value="${task ? escapeHtml(task.id) : ""}" />
      <div class="section-head" style="margin-top:0;">
        <h3>Zadanie <span data-task-number>${number}</span></h3>
        <div class="actions sheet-task-controls">
          <button class="btn" type="button" data-focus-sheet-task>Edytuj</button>
          <button class="btn" type="button" data-move-sheet-task="up">Wyżej</button>
          <button class="btn" type="button" data-move-sheet-task="down">Niżej</button>
          <button class="btn danger" type="button" data-remove-sheet-task>Usuń zadanie</button>
        </div>
      </div>
      <div class="field"><label>Typ zadania</label><select name="sheet-${index}-answerKind"><option value="closed" ${(task?.answerKind || "closed") === "closed" ? "selected" : ""}>zamknięte</option><option value="open" ${task?.answerKind === "open" ? "selected" : ""}>otwarte</option></select></div>
      ${pasteField(`sheet-${index}-content`, "Treść zadania", "medium-textarea", "Wklej tekst albo obrazek zadania.", index === 0, task?.content || "")}
      ${pasteField(`sheet-${index}-answers`, "Prawidłowe odpowiedzi", "medium-textarea", "Oddziel warianty średnikiem albo nową linię.", index === 0, (task?.answers || []).join("; "))}
    </section>
  `;
}

function teacherFullSheets() {
  const sheets = state.fullSheets || [];
  if (session.previewFullSheetId) {
    const sheet = sheets.find((item) => item.id === session.previewFullSheetId);
    if (sheet) return fullSheetPreview(sheet);
    session.previewFullSheetId = null;
  }
  return `
    <div class="panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Arkusze</h2>
          <p>Lista pełnych arkuszy egzaminacyjnych zapisanych przez nauczyciela.</p>
        </div>
        ${isAdminUser() ? `<button class="btn primary" data-teacher-tab="addFullSheet">Dodaj arkusz</button>` : ""}
      </div>
      <div class="task-bank">
        ${sheets.map((sheet) => fullSheetCard(sheet)).join("") || `<p class="muted">Nie dodano jeszcze pełnych arkuszy.</p>`}
      </div>
    </div>
  `;
}

function fullSheetCard(sheet) {
  return `
    <article class="bank-task full-sheet-list-card">
      <div class="bank-task-head">
        <div>
          <strong>${escapeHtml(sheet.name)}</strong>
          <p class="muted">${escapeHtml(sheet.description || "Bez opisu")} · ${sheet.tasks.length} zadań</p>
        </div>
        <div class="actions">
          <button class="btn" data-preview-full-sheet="${sheet.id}">Podgląd</button>
          ${isAdminUser() ? `<button class="btn" data-edit-full-sheet="${sheet.id}">Edytuj</button><button class="btn danger" data-delete-full-sheet="${sheet.id}">Usuń</button>` : ""}
        </div>
      </div>
    </article>
  `;
}

function fullSheetPreview(sheet) {
  return `
    <div class="panel full-sheet-preview">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>${escapeHtml(sheet.name)}</h2>
          <p>${escapeHtml(sheet.description || "Pełny arkusz egzaminacyjny")} · ${sheet.tasks.length} zadań</p>
        </div>
        <div class="actions">
          <button class="btn" data-back-full-sheets>Wróć do arkuszy</button>
          ${isAdminUser() ? `<button class="btn primary" data-edit-full-sheet="${sheet.id}">Edytuj arkusz</button>` : ""}
        </div>
      </div>
      <div class="exam-sheet">
        <div class="exam-sheet-cover">
          <span class="pill">Podgląd arkusza</span>
          <h1>${escapeHtml(sheet.name)}</h1>
          <p>${escapeHtml(sheet.description || "Arkusz MatDaily")}</p>
        </div>
        ${sheet.instructions? `<div class="exam-instructions"><strong>Instrukcje dla ucznia</strong><p>${escapeHtml(sheet.instructions)}</p></div>` : ""}
        <div class="exam-task-list">
          ${sheet.tasks.map((task, index) => `
            <article class="exam-task">
              <div class="exam-task-head">
                <h3>Zadanie ${index + 1}</h3>
                <span class="pill">${(task.answerKind || "closed") === "closed" ? "zamknięte" : "otwarte"}</span>
              </div>
              ${task.content? `<p class="exam-task-content">${escapeHtml(task.content)}</p>` : `<p class="muted">Zadanie obrazkowe</p>`}
              ${renderImages(task.attachments?.content || [], "task-images bank-images")}
              <div class="exam-answer-box">
                <span class="muted">Poprawne odpowiedzi</span>
                <p>${escapeHtml((task.answers || []).join("; "))}</p>
                ${renderImages(task.attachments?.answers || [], "task-images bank-images")}
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function teacherHome() {
  const classes = teacherClassesForCurrentUser();
  const students = teacherStudentsForCurrentUser();
  const classIds = new Set(classes.map((classData) => classData.id));
  const userIds = new Set(students.map((student) => student.userId));
  const entries = isAdminUser() ? getActivityEntries() : getActivityEntries().filter((entry) => classIds.has(entry.classId) || userIds.has(entry.userId));
  const activitySeries = getActivitySeries(entries, 7);
  const classActivity = getClassActivityStats(entries).filter((item) => isAdminUser() || classIds.has(item.id));
  const topClass = classActivity.reduce((best, item) => item.percent > best.percent? item : best, { name: "Brak danych", percent: 0 });
  const visits = getVisitStats(entries);
  const recentEntries = entries.slice(0, 4);
  return `
    <div class="teacher-home teacher-home-modern teacher-premium-home">
      <section class="teacher-stat-grid teacher-premium-stats">
        ${teacherStatCard("Liczba klas", classes.length, "aktywnych w systemie", "users")}
        ${teacherStatCard("Liczba uczniów", students.length, "przypisanych do klas", "graduation")}
        ${teacherStatCard("Wej&#347;cia na stron&#281;", visits.totalLast3Days, "ostatnie 3 dni", "chart")}
        ${teacherStatCard("Najbardziej aktywna klasa", escapeHtml(topClass.name), `${topClass.percent}% aktywno&#347;ci`, "layers")}
      </section>
      <section class="teacher-dashboard-row top-row teacher-analytics-row">
        <article class="teacher-dashboard-widget activity-widget teacher-premium-chart-card">
          <div class="widget-head">
            <h2>Aktywno&#347;&#263; uczniów</h2>
            <span>ostatnie 7 dni</span>
          </div>
          <div class="teacher-line-chart" aria-label="Wykres aktywno&#347;ci uczniów">${teacherActivityChart(activitySeries)}</div>
          <button class="link-button teacher-chart-link" type="button" data-teacher-tab="activity">Pe&#322;na aktywno&#347;&#263;</button>
        </article>
        <article class="teacher-dashboard-widget visits-widget">
          <div class="widget-head">
            <h2>Wej&#347;cia na stron&#281;</h2>
            <span>ostatnie 3 dni</span>
          </div>
          <div class="teacher-donut-layout">
            ${teacherDonutChart(visits.withLogin, visits.withoutLogin)}
            <div class="teacher-donut-legend">
              <span><i class="legend-login"></i>Wej&#347;cia z logowaniem <strong>${visits.withLogin}</strong></span>
              <span><i class="legend-guest"></i>Wej&#347;cia bez logowania <strong>${visits.withoutLogin}</strong></span>
            </div>
          </div>
          <button class="link-button" type="button" data-teacher-tab="visitStats">Szczegó&#322;owe statystyki wej&#347;&#263;</button>
        </article>
      </section>
      <section class="teacher-dashboard-row teacher-lower-row">
        <article class="teacher-dashboard-widget recent-widget teacher-recent-compact">
          <div class="widget-head"><h2>Ostatnia aktywno&#347;&#263;</h2></div>
          <div class="teacher-activity-list">
            ${recentEntries.length ? recentEntries.map((entry) => teacherActivityItem(entry.description, formatDateTime(entry.createdAt), activityIcon(entry.type), entry.className)).join("") : `<p class="muted">Brak aktywno&#347;ci do wy&#347;wietlenia.</p>`}
          </div>
          <button class="link-button" type="button" data-teacher-tab="activity">Zobacz wszystkie</button>
        </article>
        <article class="teacher-dashboard-widget useful-links-widget">
          <div class="widget-head"><h2>Przydatne linki</h2></div>
          <div class="teacher-useful-links">
            ${teacherUsefulLink("CKE", "Centralna Komisja Egzaminacyjna", "https://cke.gov.pl/", "book")}
            ${teacherUsefulLink("Kuratorium", "Bydgoszcz", "https://kuratorium.bydgoszcz.pl/", "clipboard")}
            ${teacherUsefulLink("Liga Zadaniowa", "UMK", "https://liga.mat.umk.pl/", "layers")}
          </div>
        </article>
      </section>
    </div>
  `;
}
function teacherActivityChart(series = getSevenDayActivitySeries(getActivityEntries()), fixedMax = null) {
  const maxValue = fixedMax || Math.max(10, ...series.map((item) => item.count));
  const chartHeight = 168;
  const top = 18;
  const bottom = 132;
  const step = series.length > 1 ? 292 / (series.length - 1) : 0;
  const points = series.map((item, index) => {
    const x = 38 + index * step;
    const y = bottom - ((Math.min(item.count, maxValue) / maxValue) * (bottom - top));
    return `${x},${y}`;
  }).join(" ");
  const scale = [maxValue, Math.round(maxValue * 0.5), 0];
  const labelIndexes = series.map((_, index) => index).filter((index) => series.length <= 12 || index % 5 === 0 || index === series.length - 1);
  return `
    <svg viewBox="0 0 350 ${chartHeight}" role="img">
      <path class="chart-axis" d="M32 18v114h300" />
      ${scale.map((value, index) => {
        const y = 18 + index * 57;
        return `<g><path class="chart-grid" d="M30 ${y}h300" /><text class="chart-y-label" x="4" y="${y + 4}">${value}</text></g>`;
      }).join("")}
      <polyline class="chart-line" points="${points}" />
      ${series.map((item, index) => {
        const x = 38 + index * step;
        const y = bottom - ((Math.min(item.count, maxValue) / maxValue) * (bottom - top));
        return `<circle class="chart-dot" cx="${x}" cy="${y}" r="3.4"><title>${escapeHtml(item.label)}: ${item.count}</title></circle>`;
      }).join("")}
      <g class="chart-labels">
        ${labelIndexes.map((index) => `<text x="${28 + index * step}" y="158">${escapeHtml(series[index].shortLabel)}</text>`).join("")}
      </g>
    </svg>
  `;
}

function teacherDonutChart(withLogin, withoutLogin) {
  const total = withLogin + withoutLogin;
  const safeTotal = total || 1;
  const loginValue = Math.round((withLogin / safeTotal) * 100);
  const guestValue = 100 - loginValue;
  return `
    <svg class="teacher-donut" viewBox="0 0 120 120" role="img" aria-label="Wejscia z logowaniem i bez logowania">
      <circle class="donut-track" cx="60" cy="60" r="42" />
      <circle class="donut-login" cx="60" cy="60" r="42" style="--part:${loginValue}" />
      <circle class="donut-guest" cx="60" cy="60" r="42" style="--part:${guestValue}; --offset:${loginValue}" />
      <text x="60" y="56" text-anchor="middle">${total}</text>
      <text x="60" y="72" text-anchor="middle">wejsc</text>
    </svg>
  `;
}

function teacherUsefulLink(title, body, href, iconName) {
  return `
    <a class="teacher-useful-link" href="${href}" target="_blank" rel="noopener noreferrer">
      <span>${icon(iconName)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </div>
    </a>
  `;
}

function teacherActivityItem(label, time, iconName, meta = "") {
  return `
    <div class="teacher-activity-item">
      <span>${icon(iconName)}</span>
      <div>
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(meta || "")}</small>
        <p>${escapeHtml(time)}</p>
      </div>
    </div>
  `;
}

function teacherVisitStats() {
  const filters = session.visitStats || { type: "all", period: "3" };
  const stats = getVisitStatsDetailed(filters.type, filters.period);
  return `
    <div class="panel teacher-activity-panel teacher-visit-panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Statystyki wej&#347;&#263;</h2>
          <p>Wej&#347;cia na stron&#281; wed&#322;ug typu i wybranego okresu.</p>
        </div>
        <button class="btn teacher-back-btn" data-teacher-tab="dashboard">Wróć</button>
      </div>
      <div class="teacher-filter-bar">
        <div>
          <span>Typ wej&#347;&#263;</span>
          <div class="teacher-range-toggle">
            ${visitFilterButton("all", "wszystkie", filters.type)}
            ${visitFilterButton("login", "z logowaniem", filters.type)}
            ${visitFilterButton("guest", "bez logowania", filters.type)}
          </div>
        </div>
        <div>
          <span>Okres</span>
          <div class="teacher-range-toggle">
            ${visitPeriodButton("3", "3 dni", filters.period)}
            ${visitPeriodButton("7", "tydzie&#324;", filters.period)}
            ${visitPeriodButton("14", "2 tygodnie", filters.period)}
            ${visitPeriodButton("30", "miesi&#261;c", filters.period)}
            ${visitPeriodButton("all", "wszystkie", filters.period)}
          </div>
        </div>
      </div>
      <section class="teacher-stat-grid teacher-premium-stats">
        ${teacherStatCard("&#321;&#261;czna liczba wej&#347;&#263;", stats.total, "wybrany okres", "chart")}
        ${teacherStatCard("Wej&#347;cia z logowaniem", stats.withLogin, "uczniowie i nauczyciele", "users")}
        ${teacherStatCard("Wej&#347;cia bez logowania", stats.withoutLogin, "tryb demonstracyjny", "rocket")}
        ${teacherStatCard("Pokazany okres", stats.periodLabel, "aktywny filtr", "clipboard")}
      </section>
      <article class="teacher-dashboard-widget teacher-premium-chart-card">
        <div class="widget-head">
          <h2>Wykres wej&#347;&#263;</h2>
          <span>${escapeHtml(stats.periodLabel)}</span>
        </div>
        <div class="teacher-line-chart">${teacherActivityChart(stats.series)}</div>
      </article>
    </div>
  `;
}

function visitFilterButton(value, label, current) {
  return `<button class="${current === value ? "active" : ""}" type="button" data-visit-type="${value}">${label}</button>`;
}

function visitPeriodButton(value, label, current) {
  return `<button class="${current === value ? "active" : ""}" type="button" data-visit-period="${value}">${label}</button>`;
}

function getContactMessages() {
  return (state.contactMessages || [])
    .map((entry) => ({ ...entry, createdAt: entry.createdAt || new Date().toISOString(), isRead: Boolean(entry.isRead) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function teacherFullActivity() {
  const filters = session.activityFilters || {};
  const entries = getFilteredActivityEntries(filters);
  const range = session.fullActivityRange || 7;
  const activitySeries = getActivitySeries(getActivityEntries(), range);
  return `
    <div class="panel teacher-activity-panel">
      <div class="section-head" style="margin-top:0;">
        <div>
          <h2>Pełna aktywność</h2>
          <p>Wszystkie zapisane aktywności uczniów i nauczyciela.</p>
        </div>
        <button class="btn teacher-back-btn" data-teacher-tab="dashboard">Wróć</button>
      </div>
      <article class="teacher-dashboard-widget teacher-premium-chart-card full-activity-chart">
        <div class="widget-head">
          <h2>Wykres aktywno&#347;ci</h2>
          <div class="teacher-range-toggle">
            <button class="${range === 7 ? "active" : ""}" type="button" data-full-activity-range="7">tydzie&#324;</button>
            <button class="${range === 14 ? "active" : ""}" type="button" data-full-activity-range="14">dwa tygodnie</button>
            <button class="${range === 30 ? "active" : ""}" type="button" data-full-activity-range="30">miesi&#261;c</button>
          </div>
        </div>
        <div class="teacher-line-chart">${teacherActivityChart(activitySeries, 100)}</div>
      </article>
      <div class="activity-filters">
        <div class="field"><label>Klasa</label><select data-activity-filter="classId"><option value="">Wszystkie klasy</option>${state.classes.map((item) => `<option value="${item.id}" ${filters.classId === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Uczeń</label><select data-activity-filter="studentId"><option value="">Wszyscy uczniowie</option>${state.students.map((student) => `<option value="${student.id}" ${filters.studentId === student.id ? "selected" : ""}>${escapeHtml(getUserName(student.userId))}</option>`).join("")}</select></div>
        <div class="field"><label>Typ aktywności</label><select data-activity-filter="type"><option value="">Wszystkie typy</option>${activityTypes().map((type) => `<option value="${type.id}" ${filters.type === type.id ? "selected" : ""}>${type.label}</option>`).join("")}</select></div>
        <div class="field"><label>Od</label><input type="date" value="${escapeHtml(filters.from || "")}" data-activity-filter="from" /></div>
        <div class="field"><label>Do</label><input type="date" value="${escapeHtml(filters.to || "")}" data-activity-filter="to" /></div>
      </div>
      <div class="activity-table">
        ${entries.length ? entries.map((entry) => `
          <div class="activity-row">
            <span class="teacher-dashboard-icon">${icon(activityIcon(entry.type))}</span>
            <div>
              <strong>${escapeHtml(entry.description)}</strong>
              <p>${escapeHtml(entry.userName || "-")} · ${escapeHtml(entry.className || "bez klasy")} · ${escapeHtml(activityTypeLabel(entry.type))}</p>
            </div>
            <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
          </div>
        `).join("") : `<p class="muted">Brak aktywności do wyświetlenia.</p>`}
      </div>
    </div>
  `;
}

function activityTypes() {
  return [
    { id: "daily", label: "zadanie dzienne" },
    { id: "mini", label: "miniarkusz" },
    { id: "sheet", label: "arkusz" },
    { id: "repetytorium", label: "repetytorium" },
    { id: "task-added", label: "dodanie zadania" },
    { id: "sheet-added", label: "dodanie arkusza" },
    { id: "student-added", label: "dodanie ucznia" },
    { id: "class-added", label: "dodanie klasy" },
    { id: "contact_message", label: "wiadomość kontaktowa" },
    { id: "other", label: "inne" }
  ];
}

function activityTypeLabel(type) {
  return activityTypes().find((item) => item.id === type)?.label || "inne";
}

function activityIcon(type) {
  const icons = {
    daily: "clipboard",
    mini: "file",
    sheet: "book",
    repetytorium: "book",
    "task-added": "layers",
    "sheet-added": "book",
    "student-added": "graduation",
    "class-added": "users",
    contact_message: "mail"
  };
  return icons[type] || "chart";
}

function logActivity(payload) {
  state.activityLog = state.activityLog || [];
  state.activityLog.unshift({
    id: uid("activity"),
    userId: payload.userId || currentUser()?.id || "",
    userName: payload.userName || currentUser()?.name || "",
    studentId: payload.studentId || "",
    classId: payload.classId || "",
    className: payload.className || "",
    type: payload.type || "other",
    description: payload.description || "Aktywność",
    details: payload.details || "",
    createdAt: payload.createdAt || new Date().toISOString()
  });
}

function logStudentActivity(studentId, type, description) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return;
  const classData = state.classes.find((item) => item.id === student.classId);
  logActivity({
    type,
    userId: student.userId,
    userName: getUserName(student.userId),
    studentId,
    classId: student.classId,
    className: classData?.name || "",
    description
  });
}

function getActivityEntries() {
  const stored = (state.activityLog || []).map((entry) => ({ ...entry, createdAt: entry.createdAt || new Date().toISOString() }));
  const storedKeys = new Set(stored.map((entry) => activityEntryKey(entry)));
  const derived = deriveActivityEntries().filter((entry) => !storedKeys.has(activityEntryKey(entry)));
  return [...stored, ...derived].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function activityEntryKey(entry) {
  if (["daily", "mini", "sheet", "repetytorium"].includes(entry.type) && entry.studentId) {
    return [entry.type, entry.studentId, dateKey(entry.createdAt)].join("|");
  }
  return [entry.type, entry.userId || "", dateKey(entry.createdAt), entry.description].join("|");
}

function deriveActivityEntries() {
  const entries = [];
  (state.attempts || []).forEach((attempt) => {
    const student = state.students.find((item) => item.id === attempt.studentId);
    if (!student) return;
    const classData = state.classes.find((item) => item.id === student.classId);
    const userName = getUserName(student.userId);
    entries.push({
      id: `derived-${attempt.id}`,
      userId: student.userId,
      userName,
      studentId: student.id,
      classId: student.classId,
      className: classData?.name || "",
      type: attempt.context === "mini" ? "mini" : "daily",
      description: attempt.context === "mini" ? `${userName} rozwiązał miniarkusz` : `${userName} rozwiązał zadanie dzienne`,
      createdAt: dateToIso(attempt.date)
    });
  });
  (state.tasks || []).filter((task) => task.createdAt).forEach((task) => {
    entries.push({
      id: `derived-task-${task.id}`,
      userId: task.teacherId || "",
      userName: "Nauczyciel",
      type: "task-added",
      description: "Dodano nowe zadanie",
      createdAt: task.createdAt
    });
  });
  (state.fullSheets || []).filter((sheet) => sheet.createdAt).forEach((sheet) => {
    entries.push({
      id: `derived-sheet-${sheet.id}`,
      userId: sheet.teacherId || "",
      userName: "Nauczyciel",
      type: "sheet-added",
      description: `Dodano arkusz: ${sheet.name}`,
      createdAt: sheet.createdAt
    });
  });
  (state.repetytoriumContent || []).filter((item) => item.createdAt).forEach((item) => {
    entries.push({
      id: `derived-rep-${item.id}`,
      userId: item.teacherId || "",
      userName: "Nauczyciel",
      type: "repetytorium",
      description: `Dodano treść do repetytorium: ${item.title}`,
      createdAt: item.createdAt
    });
  });
  return entries;
}

function getFilteredActivityEntries(filters = {}) {
  return getActivityEntries().filter((entry) => {
    if (filters.classId && entry.classId !== filters.classId) return false;
    if (filters.studentId && entry.studentId !== filters.studentId) return false;
    if (filters.type && entry.type !== filters.type) return false;
    const key = dateKey(entry.createdAt);
    if (filters.from && key < filters.from) return false;
    if (filters.to && key > filters.to) return false;
    return true;
  });
}

function getSevenDayActivitySeries(entries) {
  return getActivitySeries(entries, 7);
}

function getActivitySeries(entries, days = 7) {
  const rangeDays = Number(days) === 30 ? 30 : 7;
  const activeTypes = ["daily", "mini", "sheet", "repetytorium"];
  const dates = lastNDates(rangeDays);
  return dates.map((key) => {
    const active = new Set(entries
      .filter((entry) => dateKey(entry.createdAt) === key && activeTypes.includes(entry.type))
      .map((entry) => entry.studentId || entry.userId)
      .filter(Boolean));
    return { date: key, count: active.size, label: dayLabel(key), shortLabel: shortDateLabel(key) };
  });
}

function getVisitStats(entries) {
  const cutoff = lastNDates(3)[0];
  const loginTypes = ["daily", "mini", "sheet", "repetytorium", "task-added", "sheet-added", "student-added", "class-added"];
  const recent = entries.filter((entry) => dateKey(entry.createdAt) >= cutoff);
  const withLogin = recent.filter((entry) => loginTypes.includes(entry.type)).length;
  const withoutLogin = recent.filter((entry) => entry.type === "guest" || entry.type === "guest-visit").length;
  return { withLogin, withoutLogin, totalLast3Days: withLogin + withoutLogin };
}

function getVisitStatsDetailed(type = "all", period = "3") {
  const entries = getActivityEntries();
  const series = getVisitSeries(entries, type, period);
  const withLogin = series.reduce((sum, item) => sum + item.withLogin, 0);
  const withoutLogin = series.reduce((sum, item) => sum + item.withoutLogin, 0);
  return {
    withLogin,
    withoutLogin,
    total: withLogin + withoutLogin,
    periodLabel: visitPeriodLabel(period),
    series: series.map((item) => ({ ...item, count: type === "login" ? item.withLogin : type === "guest" ? item.withoutLogin : item.withLogin + item.withoutLogin }))
  };
}

function getVisitSeries(entries, type = "all", period = "3") {
  const dates = period === "all" ? allActivityDates(entries) : lastNDates(Number(period) || 3);
  return dates.map((key) => {
    const daily = entries.filter((entry) => dateKey(entry.createdAt) === key);
    const withLogin = daily.filter((entry) => visitEntryType(entry) === "login").length;
    const withoutLogin = daily.filter((entry) => visitEntryType(entry) === "guest").length;
    return { date: key, withLogin, withoutLogin, label: dayLabel(key), shortLabel: shortDateLabel(key) };
  });
}

function visitEntryType(entry) {
  if (entry.type === "guest" || entry.type === "guest-visit") return "guest";
  if (["daily", "mini", "sheet", "repetytorium", "task-added", "sheet-added", "student-added", "class-added"].includes(entry.type)) return "login";
  return "";
}

function visitPeriodLabel(period) {
  const labels = { "3": "ostatnie 3 dni", "7": "ostatni tydzień", "14": "ostatnie 2 tygodnie", "30": "ostatni miesiąc", all: "wszystkie" };
  return labels[period] || labels["3"];
}

function allActivityDates(entries) {
  const dates = [...new Set(entries.map((entry) => dateKey(entry.createdAt)).filter(Boolean))].sort();
  return dates.length ? dates : [today()];
}

function getLegacySevenDayActivitySeries(entries) {
  const dates = lastNDates(7);
  return dates.map((key) => {
    const active = new Set(entries
      .filter((entry) => dateKey(entry.createdAt) === key && ["daily", "mini", "sheet", "repetytorium"].includes(entry.type))
      .map((entry) => entry.studentId || entry.userId)
      .filter(Boolean));
    return { date: key, count: active.size, label: dayLabel(key), shortLabel: shortDateLabel(key) };
  });
}

function getClassActivityStats(entries) {
  const cutoff = lastNDates(7)[0];
  return state.classes.map((classData) => {
    const students = state.students.filter((student) => student.classId === classData.id);
    const activeIds = new Set();
    students.forEach((student) => {
      const progress = state.progress[student.id];
      if ((progress?.activityDates || []).some((date) => date >= cutoff)) activeIds.add(student.id);
    });
    entries.forEach((entry) => {
      if (entry.classId === classData.id && entry.studentId && dateKey(entry.createdAt) >= cutoff) activeIds.add(entry.studentId);
    });
    const percent = students.length ? Math.round((activeIds.size / students.length) * 100) : 0;
    return { id: classData.id, name: classData.name, percent };
  }).sort((a, b) => b.percent - a.percent);
}

function getInactiveStudentsToday(entries) {
  const activeIds = new Set(entries.filter((entry) => dateKey(entry.createdAt) === today()).map((entry) => entry.studentId).filter(Boolean));
  return state.students.filter((student) => !activeIds.has(student.id));
}

function getAverageCorrectPercent() {
  const attempts = state.attempts || [];
  if (!attempts.length) return 0;
  return Math.round((attempts.filter((attempt) => attempt.correct).length / attempts.length) * 100);
}

function lastNDates(count) {
  const end = dateFromKey(today());
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (count - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

function dateKey(value) {
  if (!value) return today();
  return String(value).slice(0, 10);
}

function dateToIso(value) {
  return `${dateKey(value)}T12:00:00.000Z`;
}

function dayLabel(key) {
  return new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(dateFromKey(key));
}

function shortDateLabel(key) {
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit" }).format(dateFromKey(key));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDateTimeSafe(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDateTime(value);
}

function getUserName(userId) {
  return state.users.find((userData) => userData.id === userId)?.name || "Użytkownik";
}

function pasteField(name, label, className, placeholder, required, value = "") {
  return `
    <div class="field paste-field" data-paste-field="${name}">
      <label>${label}</label>
      <textarea class="rich-hidden-input" name="${name}" aria-hidden="true">${escapeHtml(value)}</textarea>
      <div class="rich-editor ${className}" contenteditable="true" role="textbox" tabindex="0" data-rich-editor="${name}" data-placeholder="${placeholder}" data-required="${required ? "true" : "false"}">${escapeHtml(value)}${attachmentPreview(name)}</div>
      <div class="paste-note">Możesz wkleić tekst albo obrazek ze schowka przez Ctrl + V.</div>
    </div>
  `;
}

function attachmentPreview(field) {
  const images = taskDraftAttachments[field] || [];
  return images.map((image, index) => `
    <div class="attachment-thumb" contenteditable="false">
      <img src="${image.dataUrl}" alt="${escapeHtml(image.name || `Załącznik ${index + 1}`)}" />
      <button class="btn danger" type="button" data-remove-attachment="${field}:${index}">Usuń obrazek</button>
    </div>
  `).join("");
}

function blockedView(title, body, backView) {
  return `
    <section class="section">
      <div class="notice">
        <h1>${title}</h1>
        <p>${body}</p>
        <button class="btn primary" data-view="${backView}">Wróć</button>
      </div>
    </section>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.view !== "fullSheetsStudent") fullSheetRun = null;
    if (button.dataset.view !== "studentSettings") session.studentNotice = null;
    session.showRememberPasswordPrompt = false;
    session.view = button.dataset.view;
    render();
  }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
  document.querySelectorAll("[data-login]").forEach((button) => button.addEventListener("click", () => {
    session.view = "login";
    session.loginRole = button.dataset.login;
    session.loginMode = "login";
    render();
  }));
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
    session.loginMode = button.dataset.authMode || "login";
    render();
  }));
  const cancelAddTaskButton = document.querySelector("#cancel-add-task-button");
  if (cancelAddTaskButton) cancelAddTaskButton.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    session.editTaskId = null;
    if (session.teacherTab === "add") session.teacherTab = "tasks";
    taskDraftAttachments = emptyAttachments();
    render();
  };
  document.querySelectorAll("[data-teacher-tab]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    const adminOnlyTabs = new Set(["add", "createMini", "addFullSheet", "addRepetytorium", "messages", "teacherVerification", "teacherUsers", "studentUsers"]);
    if (!isAdminUser() && adminOnlyTabs.has(button.dataset.teacherTab)) {
      alert("Ta funkcja jest dostępna tylko dla administratora.");
      return;
    }
    if ((button.dataset.teacherTab === "add" || button.dataset.teacherTab === "createMini" || button.dataset.teacherTab === "addFullSheet" || button.dataset.teacherTab === "addRepetytorium") && session.teacherTab !== button.dataset.teacherTab) taskDraftAttachments = emptyAttachments();
    if (button.dataset.teacherTab === "add") session.editTaskId = null;
    if (button.dataset.teacherTab === "createMini") session.editReadyMiniId = null;
    if (button.dataset.teacherTab === "addFullSheet") session.editFullSheetId = null;
    if (button.dataset.teacherTab === "fullSheets") session.editFullSheetId = null;
    if (button.dataset.teacherTab !== "fullSheets") session.previewFullSheetId = null;
    if (button.dataset.teacherTab === "fullSheets") session.previewFullSheetId = null;
    if (button.dataset.teacherTab !== "addRepetytorium") session.editRepetytoriumId = null;
    if (button.dataset.teacherTab !== "add") session.editTaskId = null;
    session.teacherTab = button.dataset.teacherTab;
    if (button.dataset.teacherTab !== "results") {
      session.resultsClassId = null;
      session.resultsStudentId = null;
    }
    if (button.dataset.teacherTab !== "classes") {
      session.teacherClassId = null;
      session.teacherClassResultsId = null;
      session.deleteClassMode = false;
    }
    if (button.dataset.teacherTab !== "studentUsers") {
      session.adminStudentProfileId = null;
      session.adminStudentProfileReturnClassId = null;
      session.generatedStudentCredentials = null;
    }
    session.teacherNotice = null;
    session.teacherLastStudent = null;
    session.view = "teacher";
    render();
  }));
  document.querySelectorAll("[data-teacher-range]").forEach((button) => button.addEventListener("click", () => {
    session.teacherActivityRange = Number(button.dataset.teacherRange) === 30 ? 30 : 7;
    render();
  }));
  document.querySelectorAll("[data-full-activity-range]").forEach((button) => button.addEventListener("click", () => {
    const value = Number(button.dataset.fullActivityRange);
    session.fullActivityRange = value === 14 || value === 30 ? value : 7;
    render();
  }));
  document.querySelectorAll("[data-visit-type]").forEach((button) => button.addEventListener("click", () => {
    session.visitStats = { ...(session.visitStats || { period: "3" }), type: button.dataset.visitType || "all" };
    render();
  }));
  document.querySelectorAll("[data-visit-period]").forEach((button) => button.addEventListener("click", () => {
    session.visitStats = { ...(session.visitStats || { type: "all" }), period: button.dataset.visitPeriod || "3" };
    render();
  }));
  document.querySelectorAll("[data-bank-key]").forEach((details) => details.addEventListener("toggle", () => {
    session.bankOpen[details.dataset.bankKey] = details.open;
  }));
  document.querySelectorAll("[data-results-class]").forEach((button) => button.addEventListener("click", () => {
    if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("results");
    session.resultsClassId = button.dataset.resultsClass;
    session.resultsStudentId = null;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-results-student]").forEach((button) => button.addEventListener("click", () => {
    if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("results");
    session.resultsStudentId = button.dataset.resultsStudent;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-student-details]").forEach((button) => button.addEventListener("click", () => {
    const student = state.students.find((item) => item.id === button.dataset.studentDetails);
    if (!student) return;
    session.resultsClassId = student.classId;
    session.resultsStudentId = student.id;
    session.teacherTab = "results";
    if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("results");
    saveState();
    render();
  }));
  document.querySelectorAll("[data-user-search]").forEach((control) => control.addEventListener("input", () => {
    session.userFilters = session.userFilters || {};
    session.userFilters[`${control.dataset.userSearch}Search`] = control.value;
    render();
  }));
  document.querySelectorAll("[data-user-status]").forEach((control) => control.addEventListener("change", () => {
    session.userFilters = session.userFilters || {};
    session.userFilters[`${control.dataset.userStatus}Status`] = control.value;
    render();
  }));
  document.querySelector("[data-results-back]")?.addEventListener("click", () => {
    session.resultsClassId = null;
    session.resultsStudentId = null;
    render();
  });
  document.querySelector("[data-results-class-back]")?.addEventListener("click", () => {
    session.resultsStudentId = null;
    render();
  });
  document.querySelectorAll("[data-start-full-sheet]").forEach((button) => button.addEventListener("click", () => {
    const sheet = (state.fullSheets || []).find((item) => item.id === button.dataset.startFullSheet);
    if (!sheet) return;
    fullSheetRun = { sheetId: sheet.id, studentId: session.studentId || "student-1", startedAt: new Date().toISOString() };
    session.view = "fullSheetsStudent";
    render();
  }));
  document.querySelector("[data-cancel-full-sheet]")?.addEventListener("click", () => {
    fullSheetRun = null;
    render();
  });
  document.querySelectorAll("[data-activity-filter]").forEach((control) => control.addEventListener("change", () => {
    session.activityFilters = session.activityFilters || {};
    session.activityFilters[control.dataset.activityFilter] = control.value;
    render();
  }));
  document.querySelectorAll("[data-open-class]").forEach((button) => button.addEventListener("click", () => {
    session.teacherClassId = button.dataset.openClass;
    session.teacherClassResultsId = null;
    session.deleteClassMode = false;
    render();
  }));
  document.querySelectorAll("[data-open-class]").forEach((button) => button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    session.teacherClassId = button.dataset.openClass;
    session.teacherClassResultsId = null;
    session.deleteClassMode = false;
    render();
  }));
  document.querySelector("[data-class-back]")?.addEventListener("click", () => {
    session.teacherClassId = null;
    session.teacherClassResultsId = null;
    session.deleteClassMode = false;
    render();
  });
  document.querySelector("[data-toggle-delete-class]")?.addEventListener("click", () => {
    session.deleteClassMode = true;
    render();
  });
  document.querySelector("[data-cancel-delete-class]")?.addEventListener("click", () => {
    session.deleteClassMode = false;
    render();
  });
  document.querySelectorAll("[data-pick-delete-class]").forEach((button) => button.addEventListener("click", () => {
    const classData = state.classes.find((item) => item.id === button.dataset.pickDeleteClass);
    if (!classData) return;
    const confirmed = confirm(`Czy na pewno chcesz usunąć klasę ${classData.name}?`);
    if (!confirmed) return;
    deleteClassWithStudents(classData.id);
    saveState();
    session.teacherTab = "classes";
    session.teacherClassId = null;
    session.teacherClassResultsId = null;
    session.deleteClassMode = false;
    render();
  }));
  document.querySelectorAll("[data-class-results]").forEach((button) => button.addEventListener("click", () => {
    session.teacherClassResultsId = button.dataset.classResults;
    render();
  }));
  document.querySelector("[data-class-results-back]")?.addEventListener("click", () => {
    session.teacherClassResultsId = null;
    render();
  });
  document.querySelectorAll("[data-rename-class]").forEach((button) => button.addEventListener("click", () => {
    const classData = state.classes.find((item) => item.id === button.dataset.renameClass);
    if (!classData) return;
    const name = prompt("Podaj nową nazwę klasy:", classData.name);
    if (!name || !name.trim()) return;
    classData.name = name.trim();
    saveState();
    render();
  }));
  document.querySelectorAll("[data-print-class]").forEach((button) => button.addEventListener("click", () => {
    printClassLogins(button.dataset.printClass);
  }));
  document.querySelectorAll("[data-edit-student]").forEach((button) => button.addEventListener("click", () => {
    const userData = getUserByStudent(button.dataset.editStudent);
    if (!userData) return;
    if (isAdminUser()) {
      const student = state.students.find((item) => item.id === button.dataset.editStudent);
      session.adminStudentProfileId = button.dataset.editStudent;
      session.adminStudentProfileReturnClassId = student?.classId || session.teacherClassId || null;
      session.generatedStudentCredentials = null;
      session.teacherTab = "studentUsers";
      session.teacherClassId = null;
      session.teacherClassResultsId = null;
      render();
      return;
    }
    const name = prompt("Podaj nowe imię i nazwisko ucznia:", userData.name);
    if (!name || !name.trim()) return;
    userData.name = name.trim();
    saveState();
    render();
  }));
  bindForms();
  bindDeletes();
}

function bindForms() {
  const loginForms = document.querySelectorAll("[data-form-login]");
  loginForms.forEach((form) => form.addEventListener("submit", handleLogin));
  document.querySelector("[data-form-register-student]")?.addEventListener("submit", handleStudentRegistration);
  document.querySelector("[data-form-register-teacher]")?.addEventListener("submit", handleTeacherRegistration);
  document.querySelectorAll("[data-clear-login-form]").forEach((form) => {
    if (form.dataset.formLogin === "student") {
      const remembered = getRememberedStudentCredentials();
      if (remembered) {
        const loginInput = form.querySelector('input[name="login"]');
        const passwordInput = form.querySelector('[data-password-role="password"]');
        if (loginInput) loginInput.value = remembered.login;
        if (passwordInput) passwordInput.value = remembered.password;
        return;
      }
    }
    form.querySelectorAll("input").forEach((input) => {
      input.value = "";
      requestAnimationFrame(() => {
        input.value = "";
      });
      setTimeout(() => {
        input.value = "";
      }, 80);
    });
  });
  document.querySelector("[data-form-daily]")?.addEventListener("submit", handleDailyAnswer);
  document.querySelector("[data-form-mini]")?.addEventListener("submit", handleMiniSubmit);
  document.querySelector("[data-form-student-full-sheet]")?.addEventListener("submit", handleStudentFullSheetSubmit);
  document.querySelector("[data-form-student-settings]")?.addEventListener("submit", handleStudentSettings);
  document.querySelector("[data-form-class]")?.addEventListener("submit", handleAddClass);
  document.querySelector("[data-form-student]")?.addEventListener("submit", handleAddStudent);
  document.querySelector("[data-form-task]")?.addEventListener("submit", handleAddTask);
  document.querySelector("[data-form-ready-mini]")?.addEventListener("submit", handleCreateReadyMiniSheet);
  document.querySelector("[data-form-full-sheet]")?.addEventListener("submit", handleAddFullSheet);
  document.querySelector("[data-form-repetytorium]")?.addEventListener("submit", handleSaveRepetytorium);
  document.querySelector("[data-form-teacher-settings]")?.addEventListener("submit", handleTeacherSettings);
  document.querySelector("[data-form-contact]")?.addEventListener("submit", handleContactSubmit);
  document.querySelectorAll("[data-remember-student-password]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.rememberStudentPassword;
    if (action === "yes") {
      rememberStudentCredentials(session.rememberStudentPrompt);
      session.rememberStudentPrompt = null;
      session.showRememberPasswordPrompt = false;
    } else if (action === "never") {
      localStorage.setItem(STUDENT_REMEMBER_NEVER_KEY, "true");
      localStorage.removeItem(STUDENT_REMEMBER_KEY);
      session.rememberStudentPrompt = null;
      session.showRememberPasswordPrompt = false;
    } else {
      session.rememberStudentPrompt = null;
      session.showRememberPasswordPrompt = false;
    }
    render();
  }));
  bindTaskLevelSelect();
  bindRichEditors();
  bindImagePaste();
  bindAttachmentRemovers();
  bindTaskQuestionTypeSelect();
  bindAdminAbcdChoices();
  bindAdminTrueFalseChoices();
  bindAdminAbCdChoices();
  bindAdminDoubleChoiceChoices();
  bindStudentAbcdChoices();
  bindStudentTwoPartChoices();
  bindStudentDoubleChoiceChoices();
  bindMiniSheetBuilder();
  bindFullSheetBuilder();
}

function bindTaskQuestionTypeSelect() {
  const select = document.querySelector("[data-task-question-type]");
  if (!select) return;
  const form = select.closest("form");
  const contentField = form?.querySelector('[data-paste-field="content"]');
  const textField = form?.querySelector("[data-answer-text-field]");
  const abcdField = form?.querySelector("[data-answer-abcd-field]");
  const trueFalseField = form?.querySelector("[data-answer-true-false-field]");
  const abCdField = form?.querySelector("[data-answer-ab-cd-field]");
  const doubleChoiceField = form?.querySelector("[data-answer-double-choice-field]");
  const sync = () => {
    const isAbcd = select.value === "closed-abcd";
    const isTrueFalse = select.value === "true_false" || select.value === "closed-true-false";
    const isAbCd = select.value === "ab_cd" || select.value === "closed-two-answers";
    const isDoubleChoice = select.value === "double_choice" || select.value === "closed-double-choice";
    if (contentField) contentField.hidden = isTrueFalse || isAbCd;
    if (textField) textField.hidden = isAbcd || isTrueFalse || isAbCd || isDoubleChoice;
    if (abcdField) abcdField.hidden = !isAbcd;
    if (trueFalseField) trueFalseField.hidden = !isTrueFalse;
    if (abCdField) abCdField.hidden = !isAbCd;
    if (doubleChoiceField) doubleChoiceField.hidden = !isDoubleChoice;
  };
  select.addEventListener("change", sync);
  sync();
}

function bindAdminAbcdChoices() {
  document.querySelectorAll("[data-admin-abcd-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.closest("[data-answer-abcd-field]");
      const input = field?.querySelector('input[name="correctAbcd"]');
      if (!field || !input) return;
      input.value = button.dataset.adminAbcdChoice || "";
      field.querySelectorAll("[data-admin-abcd-choice]").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
}

function bindAdminTrueFalseChoices() {
  document.querySelectorAll("[data-admin-true-false-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.closest("[data-answer-true-false-field]");
      const partIndex = button.dataset.partIndex || "";
      const input = field?.querySelector(`input[name="trueFalseCorrect${partIndex}"]`);
      if (!field || !input) return;
      input.value = button.dataset.adminTrueFalseChoice || "";
      field.querySelectorAll(`[data-admin-true-false-choice][data-part-index="${partIndex}"]`).forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
}

function bindAdminAbCdChoices() {
  document.querySelectorAll("[data-admin-ab-cd-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.closest("[data-answer-ab-cd-field]");
      const partIndex = button.dataset.partIndex || "";
      const input = field?.querySelector(`input[name="abCdCorrect${partIndex}"]`);
      if (!field || !input) return;
      input.value = button.dataset.adminAbCdChoice || "";
      field.querySelectorAll(`[data-admin-ab-cd-choice][data-part-index="${partIndex}"]`).forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
}

function bindAdminDoubleChoiceChoices() {
  document.querySelectorAll("[data-admin-double-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.closest("[data-answer-double-choice-field]");
      const stepKey = button.dataset.stepKey || "";
      const inputName = stepKey === "step1" ? "doubleChoiceStep1" : "doubleChoiceStep2";
      const input = field?.querySelector(`input[name="${inputName}"]`);
      if (!field || !input) return;
      input.value = button.dataset.adminDoubleChoice || "";
      field.querySelectorAll(`[data-admin-double-choice][data-step-key="${stepKey}"]`).forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
}

function findTaskForAnswerChoice(taskId) {
  return state.tasks.find((task) => task.id === taskId)
    || (dailyRun?.currentTask?.id === taskId ? dailyRun.currentTask : null)
    || miniRun?.tasks?.find((task) => task.id === taskId)
    || (state.fullSheets || []).flatMap((sheet) => sheet.tasks || []).find((task) => task.id === taskId);
}

function bindStudentAbcdChoices() {
  document.querySelectorAll("[data-student-abcd-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.dataset.taskId || "";
      const fieldName = button.dataset.fieldName || `answer-${taskId}`;
      const group = button.closest("[data-student-abcd-group]");
      const form = button.closest("form");
      const input = form?.querySelector(`input[name="${fieldName}"]`);
      const taskData = findTaskForAnswerChoice(taskId);
      const answer = button.dataset.studentAbcdChoice || "";
      if (!input || !group || !taskData) return;
      input.value = answer;
      group.querySelectorAll("[data-student-abcd-choice]").forEach((item) => {
        item.classList.remove("selected", "correct", "incorrect");
      });
      button.classList.add("selected", isCorrect(taskData, answer) ? "correct" : "incorrect");
      if (form?.hasAttribute("data-form-daily")) {
        setTimeout(() => form.requestSubmit(), 420);
      }
    });
  });
}

function bindStudentTwoPartChoices() {
  document.querySelectorAll("[data-student-two-part-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.dataset.taskId || "";
      const fieldName = button.dataset.fieldName || `answer-${taskId}`;
      const partIndex = Number(button.dataset.partIndex || 0);
      const group = button.closest("[data-student-two-part-group]");
      const form = button.closest("form");
      const input = form?.querySelector(`input[name="${fieldName}"]`);
      const taskData = findTaskForAnswerChoice(taskId);
      if (!input || !group || !taskData) return;
      const values = String(input.value || ",").split(",");
      values[partIndex] = button.dataset.studentTwoPartChoice || "";
      input.value = `${values[0] || ""},${values[1] || ""}`;
      group.querySelectorAll(`[data-student-two-part-choice][data-part-index="${partIndex}"]`).forEach((item) => {
        item.classList.remove("selected", "correct", "incorrect");
      });
      button.classList.add("selected");
    });
  });
}

function bindStudentDoubleChoiceChoices() {
  document.querySelectorAll("[data-student-double-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.dataset.taskId || "";
      const fieldName = button.dataset.fieldName || `answer-${taskId}`;
      const stepKey = button.dataset.stepKey || "";
      const form = button.closest("form");
      const group = button.closest("[data-student-double-choice-group]");
      const input = form?.querySelector(`input[name="${fieldName}"]`);
      if (!input || !group || !stepKey) return;
      const values = String(input.value || ",").split(",");
      if (stepKey === "step1") values[0] = button.dataset.studentDoubleChoice || "";
      if (stepKey === "step2") values[1] = button.dataset.studentDoubleChoice || "";
      input.value = `${values[0] || ""},${values[1] || ""}`;
      group.querySelectorAll(`[data-student-double-choice][data-step-key="${stepKey}"]`).forEach((item) => {
        item.classList.remove("selected", "correct", "incorrect");
      });
      button.classList.add("selected");
    });
  });
}

function bindDeletes() {
  document.querySelectorAll("[data-delete-student]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.deleteStudent;
    state.students = state.students.filter((student) => student.id !== id);
    state.classes.forEach((classData) => classData.studentIds = classData.studentIds.filter((studentId) => studentId !== id));
    delete state.progress[id];
    saveState();
    render();
  }));
  document.querySelectorAll("[data-delete-class]").forEach((button) => button.addEventListener("click", () => {
    const classData = state.classes.find((item) => item.id === button.dataset.deleteClass);
    const confirmed = confirm("Czy na pewno chcesz usunąć klasę? Usunięci zostaną również przypisani uczniowie i ich dane.");
    if (!confirmed || !classData) return;
    deleteClassWithStudents(classData.id);
    saveState();
    session.teacherTab = "classes";
    session.teacherClassId = null;
    render();
  }));
  document.querySelectorAll("[data-delete-task]").forEach((button) => button.addEventListener("click", () => {
    const confirmed = confirm("Czy na pewno chcesz usunąć to zadanie?");
    if (!confirmed) return;
    const scrollY = window.scrollY;
    state.tasks = state.tasks.filter((task) => task.id !== button.dataset.deleteTask);
    saveState();
    session.view = "teacher";
    session.teacherTab = "tasks";
    render();
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }));
  document.querySelectorAll("[data-edit-task]").forEach((button) => button.addEventListener("click", () => {
    const task = state.tasks.find((item) => item.id === button.dataset.editTask);
    if (!task || !isAdminUser()) return;
    session.editTaskId = task.id;
    session.teacherTab = "add";
    session.view = "teacher";
    taskDraftAttachments = emptyAttachments();
    taskDraftAttachments.content = JSON.parse(JSON.stringify(getTaskAttachments(task, "content")));
    taskDraftAttachments.solution = JSON.parse(JSON.stringify(getTaskAttachments(task, "solution")));
    taskDraftAttachments.trueFalseText1 = JSON.parse(JSON.stringify(task.contentParts?.[0]?.attachments || []));
    taskDraftAttachments.trueFalseText2 = JSON.parse(JSON.stringify(task.contentParts?.[1]?.attachments || []));
    taskDraftAttachments.abCdText1 = JSON.parse(JSON.stringify(task.contentParts?.[0]?.attachments || []));
    taskDraftAttachments.abCdText2 = JSON.parse(JSON.stringify(task.contentParts?.[1]?.attachments || []));
    render();
  }));
  document.querySelectorAll("[data-delete-ready-mini]").forEach((button) => button.addEventListener("click", () => {
    const confirmed = confirm("Czy na pewno chcesz usunąć ten miniarkuszł");
    if (!confirmed) return;
    const sheet = (state.readyMiniSheets || []).find((item) => item.id === button.dataset.deleteReadyMini);
    const taskIds = new Set(sheet? sheet.taskIds : []);
    state.readyMiniSheets = (state.readyMiniSheets || []).filter((item) => item.id !== button.dataset.deleteReadyMini);
    state.tasks = state.tasks.filter((task) => !taskIds.has(task.id));
    saveState();
    session.view = "teacher";
    session.teacherTab = "readyMini";
    render();
  }));
  document.querySelectorAll("[data-edit-ready-mini]").forEach((button) => button.addEventListener("click", () => {
    const sheet = (state.readyMiniSheets || []).find((item) => item.id === button.dataset.editReadyMini);
    if (!sheet) return;
    session.editReadyMiniId = sheet.id;
    session.teacherTab = "createMini";
    taskDraftAttachments = emptyAttachments();
    sheet.taskIds.map((taskId) => state.tasks.find((task) => task.id === taskId)).filter(Boolean).forEach((task, index) => {
      taskDraftAttachments[`mini-${index}-content`] = JSON.parse(JSON.stringify(getTaskAttachments(task, "content")));
      taskDraftAttachments[`mini-${index}-answers`] = JSON.parse(JSON.stringify(getTaskAttachments(task, "answers")));
    });
    render();
  }));
  document.querySelectorAll("[data-preview-full-sheet]").forEach((button) => button.addEventListener("click", () => {
    session.previewFullSheetId = button.dataset.previewFullSheet;
    session.editFullSheetId = null;
    session.teacherTab = "fullSheets";
    session.view = "teacher";
    render();
  }));
  document.querySelectorAll("[data-edit-full-sheet]").forEach((button) => button.addEventListener("click", () => {
    const sheet = (state.fullSheets || []).find((item) => item.id === button.dataset.editFullSheet);
    if (!sheet) return;
    session.editFullSheetId = sheet.id;
    session.previewFullSheetId = null;
    session.teacherTab = "addFullSheet";
    session.teacherNotice = null;
    taskDraftAttachments = emptyAttachments();
    render();
  }));
  document.querySelector("[data-back-full-sheets]")?.addEventListener("click", () => {
    session.previewFullSheetId = null;
    session.editFullSheetId = null;
    session.teacherTab = "fullSheets";
    render();
  });
  document.querySelectorAll("[data-delete-full-sheet]").forEach((button) => button.addEventListener("click", () => {
    const confirmed = confirm("Czy na pewno chcesz usunąć ten arkuszł");
    if (!confirmed) return;
    state.fullSheets = (state.fullSheets || []).filter((item) => item.id !== button.dataset.deleteFullSheet);
    saveState();
    session.view = "teacher";
    session.teacherTab = "fullSheets";
    session.previewFullSheetId = null;
    session.editFullSheetId = null;
    render();
  }));
  document.querySelectorAll("[data-edit-repetytorium]").forEach((button) => button.addEventListener("click", () => {
    const item = (state.repetytoriumContent || []).find((entry) => entry.id === button.dataset.editRepetytorium);
    if (!item) return;
    session.editRepetytoriumId = item.id;
    session.teacherTab = "addRepetytorium";
    taskDraftAttachments = { content: JSON.parse(JSON.stringify(item.attachments?.content || [])) };
    render();
  }));
  document.querySelectorAll("[data-delete-repetytorium]").forEach((button) => button.addEventListener("click", () => {
    const confirmed = confirm("Czy na pewno chcesz usunąć tę treść repetytorium?");
    if (!confirmed) return;
    state.repetytoriumContent = (state.repetytoriumContent || []).filter((item) => item.id !== button.dataset.deleteRepetytorium);
    saveState();
    session.view = "teacher";
    session.teacherTab = "repetytorium";
    render();
  }));
  document.querySelectorAll("[data-read-contact-message]").forEach((button) => button.addEventListener("click", () => {
    const message = (state.contactMessages || []).find((entry) => entry.id === button.dataset.readContactMessage);
    if (!message) return;
    markContactMessageRead(message.id)
      .then((updated) => {
        Object.assign(message, updated);
        session.view = "teacher";
        session.teacherTab = "messages";
        render();
      })
      .catch((error) => {
        console.error("Nie udało się oznaczyć wiadomości jako przeczytanej.", error);
        alert("Nie udało się oznaczyć wiadomości jako przeczytanej.");
      });
  }));
  document.querySelectorAll("[data-delete-contact-message]").forEach((button) => button.addEventListener("click", () => {
    const confirmed = confirm("Czy na pewno chcesz usun\u0105\u0107 t\u0119 wiadomo\u015b\u0107?");
    if (!confirmed) return;
    const id = button.dataset.deleteContactMessage;
    removeContactMessage(id)
      .then(() => {
        state.contactMessages = (state.contactMessages || []).filter((entry) => entry.id !== id);
        session.view = "teacher";
        session.teacherTab = "messages";
        render();
      })
      .catch((error) => {
        console.error("Nie udało się usunąć wiadomości kontaktowej.", error);
        alert("Nie udało się usunąć wiadomości.");
      });
  }));
  document.querySelectorAll("[data-approve-teacher]").forEach((button) => button.addEventListener("click", () => {
    const teacher = state.teachers.find((item) => item.id === button.dataset.approveTeacher);
    if (!teacher) return;
    teacher.status = "approved";
    teacher.verifiedAt = new Date().toISOString();
    const userData = state.users.find((item) => item.id === teacher.userId);
    if (userData) userData.status = "approved";
    saveState();
    render();
  }));
  document.querySelectorAll("[data-reject-teacher]").forEach((button) => button.addEventListener("click", () => {
    const teacher = state.teachers.find((item) => item.id === button.dataset.rejectTeacher);
    if (!teacher) return;
    teacher.status = "rejected";
    teacher.rejectedAt = new Date().toISOString();
    const userData = state.users.find((item) => item.id === teacher.userId);
    if (userData) userData.status = "rejected";
    saveState();
    render();
  }));
  document.querySelectorAll("[data-delete-teacher-request]").forEach((button) => button.addEventListener("click", () => {
    const teacher = state.teachers.find((item) => item.id === button.dataset.deleteTeacherRequest);
    if (!teacher || !confirm("Czy na pewno chcesz usunąć konto lub zgłoszenie nauczyciela?")) return;
    deleteTeacherAccount(teacher.id);
    saveState();
    render();
  }));
  document.querySelectorAll("[data-edit-teacher-user]").forEach((button) => button.addEventListener("click", () => {
    const teacher = state.teachers.find((item) => item.id === button.dataset.editTeacherUser);
    const userData = teacher ? state.users.find((item) => item.id === teacher.userId) : null;
    if (!teacher || !userData) return;
    const name = prompt("Imię i nazwisko nauczyciela:", userData.name || "");
    if (name === null) return;
    const login = prompt("Login nauczyciela:", userData.login || "");
    if (login === null) return;
    const email = prompt("E-mail nauczyciela:", userData.email || "");
    if (email === null) return;
    const school = prompt("Szkoła:", teacher.school || "");
    if (school === null) return;
    const city = prompt("Miejscowość:", teacher.city || "");
    if (city === null) return;
    userData.name = name.trim() || userData.name;
    userData.login = login.trim() || userData.login;
    userData.email = email.trim();
    teacher.school = school.trim();
    teacher.city = city.trim();
    saveState();
    render();
  }));
  document.querySelectorAll("[data-delete-teacher-account]").forEach((button) => button.addEventListener("click", () => {
    const teacher = state.teachers.find((item) => item.id === button.dataset.deleteTeacherAccount);
    if (!teacher || !confirm("Czy na pewno chcesz usunąć konto nauczyciela? Klasy i uczniowie zostaną odpięci od tego konta.")) return;
    deleteTeacherAccount(teacher.id);
    saveState();
    render();
  }));
  document.querySelectorAll("[data-edit-student-user]").forEach((button) => button.addEventListener("click", () => {
    const student = state.students.find((item) => item.id === button.dataset.editStudentUser);
    const userData = student ? state.users.find((item) => item.id === student.userId) : null;
    if (!student || !userData) return;
    session.adminStudentProfileId = student.id;
    session.adminStudentProfileReturnClassId = null;
    session.generatedStudentCredentials = null;
    render();
  }));
  document.querySelector("[data-admin-student-profile-back]")?.addEventListener("click", () => {
    const returnClassId = session.adminStudentProfileReturnClassId;
    session.adminStudentProfileId = null;
    session.adminStudentProfileReturnClassId = null;
    session.generatedStudentCredentials = null;
    if (returnClassId) {
      session.teacherTab = "classes";
      session.teacherClassId = returnClassId;
      session.teacherClassResultsId = null;
    }
    render();
  });
  document.querySelectorAll("[data-regenerate-student-login]").forEach((button) => button.addEventListener("click", async () => {
    if (!isAdminUser()) return;
    const student = state.students.find((item) => item.id === button.dataset.regenerateStudentLogin);
    const userData = student ? state.users.find((item) => item.id === student.userId) : null;
    if (!student || !userData) return;
    if (!confirm("Czy na pewno chcesz wygenerować nowe dane logowania dla tego ucznia?")) return;
    const previousLogin = userData.login;
    const previousPassword = userData.password;
    const credentials = generateStudentCredentials(userData.name || "uczeń");
    userData.login = credentials.login;
    userData.password = credentials.password;
    userData.role = "student";
    try {
      await saveUserRecord(userData);
      session.generatedStudentCredentials = { studentId: student.id, ...credentials };
      session.teacherNotice = "Nowe dane logowania zostały zapisane.";
      render();
    } catch (error) {
      userData.login = previousLogin;
      userData.password = previousPassword;
      console.error("Nie udało się zapisać nowych danych logowania ucznia.", error);
      alert("Nie udało się zapisać nowych danych logowania ucznia.");
    }
  }));
  document.querySelectorAll("[data-copy-student-credentials]").forEach((button) => button.addEventListener("click", async () => {
    const login = button.dataset.copyLogin || "";
    const password = button.dataset.copyPassword || "";
    const text = `Login: ${login}\nHasło: ${password}`;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Skopiowano";
    } catch (error) {
      console.error("Nie udało się skopiować danych logowania.", error);
      alert(text);
    }
  }));
  document.querySelectorAll("[data-delete-student-account]").forEach((button) => button.addEventListener("click", () => {
    const student = state.students.find((item) => item.id === button.dataset.deleteStudentAccount);
    if (!student || !confirm("Czy na pewno chcesz usunąć konto ucznia i jego dane?")) return;
    deleteStudentAccount(student.id);
    saveState();
    render();
  }));

}

function bindTaskLevelSelect() {
  const levelSelect = document.querySelector("[data-task-level]");
  const topicSelect = document.querySelector("[data-task-topic]");
  if (!levelSelect || !topicSelect) return;
  const syncTopics = () => {
    const levelNumber = levelSelect.value;
    let firstVisible = null;
    Array.from(topicSelect.options).forEach((option) => {
      const visible = option.dataset.level === levelNumber;
      option.hidden = !visible;
      option.disabled = !visible;
      if (visible && !firstVisible) firstVisible = option.value;
    });
    if (!topicSelect.selectedOptions[0] || topicSelect.selectedOptions[0].disabled) {
      topicSelect.value = firstVisible;
    }
  };
  levelSelect.addEventListener("change", syncTopics);
  syncTopics();
}

function bindRichEditors() {
  document.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    syncRichEditor(editor);
    if (editor.dataset.richBound === "true") return;
    editor.dataset.richBound = "true";
    editor.addEventListener("input", () => syncRichEditor(editor));
  });
}

function bindImagePaste() {
  document.querySelectorAll("[data-rich-editor]").forEach((editor) => {
    if (editor.dataset.pasteBound === "true") return;
    editor.dataset.pasteBound = "true";
    editor.addEventListener("paste", (event) => {
      const field = editor.dataset.richEditor;
      const items = Array.from(event.clipboardData?.items || []);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (!field) return;
      taskDraftAttachments[field] = taskDraftAttachments[field] || [];
      if (!imageItems.length) {
        event.preventDefault();
        insertPlainText(editor, event.clipboardData?.getData("text/plain") || "");
        syncRichEditor(editor);
        return;
      }
      event.preventDefault();
      imageItems.forEach((item) => {
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          taskDraftAttachments[field].push({
            id: uid("img"),
            name: file.name || "obrazek-ze-schowka.png",
            type: file.type,
            dataUrl: reader.result
          });
          appendAttachmentThumb(editor, field, taskDraftAttachments[field].length - 1);
          syncRichEditor(editor);
        };
        reader.readAsDataURL(file);
      });
    });
  });
}

function bindMiniSheetBuilder() {
  document.querySelectorAll("[data-add-mini-task]").forEach((button) => {
    if (button.dataset.miniAddBound === "true") return;
    button.dataset.miniAddBound = "true";
    button.addEventListener("click", () => {
      const list = document.querySelector("[data-mini-sheet-task-list]");
      if (!list) return;
      const indexes = Array.from(list.querySelectorAll("[data-mini-sheet-task]"))
        .map((task) => Number(task.dataset.index || 0));
      const nextIndex = indexes.length ? Math.max(...indexes) + 1 : 0;
      list.insertAdjacentHTML("beforeend", miniSheetTaskEditor(nextIndex));
      renumberMiniSheetTasks(list);
      bindRichEditors();
      bindImagePaste();
      bindAttachmentRemovers(list);
    });
  });

  document.querySelectorAll("[data-mini-sheet-task-list]").forEach((list) => {
    if (list.dataset.miniListBound === "true") return;
    list.dataset.miniListBound = "true";
    list.addEventListener("click", (event) => {
      const task = event.target.closest("[data-mini-sheet-task]");
      if (!task) return;
      if (event.target.closest("[data-remove-mini-task]")) {
        const tasks = list.querySelectorAll("[data-mini-sheet-task]");
        if (tasks.length <= 1) {
          alert("Miniarkusz musi mieć przynajmniej jedno zadanie.");
          return;
        }
        task.remove();
        renumberMiniSheetTasks(list);
      }
      const moveButton = event.target.closest("[data-move-mini-task]");
      if (!moveButton) return;
      if (moveButton.dataset.moveMiniTask === "up" && task.previousElementSibling) {
        list.insertBefore(task, task.previousElementSibling);
      }
      if (moveButton.dataset.moveMiniTask === "down" && task.nextElementSibling) {
        list.insertBefore(task.nextElementSibling, task);
      }
      renumberMiniSheetTasks(list);
    });
  });
}

function renumberMiniSheetTasks(list) {
  list.querySelectorAll("[data-mini-sheet-task]").forEach((task, index) => {
    const number = task.querySelector("[data-task-number]");
    if (number) number.textContent = index + 1;
  });
}

function bindFullSheetBuilder() {
  document.querySelectorAll("[data-add-sheet-task]").forEach((button) => {
    if (button.dataset.sheetAddBound === "true") return;
    button.dataset.sheetAddBound = "true";
    button.addEventListener("click", () => {
      const list = document.querySelector("[data-full-sheet-task-list]");
      if (!list) return;
      const indexes = Array.from(list.querySelectorAll("[data-full-sheet-task]"))
        .map((task) => Number(task.dataset.index || 0));
      const nextIndex = indexes.length ? Math.max(...indexes) + 1 : 0;
      list.insertAdjacentHTML("beforeend", fullSheetTaskEditor(nextIndex));
      renumberFullSheetTasks(list);
      bindRichEditors();
      bindImagePaste();
      bindAttachmentRemovers(list);
    });
  });

  document.querySelectorAll("[data-full-sheet-task-list]").forEach((list) => {
    if (list.dataset.sheetListBound === "true") return;
    list.dataset.sheetListBound = "true";
    list.addEventListener("click", (event) => {
      const task = event.target.closest("[data-full-sheet-task]");
      if (!task) return;
      if (event.target.closest("[data-focus-sheet-task]")) {
        task.querySelector("[data-rich-editor]")?.focus();
        return;
      }
      if (event.target.closest("[data-remove-sheet-task]")) {
        const tasks = list.querySelectorAll("[data-full-sheet-task]");
        if (tasks.length <= 1) {
          alert("Arkusz musi mieć przynajmniej jedno zadanie.");
          return;
        }
        task.remove();
        renumberFullSheetTasks(list);
      }
      const moveButton = event.target.closest("[data-move-sheet-task]");
      if (!moveButton) return;
      if (moveButton.dataset.moveSheetTask === "up" && task.previousElementSibling) {
        list.insertBefore(task, task.previousElementSibling);
      }
      if (moveButton.dataset.moveSheetTask === "down" && task.nextElementSibling) {
        list.insertBefore(task.nextElementSibling, task);
      }
      renumberFullSheetTasks(list);
    });
  });
}

function renumberFullSheetTasks(list) {
  list.querySelectorAll("[data-full-sheet-task]").forEach((task, index) => {
    const number = task.querySelector("[data-task-number]");
    if (number) number.textContent = index + 1;
  });
}

function bindAttachmentRemovers(root = document) {
  root.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      const [field, indexText] = button.dataset.removeAttachment.split(":");
      const index = Number(indexText);
      taskDraftAttachments[field] = taskDraftAttachments[field] || [];
      taskDraftAttachments[field]?.splice(index, 1);
      refreshRichEditorAttachments(field);
    });
  });
}

function syncRichEditor(editor) {
  const field = editor.dataset.richEditor;
  const hidden = document.querySelector(`textarea[name="${field}"]`);
  if (!hidden) return;
  hidden.value = getEditorText(editor);
}

function syncAllRichEditors() {
  document.querySelectorAll("[data-rich-editor]").forEach((editor) => syncRichEditor(editor));
}

function getEditorText(editor) {
  const clone = editor.cloneNode(true);
  clone.querySelectorAll(".attachment-thumb").forEach((item) => item.remove());
  return clone.innerText.replace(/\u00a0/g, " ").trim();
}

function insertPlainText(editor, text) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    editor.append(document.createTextNode(text));
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function appendAttachmentThumb(editor, field, index) {
  const image = taskDraftAttachments[field][index];
  if (!image) return;
  const wrapper = document.createElement("div");
  wrapper.className = "attachment-thumb";
  wrapper.contentEditable = "false";
  const img = document.createElement("img");
  img.src = image.dataUrl;
  img.alt = image.name || `Załącznik ${index + 1}`;
  const button = document.createElement("button");
  button.className = "btn danger";
  button.type = "button";
  button.dataset.removeAttachment = `${field}:${index}`;
  button.textContent = "Usuń obrazek";
  wrapper.append(img, button);
  editor.append(wrapper);
  editor.append(document.createElement("br"));
  bindAttachmentRemovers(wrapper);
}

function refreshRichEditorAttachments(field) {
  const editor = document.querySelector(`[data-rich-editor="${field}"]`);
  if (!editor) return;
  taskDraftAttachments[field] = taskDraftAttachments[field] || [];
  const text = getEditorText(editor);
  editor.innerHTML = "";
  if (text) editor.append(document.createTextNode(text));
  taskDraftAttachments[field].forEach((_, index) => appendAttachmentThumb(editor, field, index));
  syncRichEditor(editor);
}

function deleteClassWithStudents(classId) {
  const studentsToDelete = state.students.filter((student) => student.classId === classId);
  const studentIds = new Set(studentsToDelete.map((student) => student.id));
  const userIds = new Set(studentsToDelete.map((student) => student.userId));
  state.classes = state.classes.filter((classData) => classData.id !== classId);
  state.students = state.students.filter((student) => !studentIds.has(student.id));
  state.users = state.users.filter((userData) => !userIds.has(userData.id));
  studentIds.forEach((studentId) => delete state.progress[studentId]);
  state.attempts = state.attempts.filter((attempt) => !studentIds.has(attempt.studentId));
  state.solvedTasks = state.solvedTasks.filter((item) => !studentIds.has(item.studentId));
  state.dailyAccess = state.dailyAccess.filter((item) => !studentIds.has(item.studentId));
  state.miniSheets = state.miniSheets.filter((sheet) => !studentIds.has(sheet.studentId));
}

function deleteStudentAccount(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return;
  state.classes.forEach((classData) => {
    classData.studentIds = (classData.studentIds || []).filter((id) => id !== studentId);
  });
  state.students = state.students.filter((item) => item.id !== studentId);
  state.users = state.users.filter((item) => item.id !== student.userId);
  delete state.progress[studentId];
  state.attempts = state.attempts.filter((attempt) => attempt.studentId !== studentId);
  state.solvedTasks = state.solvedTasks.filter((item) => item.studentId !== studentId);
  state.dailyAccess = state.dailyAccess.filter((item) => item.studentId !== studentId);
  state.miniSheets = state.miniSheets.filter((sheet) => sheet.studentId !== studentId);
}

function deleteTeacherAccount(teacherId) {
  const teacher = state.teachers.find((item) => item.id === teacherId);
  if (!teacher) return;
  state.classes.forEach((classData) => {
    if (classData.teacherId === teacherId) classData.teacherId = null;
  });
  state.students.forEach((student) => {
    if (student.teacherId === teacherId) student.teacherId = null;
  });
  state.teachers = state.teachers.filter((item) => item.id !== teacherId);
  state.users = state.users.filter((item) => item.id !== teacher.userId);
}

function printClassLogins(classId) {
  const classData = state.classes.find((item) => item.id === classId);
  if (!classData) return;
  const students = state.students.filter((student) => student.classId === classId);
  const rows = students.map((student, index) => {
    const userData = getUserByStudent(student.id);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(userData.name)}</td>
        <td>${escapeHtml(userData.login)}</td>
        <td>${escapeHtml(userData.password)}</td>
      </tr>
    `;
  }).join("");
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Przeglądarka zablokowała okno wydruku. Zezwól na wyskakujące okna dla tej strony.");
    return;
  }
  printWindow.document.write(`
    <!doctype html>
    <html lang="pl">
      <head>
        <meta charset="utf-8" />
        <title>Loginy i hasła - ${escapeHtml(classData.name)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #1f2433; }
          h1 { margin: 0 0 6px; font-size: 26px; }
          p { margin: 0 0 22px; color: #555; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #d8d8d8; padding: 10px 12px; text-align: left; }
          th { background: #f3efe8; }
          tr:nth-child(even) td { background: #fbfaf7; }
          @media print { button { display: none; } body { margin: 18mm; } }
        </style>
      </head>
      <body>
        <h1>MatDaily - loginy i hasła</h1>
        <p>Klasa: <strong>${escapeHtml(classData.name)}</strong></p>
        <table>
          <thead><tr><th>Lp.</th><th>Uczeń</th><th>Login</th><th>Hasło</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4">Brak uczniów w tej klasie.</td></tr>`}</tbody>
        </table>
        <script>window.onload = () => window.print();<\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

async function handleAction(action) {
  if (action === "home") {
    if (session.role === "student") session.view = "student";
    else if (session.role === "teacher" || session.role === "admin") {
      session.view = "teacher";
      session.teacherTab = "dashboard";
    }
    else session.view = "home";
  }
  if (action === "guest") {
    state = seedState();
    session = { role: "guest", studentId: null, teacherId: null, view: "student", teacherTab: "dashboard", loginRole: null, resultsClassId: null, resultsStudentId: null, teacherClassId: null, teacherNotice: null, teacherLastStudent: null, userFilters: {}, bankOpen: {}, rememberStudentPrompt: null, showRememberPasswordPrompt: false };
  }
  if (action === "logout") {
    dailyRun = null;
    miniRun = null;
    fullSheetRun = null;
    sessionStorage.removeItem("matdaily-demo-state");
    state = await loadState();
    session = { role: "guest", studentId: null, teacherId: null, view: "home", teacherTab: "dashboard", loginRole: null, resultsClassId: null, resultsStudentId: null, teacherClassId: null, teacherNotice: null, teacherLastStudent: null, userFilters: {}, bankOpen: {}, rememberStudentPrompt: null, showRememberPasswordPrompt: false };
  }
  render();
}

async function handleLogin(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const role = event.currentTarget.dataset.formLogin;
  const form = new FormData(event.currentTarget);
  const login = String(form.get("login") || "").trim();
  const password = readPasswordField(formElement);
  const normalizedLogin = login.toLowerCase();
  try {
    state = await refreshAppState(seedState, normalizeState, emptyState);
    const userData = state.users.find((item) => {
      const itemLogin = String(item.login || "").trim().toLowerCase();
      const itemEmail = String(item.email || item.data?.email || "").trim().toLowerCase();
      const itemPassword = String(item.password || "");
      if (role === "student") {
        return item.role === "student" && itemLogin === normalizedLogin && itemPassword === password;
      }
      return (item.role === "teacher" || item.role === "admin") &&
        (itemLogin === normalizedLogin || (itemEmail && itemEmail === normalizedLogin)) &&
        itemPassword === password;
    });
    console.log("Próba logowania:", login);
    console.log("Znaleziony użytkownik:", userData);
    console.log("Rola:", userData?.role);
    console.log("Hasło z bazy:", userData?.password);
    if (!userData) {
      alert("Nieprawid\u0142owy login lub has\u0142o.");
      return;
    }
    if (role === "student") {
      const student = state.students.find((item) => item.userId === userData.id);
      if (!student) {
        alert("Nie znaleziono konta ucznia.");
        return;
      }
      touchUserActivity(userData.id, "login");
      await saveUserRecord(userData);
      const shouldAskRemember = !getRememberedStudentCredentials() && localStorage.getItem(STUDENT_REMEMBER_NEVER_KEY) !== "true";
      session = { role: "student", studentId: student.id, teacherId: null, view: "student", teacherTab: "dashboard", loginRole: null, loginMode: "login", resultsClassId: null, resultsStudentId: null, teacherClassId: null, teacherNotice: null, teacherLastStudent: null, userFilters: {}, bankOpen: {}, rememberStudentPrompt: shouldAskRemember ? { login: userData.login, password } : null, showRememberPasswordPrompt: shouldAskRemember };
    } else if (userData.role === "admin") {
      touchUserActivity(userData.id, "login");
      await saveUserRecord(userData);
      session = { role: "admin", studentId: null, teacherId: null, view: "teacher", teacherTab: "dashboard", loginRole: null, loginMode: "login", resultsClassId: null, resultsStudentId: null, teacherClassId: null, teacherNotice: null, teacherLastStudent: null, userFilters: {}, bankOpen: {}, rememberStudentPrompt: null, showRememberPasswordPrompt: false };
    } else {
      const teacher = teacherProfileForUser(userData);
      if (!teacher) {
        alert("Nie znaleziono konta nauczyciela.");
        return;
      }
      if (!teacher.status && (userData.id === "u-teacher-1" || userData.login === "nauczyciel")) {
        teacher.status = "approved";
      }
      if (teacher.status === "pending") {
        alert("Twoje konto oczekuje na weryfikację administratora.");
        return;
      }
      if (teacher.status === "rejected") {
        alert("Zg\u0142oszenie nauczyciela zosta\u0142o odrzucone.");
        return;
      }
      touchUserActivity(userData.id, "login");
      await saveUserRecord(userData);
      logActivity({ type: "teacher-login", userId: userData.id, userName: userData.name, description: `${userData.name} zalogował się do panelu` });
      session = { role: "teacher", studentId: null, teacherId: teacher.id, view: "teacher", teacherTab: "dashboard", loginRole: null, loginMode: "login", resultsClassId: null, resultsStudentId: null, teacherClassId: null, teacherNotice: null, teacherLastStudent: null, userFilters: {}, bankOpen: {}, rememberStudentPrompt: null, showRememberPasswordPrompt: false };
    }
    dailyRun = null;
    miniRun = null;
    fullSheetRun = null;
    render();
  } catch (error) {
    console.error("Błąd logowania z Supabase:", error);
    alert("Nie udało się zalogować. Sprawdź połączenie z bazą danych.");
  }
}

function readPasswordField(formElement, role = "password") {
  return String(formElement.querySelector(`[data-password-role="${role}"]`)?.value || "");
}

function getRememberedStudentCredentials() {
  try {
    const raw = localStorage.getItem(STUDENT_REMEMBER_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.login || !data?.password) return null;
    return { login: String(data.login), password: String(data.password) };
  } catch {
    return null;
  }
}

function rememberStudentCredentials(credentials) {
  if (!credentials?.login || !credentials?.password) return;
  localStorage.setItem(STUDENT_REMEMBER_KEY, JSON.stringify({ login: credentials.login, password: credentials.password }));
}

async function handleStudentRegistration(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const login = String(form.get("login") || "").trim();
  const password = readPasswordField(formElement);
  const passwordRepeat = readPasswordField(formElement, "repeat");
  if (!name || !login || !password || !passwordRepeat) {
    alert("Uzupe\u0142nij wymagane pola.");
    return;
  }
  if (password !== passwordRepeat) {
    alert("Has\u0142a nie s\u0105 takie same.");
    return;
  }
  const now = new Date().toISOString();
  const userId = uid("u");
  const studentId = uid("student");
  try {
    state = await refreshAppState(seedState, normalizeState, emptyState);
    if (state.users.some((item) => normalizeAnswer(item.login) === normalizeAnswer(login))) {
      alert("Ten login jest już zajęty.");
      return;
    }
    await registerStudentInSupabase({ userId, studentId, name, login, password, createdAt: now });
    state = await refreshAppState(seedState, normalizeState, emptyState);
    alert("Konto ucznia zostało utworzone. Możesz się zalogować.");
    session.loginMode = "login";
    render();
  } catch (error) {
    showRegistrationError(error);
  }
}

async function handleTeacherRegistration(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const login = String(form.get("login") || "").trim();
  const password = readPasswordField(formElement);
  const passwordRepeat = readPasswordField(formElement, "repeat");
  const school = String(form.get("school") || "").trim();
  const city = String(form.get("city") || "").trim();
  const note = String(form.get("note") || "").trim();
  if (!name || !email || !login || !password || !passwordRepeat || !school || !city) {
    alert("Uzupe\u0142nij wymagane pola.");
    return;
  }
  if (password !== passwordRepeat) {
    alert("Has\u0142a nie s\u0105 takie same.");
    return;
  }
  const userId = uid("u");
  const teacherId = uid("teacher");
  const registeredAt = new Date().toISOString();
  try {
    state = await refreshAppState(seedState, normalizeState, emptyState);
    if (state.users.some((item) => normalizeAnswer(item.login) === normalizeAnswer(login) || normalizeAnswer(item.email) === normalizeAnswer(email))) {
      alert("Ten login lub e-mail jest już zajęty.");
      return;
    }
    await registerTeacherInSupabase({ userId, teacherId, name, email, login, password, school, city, note, registeredAt });
    state = await refreshAppState(seedState, normalizeState, emptyState);
    alert("Zgłoszenie zostało wysłane. Konto będzie aktywne po weryfikacji administratora.");
    session.loginMode = "login";
    render();
  } catch (error) {
    showRegistrationError(error);
  }
}

async function registerStudentInSupabase({ userId, studentId, name, login, password, createdAt }) {
  if (!supabase) throw new Error("Brak konfiguracji Supabase.");
  const progress = defaultProgress();
  const userData = user(userId, "student", login, password, name, {
    createdAt,
    lastLogin: null,
    lastActive: null,
    isActive: true,
    activityStatus: "active",
    status: "active"
  });
  const studentData = { id: studentId, userId, classId: null, teacherId: null, source: "self" };
  const { error: userError } = await supabase.from("users").insert([{
    id: userId,
    role: "student",
    login,
    password,
    name,
    created_at: createdAt,
    data: userData
  }]);
  if (userError) throw userError;
  const { error: studentError } = await supabase.from("students").insert([{
    id: studentId,
    user_id: userId,
    class_id: null,
    teacher_id: null,
    created_at: createdAt,
    data: studentData
  }]);
  if (studentError) throw studentError;
  const { error: progressError } = await supabase.from("progress").insert([{
    student_id: studentId,
    topic_id: progress.topicId,
    day_in_topic: progress.dayInTopic,
    total_work_days: progress.totalWorkDays,
    points: progress.points,
    data: progress
  }]);
  if (progressError) throw progressError;
}

async function registerTeacherInSupabase({ userId, teacherId, name, email, login, password, school, city, note, registeredAt }) {
  if (!supabase) throw new Error("Brak konfiguracji Supabase.");
  const userData = user(userId, "teacher", login, password, name, {
    email,
    createdAt: registeredAt,
    lastActive: null,
    lastLogin: null,
    isActive: true,
    activityStatus: "active",
    status: "pending"
  });
  const teacherData = { id: teacherId, userId, status: "pending", school, city, note, registeredAt };
  const { error: userError } = await supabase.from("users").insert([{
    id: userId,
    role: "teacher",
    login,
    password,
    name,
    created_at: registeredAt,
    data: userData
  }]);
  if (userError) throw userError;
  const { error: teacherError } = await supabase.from("teachers").insert([{
    id: teacherId,
    user_id: userId,
    created_at: registeredAt,
    data: teacherData
  }]);
  if (teacherError) throw teacherError;
}

function showRegistrationError(error) {
  console.error("Błąd rejestracji:", error);
  alert(
    "Błąd rejestracji:\n" +
    "message: " + (error?.message || "brak") + "\n" +
    "details: " + (error?.details || "brak") + "\n" +
    "hint: " + (error?.hint || "brak") + "\n" +
    "code: " + (error?.code || "brak")
  );
}

function stringifyError(error) {
  if (!error) return "null";
  if (typeof error === "string") return error;
  const plain = {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
    name: error.name,
    status: error.status,
    statusText: error.statusText
  };
  try {
    return JSON.stringify(plain);
  } catch {
    return String(error);
  }
}

async function handleContactSubmit(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  try {
    const form = new FormData(formElement);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const message = String(form.get("message") || "").trim();
    if (!name || !email || !message) {
      alert("Uzupe\u0142nij wszystkie pola formularza kontaktowego.");
      return;
    }

    console.log("Supabase client:", supabase);
    console.log("SUPABASE URL exists:", Boolean(import.meta.env.VITE_SUPABASE_URL));
    console.log("SUPABASE KEY exists:", Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY));

    if (!supabase) {
      console.error("Brakuje konfiguracji Supabase");
      alert("B\u0142\u0105d formularza:\nBrakuje konfiguracji Supabase");
      return;
    }

    const { data, error } = await supabase
      .from("contact_messages")
      .insert([
        {
          name,
          email,
          message,
          is_read: false
        }
      ])
      .select();

    if (error) {
      console.error("Pe\u0142ny b\u0142\u0105d Supabase:", error);
      console.error("error.message:", error?.message);
      console.error("error.details:", error?.details);
      console.error("error.hint:", error?.hint);
      console.error("error.code:", error?.code);

      alert(
        "B\u0142\u0105d Supabase:\n" +
        "message: " + (error?.message || "brak") + "\n" +
        "details: " + (error?.details || "brak") + "\n" +
        "hint: " + (error?.hint || "brak") + "\n" +
        "code: " + (error?.code || "brak")
      );
      return;
    }

    const savedRow = data?.[0] || {};
    const savedMessage = {
      id: savedRow.id || `pending-${Date.now()}`,
      name: savedRow.name || name,
      email: savedRow.email || email,
      message: savedRow.message || message,
      createdAt: savedRow.created_at || new Date().toISOString(),
      isRead: Boolean(savedRow.is_read)
    };
    state.contactMessages = state.contactMessages || [];
    state.contactMessages.unshift(savedMessage);
    if (formElement) formElement.reset();
    alert("Wiadomo\u015b\u0107 zosta\u0142a wys\u0142ana.");
  } catch (err) {
    console.error("B\u0142\u0105d catch formularza Kontakt:", err);

    alert(
      "B\u0142\u0105d formularza:\n" +
      (err?.message || String(err))
    );
  }
}

async function handleDailyAnswer(event) {
  event.preventDefault();
  if (dailyRun.feedback) {
    const taskData = dailyRun.currentTask;
    if (!dailyRun.feedback.correct) {
      dailyRun.hadMistake = true;
      dailyRun.usedInRun.push(taskData.id);
      dailyRun.currentTask = pickDailyTask(dailyRun.studentId, dailyRun.usedInRun) || taskData;
      dailyRun.feedback = null;
      render();
      return;
    }
    const points = dailyRun.hadMistake ? 3 : 5;
    awardAttemptPoints(taskData.id, points);
    state.progress[dailyRun.studentId].points += points;
    state.solvedTasks.push({ studentId: dailyRun.studentId, taskId: taskData.id, date: today() });
    dailyRun.correctCount += 1;
    dailyRun.hadMistake = false;
    dailyRun.usedInRun.push(taskData.id);
    dailyRun.feedback = null;
    if (dailyRun.correctCount >= 2) {
      completeDaily(dailyRun.studentId);
      logStudentActivity(dailyRun.studentId, "daily", `${getUserName(state.students.find((student) => student.id === dailyRun.studentId)?.userId)} rozwiązał zadanie dzienne`);
      saveState();
      dailyRun = null;
      alert("Gratulacje! Zadanie wykonane.");
      session.view = "student";
      render();
      return;
    }
    dailyRun.currentTask = pickDailyTask(dailyRun.studentId, dailyRun.usedInRun);
    saveState();
    render();
    return;
  }
  const form = new FormData(event.currentTarget);
  const taskData = dailyRun.currentTask;
  const answer = collectTaskAnswer(form, taskData);
  const correct = isCorrect(taskData, answer);
  addAttempt(dailyRun.studentId, taskData.id, "daily", answer, correct, 0);
  dailyRun.feedback = { answer, correct };
  render();
}

async function handleMiniSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  let correctCount = 0;
  const answers = [];
  for (const taskData of miniRun.tasks) {
    const answer = collectTaskAnswer(form, taskData);
    const correct = isCorrect(taskData, answer);
    if (correct) correctCount += 1;
    answers.push({ taskId: taskData.id, answer, correct });
  }
  const points = miniPoints(correctCount);
  state.progress[miniRun.studentId].points += points;
  answers.forEach((item) => addAttempt(miniRun.studentId, item.taskId, "mini", item.answer, item.correct, item.correct? 1 : 0));
  state.miniSheets.push({ id: uid("mini"), studentId: miniRun.studentId, date: today(), readyMiniSheetId: miniRun.readyMiniSheetId, correctCount, points, answers });
  setAccess(miniRun.studentId, { miniDone: true });
  recordStudentActivity(miniRun.studentId);
  logStudentActivity(miniRun.studentId, "mini", `${getUserName(state.students.find((student) => student.id === miniRun.studentId)?.userId)} ukończył miniarkusz`);
  saveState();
  alert(`Miniarkusz oddany: ${correctCount}/${miniRun.tasks.length}, ${points} pkt.`);
  miniRun = null;
  session.view = "student";
  render();
}

async function handleStudentFullSheetSubmit(event) {
  event.preventDefault();
  if (!fullSheetRun) return;
  const sheet = (state.fullSheets || []).find((item) => item.id === fullSheetRun.sheetId);
  if (!sheet) {
    fullSheetRun = null;
    render();
    return;
  }
  const studentId = fullSheetRun.studentId;
  const form = new FormData(event.currentTarget);
  let correctCount = 0;
  const answers = [];
  for (const task of sheet.tasks) {
    const answer = collectTaskAnswer(form, task);
    const correct = isCorrect(task, answer);
    if (correct) correctCount += 1;
    answers.push({ taskId: task.id, answer, correct });
    addAttempt(studentId, task.id, "sheet", answer, correct, correct ? 1 : 0);
  }
  const progress = normalizeProgress(state.progress[studentId]);
  state.progress[studentId] = progress;
  progress.sheetResults = progress.sheetResults || [];
  progress.sheetResults.unshift({
    id: uid("sheet-result"),
    sheetId: sheet.id,
    sheetName: sheet.name,
    date: today(),
    correctCount,
    total: sheet.tasks.length,
    answers
  });
  recordStudentActivity(studentId);
  logStudentActivity(studentId, "sheet", `${getUserName(state.students.find((student) => student.id === studentId)?.userId)} rozwiązał arkusz ${sheet.name}`);
  saveState();
  alert(`Arkusz zakończony: ${correctCount}/${sheet.tasks.length}.`);
  fullSheetRun = null;
  session.view = "results";
  render();
}

function handleStudentSettings(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const password = readPasswordField(formElement);
  const passwordRepeat = readPasswordField(formElement, "repeat");
  if (!password || !passwordRepeat) {
    alert("Wpisz i powtórz nowe hasło.");
    return;
  }
  if (password !== passwordRepeat) {
    alert("Hasła nie są takie same.");
    return;
  }
  const userData = currentUser();
  if (!userData || userData.role !== "student") return;
  userData.password = password;
  touchUserActivity(userData.id, "activity");
  session.studentNotice = "Hasło zostało zmienione.";
  saveState();
  render();
}

function handleAddClass(event) {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get("name");
  const classData = { id: uid("class"), name, teacherId: session.teacherId, studentIds: [] };
  state.classes.push(classData);
  if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("class-added");
  logActivity({ type: "class-added", classId: classData.id, className: classData.name, description: `Dodano klasę ${classData.name}` });
  session.teacherNotice = "Klasa została dodana.";
  session.teacherLastStudent = null;
  saveState();
  render();
}

function handleAddStudent(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = form.get("name");
  const classId = form.get("classId");
  const { login, password } = generateStudentCredentials(name);
  const userId = uid("u");
  const studentId = uid("student");
  state.users.push(user(userId, "student", login, password, name, { createdAt: new Date().toISOString(), lastLogin: null, lastActive: null, isActive: true, activityStatus: "active" }));
  state.students.push({ id: studentId, userId, classId, teacherId: session.teacherId, source: "teacher" });
  state.progress[studentId] = defaultProgress();
  state.classes.find((item) => item.id === classId)?.studentIds.push(studentId);
  const classData = state.classes.find((item) => item.id === classId);
  session.teacherNotice = "Uczeń został dodany. Wygenerowano login i hasło.";
  session.teacherLastStudent = { name, login, password, className: classData ? classData.name : "-" };
  if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("student-added");
  logActivity({ type: "student-added", userId, userName: name, studentId, classId, className: classData?.name || "", description: `Dodano ucznia ${name}` });
  saveState();
  render();
}

function generateStudentCredentials(name) {
  const base = String(name || "uczeń")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 9) || "uczen";
  let login = "";
  const digits = () => String(Math.floor(Math.random() * 8) + 2);
  do {
    login = `${base}${digits()}${digits()}${digits()}`;
  } while (state.users.some((userData) => normalizeAnswer(userData.login) === normalizeAnswer(login)));
  const passwordWords = ["mata", "licz", "suma", "plus", "pole", "figa", "kolo", "romb", "kres", "dane"];
  return {
    login,
    password: `${passwordWords[Math.floor(Math.random() * passwordWords.length)]}${digits()}${digits()}`
  };
}

function handleTeacherSettings(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(event.currentTarget);
  const userData = currentUser();
  const name = String(form.get("name") || "").trim();
  const login = String(form.get("login") || "").trim();
  const password = readPasswordField(formElement);
  const passwordRepeat = readPasswordField(formElement, "repeat");
  if (!name || !login) {
    alert("Uzupełnij imię i nazwisko oraz login.");
    return;
  }
  const loginTaken = state.users.some((item) => item.id !== userData.id && item.login === login);
  if (loginTaken) {
    alert("Ten login jest już zajęty.");
    return;
  }
  if (password || passwordRepeat) {
    if (password !== passwordRepeat) {
      alert("Nowe hasła nie są takie same.");
      return;
    }
    userData.password = password;
  }
  userData.name = name;
  userData.login = login;
  session.teacherNotice = "Ustawienia zostały zapisane.";
  saveState();
  render();
}

async function handleAddTask(event) {
  event.preventDefault();
  if (isSavingTask) return;
  isSavingTask = true;
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.dataset.originalText = submitButton.textContent || "";
    submitButton.textContent = "Zapisywanie...";
  }
  syncAllRichEditors();
  const form = new FormData(event.currentTarget);
  const editId = String(form.get("id") || "");
  const existingTask = editId ? state.tasks.find((task) => task.id === editId) : null;
  const previousTasks = JSON.parse(JSON.stringify(state.tasks || []));
  const previousActivityLog = JSON.parse(JSON.stringify(state.activityLog || []));
  const previousUsers = JSON.parse(JSON.stringify(state.users || []));
  const questionType = String(form.get("questionType") || "open");
  const isTrueFalse = questionType === "true_false" || questionType === "closed-true-false";
  const isAbCd = questionType === "ab_cd" || questionType === "closed-two-answers";
  const isDoubleChoice = questionType === "double_choice" || questionType === "closed-double-choice";
  const trueFalseParts = [
    {
      content: String(form.get("trueFalseText1") || "").trim(),
      correct: String(form.get("trueFalseCorrect1") || "").trim(),
      attachments: JSON.parse(JSON.stringify(taskDraftAttachments.trueFalseText1 || []))
    },
    {
      content: String(form.get("trueFalseText2") || "").trim(),
      correct: String(form.get("trueFalseCorrect2") || "").trim(),
      attachments: JSON.parse(JSON.stringify(taskDraftAttachments.trueFalseText2 || []))
    }
  ];
  const abCdParts = [
    {
      content: String(form.get("abCdText1") || "").trim(),
      options: ["A", "B"],
      correct: String(form.get("abCdCorrect1") || "").trim(),
      attachments: JSON.parse(JSON.stringify(taskDraftAttachments.abCdText1 || []))
    },
    {
      content: String(form.get("abCdText2") || "").trim(),
      options: ["C", "D"],
      correct: String(form.get("abCdCorrect2") || "").trim(),
      attachments: JSON.parse(JSON.stringify(taskDraftAttachments.abCdText2 || []))
    }
  ];
  const doubleChoiceSteps = {
    step1: {
      options: ["TAK", "NIE"],
      correct: String(form.get("doubleChoiceStep1") || "").trim()
    },
    step2: {
      options: ["1", "2", "3"],
      correct: String(form.get("doubleChoiceStep2") || "").trim()
    }
  };
  const content = isTrueFalse
    ? trueFalseParts.map((part) => part.content).filter(Boolean).join("\n\n")
    : isAbCd
    ? abCdParts.map((part) => part.content).filter(Boolean).join("\n\n")
    : String(form.get("content") || "").trim();
  const correctAnswer = isAbCd
    ? `${abCdParts[0].correct},${abCdParts[1].correct}`
    : isDoubleChoice
    ? `${doubleChoiceSteps.step1.correct},${doubleChoiceSteps.step2.correct}`
    : `${trueFalseParts[0].correct},${trueFalseParts[1].correct}`;
  const answers = isTrueFalse
    ? [correctAnswer].filter((item) => item !== ",")
    : isAbCd
    ? [correctAnswer].filter((item) => item !== ",")
    : isDoubleChoice
    ? [correctAnswer].filter((item) => item !== ",")
    : questionType === "closed-abcd"
    ? [String(form.get("correctAbcd") || "").trim().toUpperCase()].filter(Boolean)
    : splitAnswerVariants(form.get("answers"));
  const contentAttachments = JSON.parse(JSON.stringify(taskDraftAttachments.content || []));
  if (isTrueFalse && ((!trueFalseParts[0].content && !trueFalseParts[0].attachments.length) || (!trueFalseParts[1].content && !trueFalseParts[1].attachments.length))) {
    alert("Uzupełnij treść 1 i treść 2.");
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
    return;
  }
  if (isAbCd && ((!abCdParts[0].content && !abCdParts[0].attachments.length) || (!abCdParts[1].content && !abCdParts[1].attachments.length))) {
    alert("Uzupełnij treść 1 i treść 2.");
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
    return;
  }
  if (!isTrueFalse && !isAbCd && !content && !contentAttachments.length) {
    alert("Dodaj treść zadania jako tekst albo obrazek.");
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
    return;
  }
  if (isTrueFalse && (!trueFalseParts[0].correct || !trueFalseParts[1].correct)) {
    alert("Zaznacz Prawda albo Fałsz dla obu części zadania.");
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
    return;
  }
  if (isAbCd && (!abCdParts[0].correct || !abCdParts[1].correct)) {
    alert("Zaznacz A albo B oraz C albo D.");
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
    return;
  }
  if (isDoubleChoice && (!doubleChoiceSteps.step1.correct || !doubleChoiceSteps.step2.correct)) {
    alert("Zaznacz odpowiedź w kroku 1 i kroku 2.");
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
    return;
  }
  if (!answers.length) {
    alert(questionType === "closed-abcd" ? "Wybierz poprawną odpowiedź A, B, C albo D." : "Wpisz przynajmniej jedną poprawną odpowiedź.");
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
    return;
  }
  const taskId = existingTask?.id || uid("task");
  const nextAttachments = {
    content: contentAttachments,
    hint: JSON.parse(JSON.stringify(existingTask?.attachments?.hint || [])),
    answers: [],
    solution: JSON.parse(JSON.stringify(taskDraftAttachments.solution || []))
  };
  const savedTask = makeTask(
    form.get("topicId"),
    form.get("taskType"),
    (questionType.startsWith("closed-") || isTrueFalse || isAbCd || isDoubleChoice) ? "closed" : "open",
    content,
    existingTask?.hint || "",
    answers,
    taskId,
    form.get("solution"),
    nextAttachments
  );
  savedTask.questionType = questionType;
  if (isTrueFalse) {
    savedTask.questionType = "true_false";
    savedTask.contentParts = trueFalseParts;
    savedTask.correctAnswer = correctAnswer;
    console.log("Zapisywane zadanie P/F:", savedTask);
  }
  if (isAbCd) {
    savedTask.questionType = "ab_cd";
    savedTask.contentParts = abCdParts;
    savedTask.correctAnswer = correctAnswer;
    console.log("Zapisywane zadanie A/B C/D:", savedTask);
  }
  if (isDoubleChoice) {
    savedTask.questionType = "double_choice";
    savedTask.steps = doubleChoiceSteps;
    savedTask.correctAnswer = correctAnswer;
    console.log("Zapisywane zadanie double_choice:", savedTask);
  }
  savedTask.createdAt = existingTask?.createdAt || new Date().toISOString();
  savedTask.updatedAt = new Date().toISOString();
  try {
    const savedSupabaseRecord = await saveTaskRecord(savedTask, { replaceAnswers: Boolean(existingTask) });
    console.log("Zapisany rekord Supabase tasks:", savedSupabaseRecord);
    if (existingTask) {
      const index = state.tasks.findIndex((task) => task.id === existingTask.id);
      state.tasks[index] = savedTask;
    } else {
      state.tasks.unshift(savedTask);
      if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("task-added");
      logActivity({ type: "task-added", description: "Dodano nowe zadanie" });
    }
    taskDraftAttachments = emptyAttachments();
    state = await refreshAppState(seedState, normalizeState, emptyState);
    if (isTrueFalse) console.log("Zapisane zadanie P/F:", state.tasks.find((task) => task.id === savedTask.id));
    if (isAbCd) console.log("Zapisane zadanie A/B C/D:", state.tasks.find((task) => task.id === savedTask.id));
    if (isDoubleChoice) console.log("Zapisane zadanie double_choice:", state.tasks.find((task) => task.id === savedTask.id));
    session.teacherTab = "tasks";
    session.editTaskId = null;
    alert(existingTask ? "Zmiany zapisane." : "Zadanie zostało dodane.");
    render();
  } catch (error) {
    state.tasks = previousTasks;
    state.activityLog = previousActivityLog;
    state.users = previousUsers;
    console.error("Błąd zapisu zadania do Supabase:", error?.originalError || error);
    alert(
      "Błąd zapisu zadania:\n" +
      "message: " + (error?.message || "brak") + "\n" +
      "details: " + (error?.details || "brak") + "\n" +
      "hint: " + (error?.hint || "brak") + "\n" +
      "code: " + (error?.code || "brak")
    );
    render();
  } finally {
    isSavingTask = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || (existingTask ? "Zapisz zmiany" : "Dodaj zadanie");
    }
  }
}

function handleCreateReadyMiniSheet(event) {
  event.preventDefault();
  syncAllRichEditors();
  const form = new FormData(event.currentTarget);
  const editId = String(form.get("id") || "");
  const topicId = form.get("topicId");
  const sheetId = editId || uid("ready-mini");
  const taskIds = [];
  const newTasks = [];
  const taskSections = Array.from(event.currentTarget.querySelectorAll("[data-mini-sheet-task]"));

  for (const [position, section] of taskSections.entries()) {
    const index = Number(section.dataset.index || position);
    const contentKey = `mini-${index}-content`;
    const answersKey = `mini-${index}-answers`;
    const content = String(form.get(contentKey) || "").trim();
    const answers = String(form.get(answersKey) || "").split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
    if (!content && !(taskDraftAttachments[contentKey] || []).length) {
      alert(`Dodaj treść lub obrazek w zadaniu ${position + 1}.`);
      return;
    }
    if (!answers.length) {
      alert(`Dodaj przynajmniej jedną prawidłową odpowiedź w zadaniu ${position + 1}.`);
      return;
    }
    const taskId = uid("task");
    taskIds.push(taskId);
    newTasks.push(makeTask(
      topicId,
      "mini",
      form.get(`mini-${index}-answerKind`),
      content,
      "",
      answers,
      taskId,
      "",
      {
        content: JSON.parse(JSON.stringify(taskDraftAttachments[contentKey] || [])),
        answers: JSON.parse(JSON.stringify(taskDraftAttachments[answersKey] || [])),
        hint: [],
        solution: []
      }
    ));
  }

  if (!newTasks.length) {
    alert("Dodaj przynajmniej jedno zadanie do miniarkusza.");
    return;
  }

  if (editId) {
    const previous = (state.readyMiniSheets || []).find((sheet) => sheet.id === editId);
    const previousTaskIds = new Set(previous? previous.taskIds : []);
    state.readyMiniSheets = (state.readyMiniSheets || []).filter((sheet) => sheet.id !== editId);
    state.tasks = state.tasks.filter((task) => !previousTaskIds.has(task.id));
  }
  state.tasks.unshift(...newTasks);
  if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("mini-sheet-added");
  state.readyMiniSheets = state.readyMiniSheets || [];
  state.readyMiniSheets.unshift({
    id: sheetId,
    name: String(form.get("name") || "Miniarkusz").trim(),
    topicId,
    levelNumber: getTopic(topicId).levelNumber,
    teacherId: session.teacherId,
    taskIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  taskDraftAttachments = emptyAttachments();
  session.editReadyMiniId = null;
  saveState();
  session.teacherTab = "readyMini";
  render();
}

function handleAddFullSheet(event) {
  event.preventDefault();
  syncAllRichEditors();
  const form = new FormData(event.currentTarget);
  const id = String(form.get("id") || "");
  const existing = id ? (state.fullSheets || []).find((sheet) => sheet.id === id) : null;
  const tasks = [];
  const taskSections = Array.from(event.currentTarget.querySelectorAll("[data-full-sheet-task]"));

  for (const [position, section] of taskSections.entries()) {
    const index = Number(section.dataset.index || position);
    const contentKey = `sheet-${index}-content`;
    const answersKey = `sheet-${index}-answers`;
    const content = String(form.get(contentKey) || "").trim();
    const answers = String(form.get(answersKey) || "").split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
    const attachments = {
      content: JSON.parse(JSON.stringify(taskDraftAttachments[contentKey] || [])),
      answers: JSON.parse(JSON.stringify(taskDraftAttachments[answersKey] || []))
    };
    if (!content && !attachments.content.length && !answers.length) continue;
    if (!content && !attachments.content.length) {
      alert(`Dodaj treść lub obrazek w zadaniu ${position + 1}.`);
      return;
    }
    if (!answers.length) {
      alert(`Dodaj przynajmniej jedną poprawną odpowiedź w zadaniu ${position + 1}.`);
      return;
    }
    tasks.push({
      id: String(form.get(`sheet-${index}-id`) || "") || uid("sheet-task"),
      content,
      answers,
      answerKind: String(form.get(`sheet-${index}-answerKind`) || "closed"),
      points: 1,
      attachments
    });
  }

  if (!tasks.length) {
    alert("Dodaj przynajmniej jedno zadanie do arkusza.");
    return;
  }

  const payload = {
    id: existing ? existing.id : uid("full-sheet"),
    name: String(form.get("name") || "Arkusz").trim(),
    description: String(form.get("description") || "").trim(),
    instructions: String(form.get("instructions") || "").trim(),
    teacherId: existing?.teacherId || session.teacherId,
    tasks,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  state.fullSheets = state.fullSheets || [];
  if (existing) {
    delete existing.levelNumber;
    delete existing.topicId;
    Object.assign(existing, payload);
    session.teacherNotice = "Zmiany zapisane";
    session.editFullSheetId = existing.id;
    saveState();
    render();
    return;
  }

  state.fullSheets.unshift(payload);
  if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("sheet-added");
  logActivity({ type: "sheet-added", description: `Dodano arkusz: ${payload.name}` });
  taskDraftAttachments = emptyAttachments();
  saveState();
  session.teacherTab = "fullSheets";
  session.editFullSheetId = null;
  session.previewFullSheetId = null;
  render();
}

function handleSaveRepetytorium(event) {
  event.preventDefault();
  syncAllRichEditors();
  const form = new FormData(event.currentTarget);
  const id = String(form.get("id") || "");
  const title = String(form.get("title") || "").trim();
  const topicId = form.get("topicId");
  const topicData = getTopic(topicId);
  const contentText = String(form.get("content") || "").trim();
  const summary = String(form.get("summary") || "").trim();
  const attachments = {
    content: JSON.parse(JSON.stringify(taskDraftAttachments.content || []))
  };
  if (!title) {
    alert("Wpisz tytuł treści repetytorium.");
    return;
  }
  if (!contentText && !attachments.content.length) {
    alert("Dodaj treść jako tekst albo wklej obrazek w polu Treść.");
    return;
  }
  const now = new Date().toISOString();
  state.repetytoriumContent = state.repetytoriumContent || [];
  const existing = id ? state.repetytoriumContent.find((item) => item.id === id) : null;
  const payload = {
    id: existing ? existing.id : uid("rep"),
    title,
    summary,
    levelNumber: topicData.levelNumber,
    levelId: topicData.levelNumber,
    topicId,
    contentText,
    attachments,
    teacherId: session.teacherId,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  if (existing) Object.assign(existing, payload);
  else {
    state.repetytoriumContent.unshift(payload);
    if (session.role === "teacher" || session.role === "admin") touchCurrentUserActivity("repetytorium");
    logActivity({ type: "repetytorium", description: `Dodano treść do repetytorium: ${title}` });
  }
  taskDraftAttachments = emptyAttachments();
  session.editRepetytoriumId = null;
  session.teacherTab = "repetytorium";
  saveState();
  render();
}

function addAttempt(studentId, taskId, context, answer, correct, points, extra = {}) {
  state.attempts.push({
    id: uid("attempt"),
    studentId,
    taskId,
    context,
    answer: answerToString(answer),
    correct,
    points,
    date: today(),
    ...extra
  });
}

function awardAttemptPoints(taskId, points) {
  const last = [...state.attempts].reverse().find((item) => item.taskId === taskId && item.context === "daily");
  if (last) last.points = points;
}

function completeDaily(studentId) {
  setAccess(studentId, { dailyDone: true });
  recordStudentActivity(studentId);
  const progress = state.progress[studentId];
  const topicData = getTopic(progress.topicId);
  progress.totalWorkDays += 1;
  if (progress.dayInTopic >= topicData.days) {
    const currentIndex = flatTopics.findIndex((item) => item.id === progress.topicId);
    const nextTopic = flatTopics[currentIndex + 1];
    if (nextTopic) {
      progress.topicId = nextTopic.id;
      progress.dayInTopic = 1;
    }
  } else {
    progress.dayInTopic += 1;
  }
}

function recordStudentActivity(studentId) {
  const progress = normalizeProgress(state.progress[studentId]);
  state.progress[studentId] = progress;
  const student = state.students.find((item) => item.id === studentId);
  const userData = student? state.users.find((item) => item.id === student.userId) : null;
  if (userData) touchUserActivity(userData.id, "activity");
  if (!progress.activityDates.includes(today())) {
    progress.activityDates.push(today());
    progress.activityDates = [...new Set(progress.activityDates)].sort();
  }
  const streakDays = currentStreakDays(progress);
  const earnedBonuses = Math.floor(streakDays / 5);
  if (earnedBonuses > progress.streakBonusesAwarded) {
    const bonus = earnedBonuses - progress.streakBonusesAwarded;
    progress.points += bonus;
    progress.streakBonusesAwarded = earnedBonuses;
  }
}

function currentStreakDays(progress) {
  const dates = [...new Set(progress.activityDates || [])].sort();
  if (!dates.length) return 0;
  const todayDate = dateFromKey(today());
  const lastDate = dateFromKey(dates[dates.length - 1]);
  const daysSinceLast = dayDiff(lastDate, todayDate);
  if (daysSinceLast > 1) return 0;

  let streak = 1;
  for (let index = dates.length - 2; index >= 0; index -= 1) {
    const previous = dateFromKey(dates[index]);
    const current = dateFromKey(dates[index + 1]);
    if (dayDiff(previous, current) !== 1) break;
    streak += 1;
  }
  return streak;
}

function dateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function dayDiff(fromDate, toDate) {
  return Math.round((toDate - fromDate) / 86400000);
}

function streakLabel(days) {
  return days === 1 ? "dzień" : "dni";
}

function isCorrect(taskData, answer) {
  if (isTrueFalseTask(taskData) || isAbCdTask(taskData) || isDoubleChoiceTask(taskData)) {
    const expected = taskData.correctAnswer
      || (isDoubleChoiceTask(taskData)
        ? `${taskData.steps?.step1?.correct || ""},${taskData.steps?.step2?.correct || ""}`
        : (taskData.contentParts || []).slice(0, 2).map((part) => String(part.correct || "").trim().toUpperCase()).join(","));
    return String(answer || "").trim().toUpperCase() === expected;
  }
  const normalized = normalizeAnswer(answer);
  return (taskData.answers || []).map(normalizeAnswer).includes(normalized);
}

function miniPoints(correctCount) {
  return [0, 5, 8, 11, 14, 17, 20][Math.min(correctCount, 6)] || 0;
}

function getAccess(studentId) {
  let access = state.dailyAccess.find((item) => item.studentId === studentId && item.date === today());
  if (!access) {
    access = { studentId, date: today(), dailyDone: false, miniDone: false };
    state.dailyAccess.push(access);
  }
  return access;
}

function setAccess(studentId, patch) {
  const access = getAccess(studentId);
  Object.assign(access, patch);
}

function randomItem(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

render();



