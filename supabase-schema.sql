create table if not exists users (
  id text primary key,
  role text not null check (role in ('student', 'teacher', 'admin')),
  login text not null unique,
  password text not null,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists teachers (
  id text primary key,
  user_id text references users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists classes (
  id text primary key,
  teacher_id text references teachers(id) on delete cascade,
  name text not null,
  student_ids jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists students (
  id text primary key,
  user_id text references users(id) on delete cascade,
  class_id text references classes(id) on delete set null,
  teacher_id text references teachers(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  level_number integer,
  topic_id text,
  content text,
  hint text,
  solution text,
  attachments jsonb not null default '{}'::jsonb,
  task_type text check (task_type in ('daily', 'mini')),
  answer_kind text check (answer_kind in ('closed', 'open')),
  created_by text references teachers(id) on delete set null,
  created_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

create table if not exists answers (
  id text primary key,
  task_id text references tasks(id) on delete cascade,
  answer_text text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb
);

create table if not exists progress (
  student_id text primary key references students(id) on delete cascade,
  topic_id text,
  day_in_topic integer not null default 1,
  total_work_days integer not null default 0,
  points integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists attempts (
  id text primary key,
  student_id text references students(id) on delete cascade,
  task_id text references tasks(id) on delete cascade,
  work_date date,
  answer_text text,
  is_correct boolean not null default false,
  points_awarded integer not null default 0,
  context text check (context in ('daily', 'mini', 'sheet')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists solved_tasks (
  id text primary key,
  student_id text references students(id) on delete cascade,
  task_id text references tasks(id) on delete cascade,
  solved_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

create table if not exists daily_access (
  id text primary key,
  student_id text references students(id) on delete cascade,
  work_date date not null,
  daily_done boolean not null default false,
  mini_done boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  unique(student_id, work_date)
);

create table if not exists mini_sheets (
  id text primary key,
  student_id text references students(id) on delete cascade,
  work_date date,
  ready_mini_sheet_id text,
  score_correct integer not null default 0,
  points_awarded integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ready_mini_sheets (
  id text primary key,
  name text not null,
  topic_id text,
  level_number integer,
  teacher_id text references teachers(id) on delete set null,
  task_ids jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists full_sheets (
  id text primary key,
  name text not null,
  description text,
  instructions text,
  teacher_id text references teachers(id) on delete set null,
  tasks jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists repetytorium_content (
  id text primary key,
  title text not null,
  summary text,
  level_number integer,
  level_id integer,
  topic_id text,
  content_text text,
  attachments jsonb not null default '{}'::jsonb,
  teacher_id text references teachers(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists activity_log (
  id text primary key,
  user_id text,
  user_name text,
  student_id text,
  class_id text,
  class_name text,
  type text,
  description text,
  details text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz
);

alter table users enable row level security;
alter table teachers enable row level security;
alter table classes enable row level security;
alter table students enable row level security;
alter table tasks enable row level security;
alter table answers enable row level security;
alter table progress enable row level security;
alter table attempts enable row level security;
alter table solved_tasks enable row level security;
alter table daily_access enable row level security;
alter table mini_sheets enable row level security;
alter table ready_mini_sheets enable row level security;
alter table full_sheets enable row level security;
alter table repetytorium_content enable row level security;
alter table activity_log enable row level security;

create policy "matdaily anon prototype access users" on users for all using (true) with check (true);
create policy "matdaily anon prototype access teachers" on teachers for all using (true) with check (true);
create policy "matdaily anon prototype access classes" on classes for all using (true) with check (true);
create policy "matdaily anon prototype access students" on students for all using (true) with check (true);
create policy "matdaily anon prototype access tasks" on tasks for all using (true) with check (true);
create policy "matdaily anon prototype access answers" on answers for all using (true) with check (true);
create policy "matdaily anon prototype access progress" on progress for all using (true) with check (true);
create policy "matdaily anon prototype access attempts" on attempts for all using (true) with check (true);
create policy "matdaily anon prototype access solved_tasks" on solved_tasks for all using (true) with check (true);
create policy "matdaily anon prototype access daily_access" on daily_access for all using (true) with check (true);
create policy "matdaily anon prototype access mini_sheets" on mini_sheets for all using (true) with check (true);
create policy "matdaily anon prototype access ready_mini_sheets" on ready_mini_sheets for all using (true) with check (true);
create policy "matdaily anon prototype access full_sheets" on full_sheets for all using (true) with check (true);
create policy "matdaily anon prototype access repetytorium_content" on repetytorium_content for all using (true) with check (true);
create policy "matdaily anon prototype access activity_log" on activity_log for all using (true) with check (true);
