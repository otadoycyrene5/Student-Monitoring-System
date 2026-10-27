CREATE TABLE meet_monitoring (
 session_id BIGINT UNSIGNED NOT NULL,
 student_user_id BIGINT UNSIGNED NOT NULL,
 auth_session_id BIGINT UNSIGNED NOT NULL,
 grant_id CHAR(36) NOT NULL,
 meeting_code CHAR(12) NOT NULL,
 consent_active TINYINT UNSIGNED NOT NULL DEFAULT 1,
 consented_at DATETIME(3) NOT NULL,
 expires_at DATETIME(3) NOT NULL,
 stopped_at DATETIME(3) NULL,
 stop_reason VARCHAR(40) NULL,
 last_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
 last_event_id CHAR(36) NULL,
 tab_state ENUM('MEET_TAB_OPEN','MEET_TAB_SELECTED','MEET_TAB_NOT_SELECTED','MEET_TAB_NOT_OPEN','MEET_TAB_CLOSED','MEET_TAB_STATE_UNKNOWN') NOT NULL DEFAULT 'MEET_TAB_STATE_UNKNOWN',
 last_report_at DATETIME(3) NULL,
 PRIMARY KEY(session_id,student_user_id),
 UNIQUE KEY uq_meet_grant(grant_id),
 KEY ix_meet_user_consent(student_user_id,consent_active),
 CONSTRAINT fk_meet_participant FOREIGN KEY(session_id,student_user_id) REFERENCES session_participants(session_id,student_user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_meet_auth FOREIGN KEY(auth_session_id) REFERENCES auth_sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
DELIMITER $$
CREATE TRIGGER meet_monitoring_guard_insert BEFORE INSERT ON meet_monitoring
FOR EACH ROW BEGIN
IF NEW.consent_active NOT IN (0,1) OR NEW.meeting_code NOT REGEXP '^[a-z]{3}-[a-z]{4}-[a-z]{3}$' OR NEW.expires_at <= NEW.consented_at OR (SELECT user_id FROM auth_sessions WHERE id=NEW.auth_session_id) <> NEW.student_user_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid Meet monitoring authorization'; END IF;
END$$
DELIMITER ;
-- statement-break
DELIMITER $$
CREATE TRIGGER meet_monitoring_guard_update BEFORE UPDATE ON meet_monitoring
FOR EACH ROW BEGIN
IF NEW.consent_active NOT IN (0,1) OR NEW.meeting_code NOT REGEXP '^[a-z]{3}-[a-z]{4}-[a-z]{3}$' OR NEW.expires_at <= NEW.consented_at OR (SELECT user_id FROM auth_sessions WHERE id=NEW.auth_session_id) <> NEW.student_user_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid Meet monitoring authorization'; END IF;
END$$
DELIMITER ;
