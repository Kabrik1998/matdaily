import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from "./supabaseClient.js";

const LOCAL_STORAGE_KEY = "matdaily-state-v1";

export const databaseMode = isSupabaseConfigured ? "supabase" : "supabase-missing";

export async function loadAppState(seedFactory, normalizeState, emptyStateFactory = seedFactory) {
  if (!isSupabaseConfigured) {
    console.warn("Brak konfiguracji Supabase. Dane produkcyjne nie beda zapisywane lokalnie.");
    return normalizeState(emptyStateFactory());
  }

  try {
    const loaded = await loadFromSupabase();
    if (!isSupabaseStateEmpty(loaded)) return normalizeState(loaded);

    localStorage.removeItem(LOCAL_STORAGE_KEY);
    return normalizeState(emptyStateFactory());
  } catch (error) {
    console.error("[MatDaily Supabase] Nie udalo sie zaladowac danych. Aplikacja uruchomi pusty stan bez nadpisywania uzytkownikow.", formatErrorMessage(error));
    return normalizeState(emptyStateFactory());
  }
}

export async function saveAppState(state, role) {
  if (role === "guest") {
    sessionStorage.setItem("matdaily-demo-state", JSON.stringify(state));
    return;
  }

  if (!isSupabaseConfigured) {
    throw new Error("Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY. Zapis produkcyjny wymaga Supabase.");
  }

  await saveToSupabase(state);
}

export async function refreshAppState(seedFactory, normalizeState, emptyStateFactory = seedFactory) {
  return loadAppState(seedFactory, normalizeState, emptyStateFactory);
}

export async function saveUserRecord(userData) {
  if (!isSupabaseConfigured) {
    throw new Error("Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY. Zapis użytkownika wymaga Supabase.");
  }
  const { error } = await supabase.from("users").upsert(toUser(userData), { onConflict: "id" });
  if (error) throw logSupabaseError("users", "upsert user", error);
}

export async function saveTaskRecord(task, options = {}) {
  if (!isSupabaseConfigured) {
    throw new Error("Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY. Zapis zadania wymaga Supabase.");
  }

  const taskRow = {
    id: task.id,
    level_number: task.levelNumber,
    topic_id: task.topicId,
    content: task.content || "",
    hint: task.hint || "",
    solution: task.solution || "",
    attachments: task.attachments || {},
    task_type: task.taskType,
    answer_kind: task.answerKind,
    created_by: task.createdBy,
    created_at: task.createdAt || null,
    data: task
  };

  const { data: upsertedTask, error: taskError } = await supabase
    .from("tasks")
    .upsert(taskRow, { onConflict: "id" })
    .select("*")
    .single();
  if (taskError) throw logSupabaseError("tasks", "upsert task", taskError);
  if (!upsertedTask) throw logSupabaseError("tasks", "upsert task", { message: "Supabase nie zwrócił zapisanego rekordu zadania." });

  if (options.replaceAnswers) {
    const { error: deleteAnswersError } = await supabase
      .from("answers")
      .delete()
      .eq("task_id", task.id);
    if (deleteAnswersError) throw logSupabaseError("answers", "delete task answers", deleteAnswersError);
  }

  const answerRows = (task.answers || []).map((answer, index) => ({
    id: `${task.id}-${index}`,
    task_id: task.id,
    answer_text: String(answer ?? ""),
    position: index,
    data: { normalizedAnswer: normalizeAnswer(answer) }
  }));

  if (answerRows.length) {
    const { error: answersError } = await supabase
      .from("answers")
      .upsert(answerRows, { onConflict: "id" });
    if (answersError) throw logSupabaseError("answers", "insert task answers", answersError);
  }

  const { data: savedTask, error: readSavedTaskError } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", task.id)
    .single();
  if (readSavedTaskError) throw logSupabaseError("tasks", "select saved task", readSavedTaskError);
  return savedTask;
}

export async function createContactMessage({ name, email, message }) {
  if (!isSupabaseConfigured) {
    console.error("Brakuje konfiguracji Supabase");
    throw new Error("Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY. Zapis wiadomo\u015bci wymaga Supabase.");
  }
  console.info("[MatDaily Supabase] Kontakt: konfiguracja klienta", {
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey)
  });
  const row = {
    name,
    email,
    message,
    created_at: new Date().toISOString(),
    is_read: false
  };
  const { error } = await supabase.from("contact_messages").insert(row);
  if (error) {
    console.error("B\u0142\u0105d Supabase przy wysy\u0142aniu kontaktu:", error);
    throw error;
  }
  return fromContactMessage({ ...row, id: `pending-${Date.now()}` });
}

export async function markContactMessageRead(id) {
  if (!isSupabaseConfigured) {
    throw new Error("Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY. Zapis wiadomości wymaga Supabase.");
  }
  const { error } = await supabase
    .from("contact_messages")
    .update({ is_read: true })
    .eq("id", id);
  if (error) throw logSupabaseError("contact_messages", "update is_read", error);
  return { id, isRead: true };
}

export async function removeContactMessage(id) {
  if (!isSupabaseConfigured) {
    throw new Error("Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY. Usuwanie wiadomości wymaga Supabase.");
  }
  const { error } = await supabase.from("contact_messages").delete().eq("id", id);
  if (error) throw logSupabaseError("contact_messages", "delete", error);
}

async function loadFromSupabase() {
  const [
    users,
    teachers,
    students,
    classes,
    tasks,
    answers,
    attempts,
    progress,
    miniSheets,
    fullSheets,
    repetytoriumContent,
    activityLog,
    dailyAccess,
    solvedTasks,
    readyMiniSheets,
    contactMessages
  ] = await Promise.all([
    readTable("users"),
    readTable("teachers"),
    readTable("students"),
    readTable("classes"),
    readTable("tasks"),
    readTable("answers"),
    readTable("attempts"),
    readTable("progress"),
    readTable("mini_sheets"),
    readTable("full_sheets"),
    readTable("repetytorium_content"),
    readTable("activity_log"),
    readTable("daily_access"),
    readTable("solved_tasks"),
    readTable("ready_mini_sheets"),
    readOptionalTable("contact_messages")
  ]);

  const answersByTask = answers.reduce((acc, row) => {
    acc[row.task_id] = acc[row.task_id] || [];
    acc[row.task_id].push(row.answer_text);
    return acc;
  }, {});

  return {
    users: users.map(fromUser),
    teachers: teachers.map((row) => ({ id: row.id, userId: row.user_id, ...(row.data || {}) })),
    students: students.map((row) => ({ id: row.id, userId: row.user_id, classId: row.class_id, teacherId: row.teacher_id, ...(row.data || {}) })),
    classes: classes.map((row) => ({ id: row.id, name: row.name, teacherId: row.teacher_id, studentIds: row.student_ids || [], ...(row.data || {}) })),
    tasks: tasks.map((row) => ({ ...row.data, id: row.id, topicId: row.topic_id, levelNumber: row.level_number, content: row.content || "", hint: row.hint || "", solution: row.solution || "", taskType: row.task_type, answerKind: row.answer_kind, createdBy: row.created_by, attachments: row.attachments || row.data?.attachments || {}, answers: answersByTask[row.id] || row.data?.answers || [] })),
    progress: progress.reduce((acc, row) => {
      acc[row.student_id] = { ...(row.data || {}), topicId: row.topic_id, dayInTopic: row.day_in_topic, totalWorkDays: row.total_work_days, points: row.points };
      return acc;
    }, {}),
    attempts: attempts.map((row) => ({ id: row.id, studentId: row.student_id, taskId: row.task_id, context: row.context, answer: row.answer_text, correct: row.is_correct, points: row.points_awarded, date: row.work_date, ...(row.data || {}) })),
    solvedTasks: solvedTasks.map((row) => ({ id: row.id, studentId: row.student_id, taskId: row.task_id, date: row.solved_at?.slice(0, 10) || row.work_date || "", ...(row.data || {}) })),
    dailyAccess: dailyAccess.map((row) => ({ id: row.id, studentId: row.student_id, date: row.work_date, dailyDone: row.daily_done, miniDone: row.mini_done, ...(row.data || {}) })),
    miniSheets: miniSheets.map((row) => ({ id: row.id, studentId: row.student_id, date: row.work_date, readyMiniSheetId: row.ready_mini_sheet_id, correctCount: row.score_correct, points: row.points_awarded, answers: row.answers || row.data?.answers || [], ...(row.data || {}) })),
    readyMiniSheets: readyMiniSheets.map((row) => ({ id: row.id, name: row.name, topicId: row.topic_id, levelNumber: row.level_number, teacherId: row.teacher_id, taskIds: row.task_ids || [], createdAt: row.created_at, updatedAt: row.updated_at, ...(row.data || {}) })),
    fullSheets: fullSheets.map((row) => ({ id: row.id, name: row.name, description: row.description || "", instructions: row.instructions || "", teacherId: row.teacher_id, tasks: row.tasks || [], createdAt: row.created_at, updatedAt: row.updated_at, ...(row.data || {}) })),
    repetytoriumContent: repetytoriumContent.map((row) => ({ id: row.id, title: row.title, summary: row.summary || "", levelNumber: row.level_number, levelId: row.level_id, topicId: row.topic_id, contentText: row.content_text || "", attachments: row.attachments || {}, teacherId: row.teacher_id, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.data || {}) })),
    activityLog: activityLog.map((row) => ({ id: row.id, userId: row.user_id, userName: row.user_name, studentId: row.student_id || "", classId: row.class_id || "", className: row.class_name || "", type: row.type, description: row.description, details: row.details || "", createdAt: row.created_at, ...(row.data || {}) })),
    contactMessages: contactMessages.map(fromContactMessage)
  };
}

function isSupabaseStateEmpty(loaded) {
  return Object.values(loaded).every((value) => {
    if (Array.isArray(value)) return value.length === 0;
    if (value && typeof value === "object") return Object.keys(value).length === 0;
    return !value;
  });
}

async function saveToSupabase(state) {
  const taskAnswers = state.tasks.flatMap((task) => (task.answers || []).map((answer, index) => ({
    id: `${task.id}-${index}`,
    task_id: task.id,
    answer_text: String(answer ?? ""),
    position: index,
    data: { normalizedAnswer: normalizeAnswer(answer) }
  })));

  await syncTable("users", state.users.map(toUser));
  await syncTable("teachers", state.teachers.map((item) => ({ id: item.id, user_id: item.userId, data: item })));
  await syncTable("students", state.students.map((item) => ({ id: item.id, user_id: item.userId, class_id: item.classId, teacher_id: item.teacherId, data: item })));
  await syncTable("classes", state.classes.map((item) => ({ id: item.id, teacher_id: item.teacherId, name: item.name, student_ids: item.studentIds || [], data: item })));
  await syncTable("tasks", state.tasks.map((task) => ({ id: task.id, level_number: task.levelNumber, topic_id: task.topicId, content: task.content || "", hint: task.hint || "", solution: task.solution || "", attachments: task.attachments || {}, task_type: task.taskType, answer_kind: task.answerKind, created_by: task.createdBy, created_at: task.createdAt || null, data: task })));
  await syncTable("answers", taskAnswers);
  await syncTable("progress", Object.entries(state.progress || {}).map(([studentId, item]) => ({ student_id: studentId, topic_id: item.topicId, day_in_topic: item.dayInTopic, total_work_days: item.totalWorkDays, points: item.points, data: item })), { idColumn: "student_id" });
  await syncTable("attempts", state.attempts.map((item) => ({ id: item.id, student_id: item.studentId, task_id: item.taskId, work_date: item.date, answer_text: item.answer || "", is_correct: item.correct, points_awarded: item.points || 0, context: item.context, data: item })));
  await syncTable("solved_tasks", state.solvedTasks.map((item, index) => ({ id: item.id || `${item.studentId}-${item.taskId}-${index}`, student_id: item.studentId, task_id: item.taskId, solved_at: item.date ? `${item.date}T12:00:00.000Z` : null, data: item })));
  await syncTable("daily_access", state.dailyAccess.map((item) => ({ id: item.id || `${item.studentId}-${item.date}`, student_id: item.studentId, work_date: item.date, daily_done: item.dailyDone, mini_done: item.miniDone, data: item })), { conflictTarget: "student_id,work_date", staleKey: (row) => `${row.student_id}-${row.work_date}` });
  await syncTable("mini_sheets", state.miniSheets.map((item) => ({ id: item.id, student_id: item.studentId, work_date: item.date, ready_mini_sheet_id: item.readyMiniSheetId || null, score_correct: item.correctCount, points_awarded: item.points, answers: item.answers || [], data: item })));
  await syncTable("ready_mini_sheets", (state.readyMiniSheets || []).map((item) => ({ id: item.id, name: item.name, topic_id: item.topicId, level_number: item.levelNumber, teacher_id: item.teacherId, task_ids: item.taskIds || [], created_at: item.createdAt || null, updated_at: item.updatedAt || null, data: item })));
  await syncTable("full_sheets", (state.fullSheets || []).map((item) => ({ id: item.id, name: item.name, description: item.description || "", instructions: item.instructions || "", teacher_id: item.teacherId, tasks: item.tasks || [], created_at: item.createdAt || null, updated_at: item.updatedAt || null, data: item })));
  await syncTable("repetytorium_content", (state.repetytoriumContent || []).map((item) => ({ id: item.id, title: item.title, summary: item.summary || "", level_number: item.levelNumber, level_id: item.levelId || item.levelNumber, topic_id: item.topicId, content_text: item.contentText || "", attachments: item.attachments || {}, teacher_id: item.teacherId, created_at: item.createdAt || null, updated_at: item.updatedAt || null, data: item })));
  await syncTable("activity_log", (state.activityLog || []).map((item) => ({ id: item.id, user_id: item.userId, user_name: item.userName, student_id: item.studentId || null, class_id: item.classId || null, class_name: item.className || "", type: item.type, description: item.description, details: item.details || "", created_at: item.createdAt || null, data: item })));
}

async function readTable(table) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw logSupabaseError(table, "select", error);
  return data || [];
}

async function readOptionalTable(table) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) {
    console.error(`[MatDaily Supabase] optional select failed for table "${table}": ${formatErrorMessage(error)}`, {
      table,
      operation: "optional-select",
      message: formatErrorMessage(error),
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      error
    });
    return [];
  }
  return data || [];
}

async function syncTable(table, rows, options = {}) {
  const idColumn = typeof options === "string" ? options : options.idColumn || "id";
  const conflictTarget = typeof options === "string" ? options : options.conflictTarget || idColumn;
  const staleKey = typeof options === "object" && options.staleKey ? options.staleKey : (row) => row[idColumn];
  const selectColumns = conflictTarget === idColumn ? idColumn : `${idColumn},${conflictTarget}`;
  const preparedRows = dedupeRows(rows.filter(Boolean), staleKey);
  const { data: existing, error: readError } = await supabase.from(table).select(selectColumns);
  if (readError) throw logSupabaseError(table, "select-before-sync", readError);

  const nextKeys = new Set(preparedRows.map(staleKey).filter(Boolean));
  const staleIds = (existing || []).filter((row) => !nextKeys.has(staleKey(row))).map((row) => row[idColumn]).filter(Boolean);
  if (staleIds.length) {
    const { error } = await supabase.from(table).delete().in(idColumn, staleIds);
    if (error) throw logSupabaseError(table, "delete-stale", error);
  }

  if (!preparedRows.length) return;
  const { error } = await supabase.from(table).upsert(preparedRows, { onConflict: conflictTarget });
  if (error) throw logSupabaseError(table, `upsert onConflict=${conflictTarget}`, error);
}

function dedupeRows(rows, keyGetter) {
  const byKey = new Map();
  rows.forEach((row) => {
    const key = keyGetter(row);
    if (key) byKey.set(key, row);
  });
  return [...byKey.values()];
}

const TASK_IMAGE_BUCKET = "task-images";

async function prepareTaskForSupabaseStorage(task) {
  const preparedTask = JSON.parse(JSON.stringify(task));
  return replaceInlineTaskImages(preparedTask, preparedTask.id || `task-${Date.now()}`);
}

async function replaceInlineTaskImages(value, taskId, context = "task") {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item, index) => replaceInlineTaskImages(item, taskId, `${context}-${index}`)));
  }

  if (!value || typeof value !== "object") return value;

  if (typeof value.dataUrl === "string" && value.dataUrl.startsWith("data:image/")) {
    return uploadInlineTaskImage(value, taskId, context);
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await replaceInlineTaskImages(item, taskId, `${context}-${key}`)])
  );
  return Object.fromEntries(entries);
}

async function uploadInlineTaskImage(image, taskId, context) {
  const { blob, extension, mimeType } = await dataUrlToBlob(image.dataUrl);
  const safeName = String(image.name || "obrazek")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "obrazek";
  const fileName = safeName.includes(".") ? safeName : `${safeName}.${extension}`;
  const path = `tasks/${taskId}/${Date.now()}-${context}-${fileName}`;
  const { error } = await supabase.storage
    .from(TASK_IMAGE_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: true });
  if (error) throw logSupabaseError(`storage:${TASK_IMAGE_BUCKET}`, "upload task image", error);

  const { data } = supabase.storage.from(TASK_IMAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw logSupabaseError(`storage:${TASK_IMAGE_BUCKET}`, "get public task image url", {
      message: "Nie udało się pobrać publicznego URL obrazka z Supabase Storage."
    });
  }

  return {
    ...image,
    dataUrl: data.publicUrl,
    publicUrl: data.publicUrl,
    storageBucket: TASK_IMAGE_BUCKET,
    storagePath: path,
    size: image.size || blob.size
  };
}

async function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  const mimeType = match?.[1] || "image/png";
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return { blob, extension, mimeType };
}

function logSupabaseError(table, operation, error) {
  const message = formatErrorMessage(error);
  console.error(`[MatDaily Supabase] ${operation} failed for table "${table}": ${message}`, {
    table,
    operation,
    message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    error
  });
  const wrapped = new Error(`[${table}] ${message}`);
  wrapped.table = table;
  wrapped.operation = operation;
  wrapped.message = error?.message || message;
  wrapped.details = error?.details || "";
  wrapped.hint = error?.hint || "";
  wrapped.code = error?.code || "";
  wrapped.originalError = error;
  return wrapped;
}

function formatErrorMessage(error) {
  if (!error) return "Nieznany blad Supabase.";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return error.message || error.details || JSON.stringify(error);
}

function toUser(item) {
  return {
    id: item.id,
    role: item.role,
    login: item.login,
    password: item.password,
    name: item.name,
    data: item
  };
}

function fromUser(row) {
  const data = row.data || {};
  return {
    ...data,
    id: row.id,
    role: row.role || data.role || "",
    login: row.login || data.login || "",
    password: row.password || data.password || "",
    name: row.name || data.name || "",
    email: row.email || data.email || ""
  };
}

function fromContactMessage(row) {
  return {
    id: row.id,
    name: row.name || "",
    email: row.email || "",
    message: row.message || "",
    createdAt: row.created_at || null,
    isRead: Boolean(row.is_read)
  };
}

function normalizeAnswer(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}
