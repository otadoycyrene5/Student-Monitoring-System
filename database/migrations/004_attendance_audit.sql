CREATE TABLE attendance_audit (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 session_id BIGINT UNSIGNED NOT NULL,
 faculty_user_id BIGINT UNSIGNED NOT NULL,
 action ENUM('Saved','Finalized','Reopened') NOT NULL,
 reason VARCHAR(500) NULL,
 changes JSON NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 KEY ix_attendance_audit_session(session_id,id),
 CONSTRAINT fk_attendance_audit_session FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_attendance_audit_faculty FOREIGN KEY(faculty_user_id) REFERENCES faculty_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
