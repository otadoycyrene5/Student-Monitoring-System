-- Versioned disclosure and privacy workflows. No existing records rewritten.
CREATE TABLE privacy_notices (
 version VARCHAR(80) PRIMARY KEY,
 content_hash CHAR(64) NOT NULL,
 content JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- statement-break
CREATE TABLE privacy_acknowledgements (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 student_user_id BIGINT UNSIGNED NOT NULL,
 notice_version VARCHAR(80) NOT NULL,
 acknowledged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_privacy_ack (student_user_id,notice_version),
 CONSTRAINT fk_privacy_ack_student FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT,
 CONSTRAINT fk_privacy_ack_notice FOREIGN KEY (notice_version) REFERENCES privacy_notices(version) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- statement-break
CREATE TABLE privacy_requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 student_user_id BIGINT UNSIGNED NOT NULL,
 class_id BIGINT UNSIGNED NULL,
 request_type ENUM('ACCESS','CORRECTION','DELETION','RESTRICTION') NOT NULL,
 details VARCHAR(2000) NOT NULL,
 status ENUM('SUBMITTED','ACKNOWLEDGED','FORWARDED','WITHDRAWN') NOT NULL DEFAULT 'SUBMITTED',
 faculty_note VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_privacy_student (student_user_id,id),
 KEY ix_privacy_class (class_id,id),
 CONSTRAINT fk_privacy_request_student FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT,
 CONSTRAINT fk_privacy_request_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- statement-break
CREATE TABLE privacy_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 subject_user_id BIGINT UNSIGNED NOT NULL,
 event_type ENUM('NOTICE_ACKNOWLEDGED','SELF_ACCESS','EXPORT','REQUEST_SUBMITTED','REQUEST_ROUTED','REQUEST_WITHDRAWN') NOT NULL,
 request_id BIGINT UNSIGNED NULL,
 notice_version VARCHAR(80) NULL,
 occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY ix_privacy_events_subject (subject_user_id,id),
 CONSTRAINT fk_privacy_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT fk_privacy_event_subject FOREIGN KEY (subject_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT,
 CONSTRAINT fk_privacy_event_request FOREIGN KEY (request_id) REFERENCES privacy_requests(id) ON DELETE RESTRICT,
 CONSTRAINT fk_privacy_event_notice FOREIGN KEY (notice_version) REFERENCES privacy_notices(version) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- statement-break
CREATE TABLE privacy_holds (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 student_user_id BIGINT UNSIGNED NULL,
 category ENUM('ALL','CREDENTIAL_RECOVERY') NOT NULL DEFAULT 'ALL',
 reference_code VARCHAR(100) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 released_at DATETIME(3) NULL,
 KEY ix_privacy_holds_student (student_user_id,released_at),
 CONSTRAINT fk_privacy_hold_student FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
