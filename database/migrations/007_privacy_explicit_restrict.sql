-- Preserve the existing verifier's explicit RESTRICT convention on privacy FKs.
-- 006 is already applied and remains unchanged. No rows are removed or rewritten.
ALTER TABLE privacy_acknowledgements
 DROP FOREIGN KEY fk_privacy_ack_student,
 DROP FOREIGN KEY fk_privacy_ack_notice,
 ADD CONSTRAINT fk_privacy_ack_student_restrict FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT fk_privacy_ack_notice_restrict FOREIGN KEY (notice_version) REFERENCES privacy_notices(version) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- statement-break
ALTER TABLE privacy_requests
 DROP FOREIGN KEY fk_privacy_request_student,
 DROP FOREIGN KEY fk_privacy_request_class,
 ADD CONSTRAINT fk_privacy_request_student_restrict FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT fk_privacy_request_class_restrict FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- statement-break
ALTER TABLE privacy_events
 DROP FOREIGN KEY fk_privacy_event_actor,
 DROP FOREIGN KEY fk_privacy_event_subject,
 DROP FOREIGN KEY fk_privacy_event_request,
 DROP FOREIGN KEY fk_privacy_event_notice,
 ADD CONSTRAINT fk_privacy_event_actor_restrict FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT fk_privacy_event_subject_restrict FOREIGN KEY (subject_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT fk_privacy_event_request_restrict FOREIGN KEY (request_id) REFERENCES privacy_requests(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT fk_privacy_event_notice_restrict FOREIGN KEY (notice_version) REFERENCES privacy_notices(version) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- statement-break
ALTER TABLE privacy_holds
 DROP FOREIGN KEY fk_privacy_hold_student,
 ADD CONSTRAINT fk_privacy_hold_student_restrict FOREIGN KEY (student_user_id) REFERENCES student_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
