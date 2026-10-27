'use strict';

const source = 'automatic-attendance-v1';
function classify(start, firstJoin, end) {
  const began = +new Date(start), joined = firstJoin == null ? NaN : +new Date(firstJoin);
  if (Number.isFinite(joined) && joined >= began && (!end || joined <= +new Date(end))) {
    return joined - began < 15 * 60 * 1000 ? 'Present' : 'Late';
  }
  return end ? 'Absent' : 'Not Joined';
}

async function apply(db, sessionId, {initialize = false} = {}) {
  const [[session]] = await db.execute('SELECT s.*,c.faculty_user_id FROM sessions s JOIN classes c ON c.id=s.class_id WHERE s.id=? FOR UPDATE',[sessionId]);
  const [[correction]] = await db.execute("SELECT action FROM attendance_audit WHERE session_id=? AND action IN ('Reopened','Finalized') ORDER BY id DESC LIMIT 1",[sessionId]);
  if (correction?.action === 'Reopened') return;
  const read = async () => (await db.execute('SELECT student_user_id AS studentId,status,finalized_at AS finalizedAt FROM attendance WHERE session_id=? ORDER BY student_user_id',[sessionId]))[0];
  const before = await read();
  const complete = session.status === 'Completed' && !!session.ended_at;
  if ((initialize || complete) && !before.some(row => row.finalizedAt)) {
    await db.execute("INSERT INTO attendance(session_id,student_user_id,status) SELECT ?,e.student_user_id,'Not Joined' FROM enrollments e WHERE e.class_id=? AND e.enrolled_at<=? ON DUPLICATE KEY UPDATE id=attendance.id",[sessionId,session.class_id,session.ended_at || session.started_at]);
  }
  const [rows] = await db.execute('SELECT a.student_user_id AS studentId,a.status,a.finalized_at AS finalizedAt,p.first_joined_at AS firstJoinedAt FROM attendance a LEFT JOIN session_participants p ON p.session_id=a.session_id AND p.student_user_id=a.student_user_id WHERE a.session_id=?',[sessionId]);
  for (const row of rows) {
    if (row.finalizedAt) continue;
    const status = classify(session.started_at,row.firstJoinedAt,complete ? session.ended_at : null);
    if (row.status !== status || complete) await db.execute('UPDATE attendance SET status=?,finalized_at=IF(?,UTC_TIMESTAMP(3),finalized_at) WHERE session_id=? AND student_user_id=? AND finalized_at IS NULL',[status,complete,sessionId,row.studentId]);
  }
  const after = await read();
  if (JSON.stringify(before) !== JSON.stringify(after) || complete && !rows.length && correction?.action !== 'Finalized') {
    await db.execute('INSERT INTO attendance_audit(session_id,faculty_user_id,action,reason,changes,occurred_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))',[sessionId,session.faculty_user_id,complete?'Finalized':'Saved','Automatic attendance: first valid join before 15 minutes = Present; at or after 15 minutes = Late; no valid join by session end = Absent.',JSON.stringify({source,actor:'system',before,after})]);
  }
}

module.exports = {apply,classify,source};
