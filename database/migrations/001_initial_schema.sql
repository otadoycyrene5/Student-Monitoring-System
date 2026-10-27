-- Use the migration runner, not an untracked manual import.
CREATE TABLE users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) NOT NULL,
 password_hash VARCHAR(512) NOT NULL,
 full_name VARCHAR(160) NOT NULL,
 role ENUM('faculty','student') NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE faculty_profiles (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 faculty_id VARCHAR(80) NOT NULL,
 department VARCHAR(160) NOT NULL,
 academic_position ENUM('Instructor','Assistant Professor','Associate Professor','Professor','Part Time') NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_faculty_user (user_id), UNIQUE KEY uq_faculty_id (faculty_id),
 CONSTRAINT fk_faculty_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE student_profiles (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 student_id VARCHAR(80) NOT NULL, program VARCHAR(160) NOT NULL,
 year_level TINYINT UNSIGNED NOT NULL, section VARCHAR(80) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_student_user (user_id), UNIQUE KEY uq_student_id (student_id),
 CONSTRAINT fk_student_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE classes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 faculty_user_id BIGINT UNSIGNED NOT NULL,
 class_name VARCHAR(160) NOT NULL, section VARCHAR(80) NOT NULL,
 class_code VARCHAR(30) NOT NULL, meet_link VARCHAR(2048) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_class_code (class_code),
 CONSTRAINT fk_class_faculty FOREIGN KEY (faculty_user_id) REFERENCES faculty_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE enrollments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 class_id BIGINT UNSIGNED NOT NULL, student_user_id BIGINT UNSIGNED NOT NULL,
 enrolled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_enrollment (class_id,student_user_id),
 CONSTRAINT fk_enrollment_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_enrollment_student FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE sessions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 class_id BIGINT UNSIGNED NOT NULL, status ENUM('Live','Completed') NOT NULL,
 started_at DATETIME(3) NOT NULL, ended_at DATETIME(3) NULL,
 live_class_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status='Live' THEN class_id ELSE NULL END) STORED,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_live_class (live_class_id), KEY ix_session_class_time (class_id,started_at),
 CONSTRAINT fk_session_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE attendance (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 session_id BIGINT UNSIGNED NOT NULL, student_user_id BIGINT UNSIGNED NOT NULL,
 status ENUM('Present','Late','Absent','Not Joined') NOT NULL DEFAULT 'Not Joined',
 finalized_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_attendance (session_id,student_user_id),
 KEY ix_attendance_student (student_user_id,status),
 CONSTRAINT fk_attendance_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_attendance_student FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE session_participants (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 session_id BIGINT UNSIGNED NOT NULL, student_user_id BIGINT UNSIGNED NOT NULL,
 first_joined_at DATETIME(3) NOT NULL, last_joined_at DATETIME(3) NOT NULL, last_left_at DATETIME(3) NULL,
 participation_status ENUM('Joined','Left') NOT NULL,
 connection_status ENUM('Online','Offline') NOT NULL DEFAULT 'Offline',
 meet_tab_status ENUM('Active','Inactive','Not Detected') NOT NULL DEFAULT 'Not Detected',
 browser_activity_status ENUM('Active','Inactive','Unknown') NOT NULL DEFAULT 'Unknown',
 last_activity_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_participant (session_id,student_user_id),
 CONSTRAINT fk_participant_roster FOREIGN KEY (session_id,student_user_id) REFERENCES attendance(session_id,student_user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE session_connection_intervals (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 participant_id BIGINT UNSIGNED NOT NULL,
 connected_at DATETIME(3) NOT NULL, disconnected_at DATETIME(3) NULL,
 open_participant_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN disconnected_at IS NULL THEN participant_id ELSE NULL END) STORED,
 UNIQUE KEY uq_open_interval (open_participant_id), KEY ix_interval_time (participant_id,connected_at),
 CONSTRAINT fk_interval_participant FOREIGN KEY (participant_id) REFERENCES session_participants(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE activity_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 session_id BIGINT UNSIGNED NOT NULL, student_user_id BIGINT UNSIGNED NULL,
 event_type ENUM('Session Started','Session Ended','Student Joined','Student Rejoined','Student Left','Connection Changed','Meet Tab Changed','Browser Activity Changed','Inactivity Threshold Reached') NOT NULL,
 previous_state VARCHAR(40) NULL, new_state VARCHAR(40) NULL, event_details JSON NULL,
 occurred_at DATETIME(3) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_log_session_time (session_id,occurred_at,id), KEY ix_log_student_time (student_user_id,occurred_at),
 CONSTRAINT fk_log_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_log_roster FOREIGN KEY (session_id,student_user_id) REFERENCES attendance(session_id,student_user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_users_insert BEFORE INSERT ON users
FOR EACH ROW BEGIN
IF NEW.role NOT IN ('faculty','student') OR TRIM(NEW.email)='' OR TRIM(NEW.full_name)='' OR NEW.password_hash NOT REGEXP '^[$](argon2id|argon2i|2[aby]|pbkdf2-sha256|scrypt)[$]' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid account fields or password hash format'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_users_update BEFORE UPDATE ON users
FOR EACH ROW BEGIN
IF NEW.role NOT IN ('faculty','student') OR TRIM(NEW.email)='' OR TRIM(NEW.full_name)='' OR NEW.password_hash NOT REGEXP '^[$](argon2id|argon2i|2[aby]|pbkdf2-sha256|scrypt)[$]' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid account fields or password hash format'; END IF;
IF NEW.role <> OLD.role AND (EXISTS(SELECT 1 FROM faculty_profiles WHERE user_id=OLD.id) OR EXISTS(SELECT 1 FROM student_profiles WHERE user_id=OLD.id)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Cannot change role of a profiled account'; END IF;
END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_faculty_profiles_insert BEFORE INSERT ON faculty_profiles
FOR EACH ROW BEGIN
IF (SELECT role FROM users WHERE id=NEW.user_id) <> 'faculty' OR TRIM(NEW.faculty_id)='' OR TRIM(NEW.department)='' OR NEW.academic_position NOT IN ('Instructor','Assistant Professor','Associate Professor','Professor','Part Time') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid faculty profile'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_faculty_profiles_update BEFORE UPDATE ON faculty_profiles
FOR EACH ROW BEGIN
IF (SELECT role FROM users WHERE id=NEW.user_id) <> 'faculty' OR TRIM(NEW.faculty_id)='' OR TRIM(NEW.department)='' OR NEW.academic_position NOT IN ('Instructor','Assistant Professor','Associate Professor','Professor','Part Time') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid faculty profile'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_student_profiles_insert BEFORE INSERT ON student_profiles
FOR EACH ROW BEGIN
IF (SELECT role FROM users WHERE id=NEW.user_id) <> 'student' OR NEW.year_level NOT BETWEEN 1 AND 4 OR TRIM(NEW.student_id)='' OR TRIM(NEW.program)='' OR TRIM(NEW.section)='' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid student profile'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_student_profiles_update BEFORE UPDATE ON student_profiles
FOR EACH ROW BEGIN
IF (SELECT role FROM users WHERE id=NEW.user_id) <> 'student' OR NEW.year_level NOT BETWEEN 1 AND 4 OR TRIM(NEW.student_id)='' OR TRIM(NEW.program)='' OR TRIM(NEW.section)='' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid student profile'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_classes_insert BEFORE INSERT ON classes
FOR EACH ROW BEGIN
IF TRIM(NEW.class_name)='' OR TRIM(NEW.section)='' OR NEW.class_code NOT REGEXP '^CL-[0-9A-F]{6}$' OR NEW.meet_link NOT REGEXP '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}/?$' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid class fields'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_classes_update BEFORE UPDATE ON classes
FOR EACH ROW BEGIN
IF TRIM(NEW.class_name)='' OR TRIM(NEW.section)='' OR NEW.class_code NOT REGEXP '^CL-[0-9A-F]{6}$' OR NEW.meet_link NOT REGEXP '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}/?$' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid class fields'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_sessions_insert BEFORE INSERT ON sessions
FOR EACH ROW BEGIN
IF NEW.status NOT IN ('Live','Completed') OR (NEW.status='Live' AND NEW.ended_at IS NOT NULL) OR (NEW.status='Completed' AND NEW.ended_at IS NULL) OR NEW.ended_at < NEW.started_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid session status or time order'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_sessions_update BEFORE UPDATE ON sessions
FOR EACH ROW BEGIN
IF NEW.status NOT IN ('Live','Completed') OR (NEW.status='Live' AND NEW.ended_at IS NOT NULL) OR (NEW.status='Completed' AND NEW.ended_at IS NULL) OR NEW.ended_at < NEW.started_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid session status or time order'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_attendance_insert BEFORE INSERT ON attendance
FOR EACH ROW BEGIN
IF NEW.status NOT IN ('Present','Late','Absent','Not Joined') OR (NEW.status='Absent' AND (SELECT ended_at FROM sessions WHERE id=NEW.session_id) IS NULL) OR (NEW.finalized_at IS NOT NULL AND ((SELECT ended_at FROM sessions WHERE id=NEW.session_id) IS NULL OR NEW.finalized_at < (SELECT ended_at FROM sessions WHERE id=NEW.session_id))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid attendance status or finalization'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_attendance_update BEFORE UPDATE ON attendance
FOR EACH ROW BEGIN
IF NEW.status NOT IN ('Present','Late','Absent','Not Joined') OR (NEW.status='Absent' AND (SELECT ended_at FROM sessions WHERE id=NEW.session_id) IS NULL) OR (NEW.finalized_at IS NOT NULL AND ((SELECT ended_at FROM sessions WHERE id=NEW.session_id) IS NULL OR NEW.finalized_at < (SELECT ended_at FROM sessions WHERE id=NEW.session_id))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid attendance status or finalization'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_session_participants_insert BEFORE INSERT ON session_participants
FOR EACH ROW BEGIN
IF NEW.last_joined_at < NEW.first_joined_at OR NEW.last_left_at < NEW.first_joined_at OR NEW.first_joined_at < (SELECT started_at FROM sessions WHERE id=NEW.session_id) OR NEW.first_joined_at > (SELECT ended_at FROM sessions WHERE id=NEW.session_id) OR NEW.participation_status NOT IN ('Joined','Left') OR NEW.connection_status NOT IN ('Online','Offline') OR NEW.meet_tab_status NOT IN ('Active','Inactive','Not Detected') OR NEW.browser_activity_status NOT IN ('Active','Inactive','Unknown') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid participant state or time order'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_session_participants_update BEFORE UPDATE ON session_participants
FOR EACH ROW BEGIN
IF NEW.last_joined_at < NEW.first_joined_at OR NEW.last_left_at < NEW.first_joined_at OR NEW.first_joined_at < (SELECT started_at FROM sessions WHERE id=NEW.session_id) OR NEW.first_joined_at > (SELECT ended_at FROM sessions WHERE id=NEW.session_id) OR NEW.participation_status NOT IN ('Joined','Left') OR NEW.connection_status NOT IN ('Online','Offline') OR NEW.meet_tab_status NOT IN ('Active','Inactive','Not Detected') OR NEW.browser_activity_status NOT IN ('Active','Inactive','Unknown') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid participant state or time order'; END IF;
IF NEW.first_joined_at <> OLD.first_joined_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='First join timestamp is immutable'; END IF;
END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_session_connection_intervals_insert BEFORE INSERT ON session_connection_intervals
FOR EACH ROW BEGIN
IF NEW.disconnected_at < NEW.connected_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid connection interval'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_session_connection_intervals_update BEFORE UPDATE ON session_connection_intervals
FOR EACH ROW BEGIN
IF NEW.disconnected_at < NEW.connected_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid connection interval'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_activity_logs_insert BEFORE INSERT ON activity_logs
FOR EACH ROW BEGIN
IF NEW.event_type NOT IN ('Session Started','Session Ended','Student Joined','Student Rejoined','Student Left','Connection Changed','Meet Tab Changed','Browser Activity Changed','Inactivity Threshold Reached') OR (NEW.event_type IN ('Session Started','Session Ended') AND NEW.student_user_id IS NOT NULL) OR (NEW.event_type NOT IN ('Session Started','Session Ended') AND NEW.student_user_id IS NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid activity event identity'; END IF;

END$$
DELIMITER ;

-- statement-break
DELIMITER $$
CREATE TRIGGER validate_activity_logs_update BEFORE UPDATE ON activity_logs
FOR EACH ROW BEGIN
IF NEW.event_type NOT IN ('Session Started','Session Ended','Student Joined','Student Rejoined','Student Left','Connection Changed','Meet Tab Changed','Browser Activity Changed','Inactivity Threshold Reached') OR (NEW.event_type IN ('Session Started','Session Ended') AND NEW.student_user_id IS NOT NULL) OR (NEW.event_type NOT IN ('Session Started','Session Ended') AND NEW.student_user_id IS NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid activity event identity'; END IF;

END$$
DELIMITER ;
