-- An optional time of day for a task's due date ("15:00"), for meetings and the like.
ALTER TABLE tasks ADD COLUMN due_time TEXT;
