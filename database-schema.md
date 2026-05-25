# MatDaily - projekt bazy danych

Poniższy schemat opisuje docelową bazę relacyjną dla wersji produkcyjnej. Prototyp w tym katalogu używa tych samych pojęć, ale zapisuje dane w `localStorage`, żeby można było uruchomić aplikację bez backendu.

## Tabele

### users
- `id` UUID, PK
- `role` ENUM: `student`, `teacher`
- `login` TEXT, UNIQUE
- `password_hash` TEXT
- `display_name` TEXT
- `created_at` TIMESTAMP

### teachers
- `id` UUID, PK
- `user_id` UUID, FK -> `users.id`

### students
- `id` UUID, PK
- `user_id` UUID, FK -> `users.id`
- `class_id` UUID, FK -> `classes.id`
- `teacher_id` UUID, FK -> `teachers.id`

### classes
- `id` UUID, PK
- `teacher_id` UUID, FK -> `teachers.id`
- `name` TEXT
- `created_at` TIMESTAMP

### curriculum_topics
- `id` TEXT, PK
- `level_number` INTEGER
- `level_name` TEXT
- `topic_number` TEXT
- `topic_name` TEXT
- `days_required` INTEGER
- `order_index` INTEGER

### tasks
- `id` UUID, PK
- `level_number` INTEGER
- `topic_id` TEXT, FK -> `curriculum_topics.id`
- `content` TEXT
- `hint` TEXT
- `solution` TEXT
- `attachments` JSONB
- `task_type` ENUM: `daily`, `mini`
- `answer_kind` ENUM: `closed`, `open`
- `created_by` UUID, FK -> `teachers.id`
- `created_at` TIMESTAMP
- `deleted_at` TIMESTAMP, NULL

### correct_answers
- `id` UUID, PK
- `task_id` UUID, FK -> `tasks.id`
- `answer_text` TEXT
- `normalized_answer` TEXT

### student_progress
- `student_id` UUID, PK/FK -> `students.id`
- `topic_id` TEXT, FK -> `curriculum_topics.id`
- `day_in_topic` INTEGER
- `total_work_days` INTEGER
- `points` INTEGER
- `updated_at` TIMESTAMP

### daily_access
- `id` UUID, PK
- `student_id` UUID, FK -> `students.id`
- `work_date` DATE
- `daily_done` BOOLEAN
- `mini_done` BOOLEAN
- UNIQUE(`student_id`, `work_date`)

### solved_tasks
- `id` UUID, PK
- `student_id` UUID, FK -> `students.id`
- `task_id` UUID, FK -> `tasks.id`
- `solved_at` TIMESTAMP
- UNIQUE(`student_id`, `task_id`)

### attempts
- `id` UUID, PK
- `student_id` UUID, FK -> `students.id`
- `task_id` UUID, FK -> `tasks.id`
- `work_date` DATE
- `answer_text` TEXT
- `is_correct` BOOLEAN
- `points_awarded` INTEGER
- `attempt_number` INTEGER
- `context` ENUM: `daily`, `mini`
- `created_at` TIMESTAMP

### mini_sheets
- `id` UUID, PK
- `student_id` UUID, FK -> `students.id`
- `work_date` DATE
- `topic_id` TEXT, FK -> `curriculum_topics.id`
- `score_correct` INTEGER
- `points_awarded` INTEGER
- `created_at` TIMESTAMP
- UNIQUE(`student_id`, `work_date`)

### mini_sheet_tasks
- `id` UUID, PK
- `mini_sheet_id` UUID, FK -> `mini_sheets.id`
- `task_id` UUID, FK -> `tasks.id`
- `position` INTEGER
- `answer_text` TEXT
- `is_correct` BOOLEAN

## Reguły dostępu

- Panel nauczyciela wymaga użytkownika z rolą `teacher`.
- Uczeń może pobierać wyłącznie zadania z bieżącego `topic_id` w `student_progress`.
- Dwa zadania dzienne są blokowane przez `daily_access.daily_done`.
- Miniarkusz jest blokowany przez `daily_access.mini_done` oraz unikalność `mini_sheets(student_id, work_date)`.
- Zadania z `solved_tasks` nie są losowane ponownie dla danego ucznia.
