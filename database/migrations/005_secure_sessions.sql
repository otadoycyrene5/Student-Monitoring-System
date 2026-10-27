CREATE TABLE session_families (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 auth_session_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 role ENUM('faculty','student') NOT NULL,
 password_fingerprint BINARY(32) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 last_renewed_at DATETIME(3) NOT NULL,
 idle_expires_at DATETIME(3) NOT NULL,
 absolute_expires_at DATETIME(3) NOT NULL,
 revoked_at DATETIME(3) NULL,
 revocation_reason VARCHAR(40) NULL,
 UNIQUE KEY uq_family_auth(auth_session_id),
 KEY ix_family_user(user_id,absolute_expires_at),
 CONSTRAINT fk_family_auth FOREIGN KEY(auth_session_id) REFERENCES auth_sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_family_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE refresh_credentials (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 family_id BIGINT UNSIGNED NOT NULL,
 credential_hash BINARY(32) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 used_at DATETIME(3) NULL,
 request_id CHAR(36) NULL,
 retry_envelope MEDIUMBLOB NULL,
 UNIQUE KEY uq_refresh_hash(credential_hash),
 KEY ix_refresh_family(family_id,id),
 CONSTRAINT fk_refresh_family FOREIGN KEY(family_id) REFERENCES session_families(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- statement-break
CREATE TABLE session_security_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 family_id BIGINT UNSIGNED NOT NULL,
 event_type ENUM('Login','Renewed','Replay','Logout','Expired','AccountChanged') NOT NULL,
 occurred_at DATETIME(3) NOT NULL,
 KEY ix_security_family(family_id,id),
 CONSTRAINT fk_security_family FOREIGN KEY(family_id) REFERENCES session_families(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
