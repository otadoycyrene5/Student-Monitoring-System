'use strict';

module.exports={
  invalidEnrollmentRole:"SELECT COUNT(*) n FROM enrollments e JOIN users u ON u.id=e.student_user_id WHERE u.role<>'student'",
  orphanAttendance:'SELECT COUNT(*) n FROM attendance a LEFT JOIN sessions s ON s.id=a.session_id LEFT JOIN student_profiles p ON p.user_id=a.student_user_id WHERE s.id IS NULL OR p.id IS NULL',
  orphanAttendanceAudit:'SELECT COUNT(*) n FROM attendance_audit a LEFT JOIN sessions s ON s.id=a.session_id LEFT JOIN faculty_profiles f ON f.user_id=a.faculty_user_id WHERE s.id IS NULL OR f.id IS NULL',
  orphanAuthenticationFamily:'SELECT COUNT(*) n FROM session_families f LEFT JOIN auth_sessions a ON a.id=f.auth_session_id LEFT JOIN users u ON u.id=f.user_id WHERE a.id IS NULL OR u.id IS NULL',
  orphanRefreshCredential:'SELECT COUNT(*) n FROM refresh_credentials r LEFT JOIN session_families f ON f.id=r.family_id WHERE f.id IS NULL',
  orphanMonitoringParticipant:'SELECT COUNT(*) n FROM meet_monitoring m LEFT JOIN session_participants p ON p.session_id=m.session_id AND p.student_user_id=m.student_user_id WHERE p.id IS NULL',

  overlappingIntervals:"SELECT COUNT(*) n FROM session_connection_intervals a JOIN session_connection_intervals b ON a.participant_id=b.participant_id AND a.id<b.id WHERE a.connected_at<COALESCE(b.disconnected_at,'9999-12-31') AND b.connected_at<COALESCE(a.disconnected_at,'9999-12-31')",
  orphanPrivacyRequests:'SELECT COUNT(*) n FROM privacy_requests r LEFT JOIN student_profiles p ON p.user_id=r.student_user_id LEFT JOIN classes c ON c.id=r.class_id WHERE p.id IS NULL OR (r.class_id IS NOT NULL AND c.id IS NULL)',

  invalidPrivacyStudent:"SELECT COUNT(*) n FROM privacy_requests r JOIN users u ON u.id=r.student_user_id WHERE u.role<>'student'",
  invalidPrivacyAcknowledgement:'SELECT COUNT(*) n FROM privacy_acknowledgements a LEFT JOIN privacy_notices n ON n.version=a.notice_version WHERE n.version IS NULL',
  invalidSessionFamily:'SELECT COUNT(*) n FROM session_families f JOIN auth_sessions a ON a.id=f.auth_session_id WHERE f.user_id<>a.user_id OR f.idle_expires_at>f.absolute_expires_at OR a.expires_at>f.absolute_expires_at',
  multipleRefreshSuccessors:'SELECT COUNT(*) n FROM (SELECT family_id FROM refresh_credentials WHERE used_at IS NULL GROUP BY family_id HAVING COUNT(*)>1) d',
  invalidAttendanceAuditOwner:'SELECT COUNT(*) n FROM attendance_audit a JOIN sessions s ON s.id=a.session_id JOIN classes c ON c.id=s.class_id WHERE a.faculty_user_id<>c.faculty_user_id',
  orphanEnrollments:'SELECT COUNT(*) n FROM enrollments e LEFT JOIN classes c ON c.id=e.class_id LEFT JOIN student_profiles p ON p.user_id=e.student_user_id WHERE c.id IS NULL OR p.id IS NULL',
  duplicateEnrollments:'SELECT COUNT(*) n FROM (SELECT class_id,student_user_id FROM enrollments GROUP BY class_id,student_user_id HAVING COUNT(*)>1) d',
  duplicateParticipants:'SELECT COUNT(*) n FROM (SELECT session_id,student_user_id FROM session_participants GROUP BY session_id,student_user_id HAVING COUNT(*)>1) d',
  duplicateAttendance:'SELECT COUNT(*) n FROM (SELECT session_id,student_user_id FROM attendance GROUP BY session_id,student_user_id HAVING COUNT(*)>1) d',
  invalidOwnership:"SELECT COUNT(*) n FROM classes c JOIN users u ON u.id=c.faculty_user_id WHERE u.role<>'faculty'",
  unenrolledAttendance:'SELECT COUNT(*) n FROM attendance a JOIN sessions s ON s.id=a.session_id LEFT JOIN enrollments e ON e.class_id=s.class_id AND e.student_user_id=a.student_user_id WHERE e.id IS NULL',
  orphanRosterLogs:'SELECT COUNT(*) n FROM activity_logs l LEFT JOIN attendance a ON a.session_id=l.session_id AND a.student_user_id=l.student_user_id WHERE l.student_user_id IS NOT NULL AND a.id IS NULL',
  badGrantAssociation:'SELECT COUNT(*) n FROM meet_monitoring m JOIN auth_sessions a ON a.id=m.auth_session_id LEFT JOIN session_families f ON f.auth_session_id=a.id WHERE a.user_id<>m.student_user_id OR m.expires_at>COALESCE(f.absolute_expires_at,a.expires_at)',
  duplicateMonitoringEvents:"SELECT COUNT(*) n FROM (SELECT JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.grantId')),JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.eventId')) FROM activity_logs WHERE JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.scope'))='meet-only' AND JSON_EXTRACT(event_details,'$.eventId') IS NOT NULL GROUP BY JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.grantId')),JSON_UNQUOTE(JSON_EXTRACT(event_details,'$.eventId')) HAVING COUNT(*)>1) d",
  badIntervals:'SELECT COUNT(*) n FROM session_connection_intervals i JOIN session_participants p ON p.id=i.participant_id JOIN sessions s ON s.id=p.session_id WHERE i.disconnected_at<i.connected_at OR (s.status=\'Completed\' AND i.disconnected_at IS NULL)',
  futureLogs:'SELECT COUNT(*) n FROM activity_logs WHERE occurred_at>DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 SECOND)',
  outsideSessionLogs:"SELECT COUNT(*) n FROM activity_logs l JOIN sessions s ON s.id=l.session_id WHERE l.occurred_at<s.started_at OR (s.ended_at IS NOT NULL AND l.occurred_at>s.ended_at AND l.event_type<>'Session Ended')",
};
