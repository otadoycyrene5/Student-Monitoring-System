ALTER TABLE enrollments
  ADD COLUMN status ENUM('Active','Unenrolled') NOT NULL DEFAULT 'Active' AFTER enrolled_at,
  ADD COLUMN unenrolled_at DATETIME(3) NULL AFTER status,
  ADD KEY ix_enrollment_active (class_id, student_user_id, status);
