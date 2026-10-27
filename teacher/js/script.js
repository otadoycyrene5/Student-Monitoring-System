
'use strict';
const { escape: e, text: d, badge, time, date, button: b, field, table } = UI;
const root = document.getElementById('app');
const profileDialog = document.getElementById('faculty-profile-dialog');
const state = { authMode: 'login', page: 'dashboard', classId: '', sessionId: '', query: '' };
let db, me;
let profileEditing=false;
let profileTrigger=null;
let copiedClassCode = '';
let copiedUntil = 0;
let copyFeedbackTimer;
const navigationKey = 'classence-teacher-navigation';
const authPageKey = 'classence-faculty-auth-page';
function saveNavigation() {
  try {
    if (!me) {
      sessionStorage.removeItem(navigationKey);
      sessionStorage.setItem(authPageKey, state.authMode);
      return;
    }
    sessionStorage.removeItem(authPageKey);
    sessionStorage.setItem(navigationKey, JSON.stringify({ email: me.email, page: state.page, classId: state.classId, sessionId: state.sessionId }));
  } catch {                                                                   }
}
function restoreNavigation() {
  try {
    const user = FacultyAPI.current;
    if (!user) {
      const authPage = sessionStorage.getItem(authPageKey);
      if (['login', 'register', 'registration-success'].includes(authPage)) state.authMode = authPage;
      return;
    }
    const saved = JSON.parse(sessionStorage.getItem(navigationKey));
    const pages = ['dashboard', 'classes', 'details', 'create', 'edit', 'monitor', 'attendance', 'attendanceDetail', 'logs', 'profile'];
    if (!saved || !user || saved.email !== user.email || !pages.includes(saved.page)) return;
    const classId = saved.classId || '';
    const sessionId = saved.sessionId || '';
    Object.assign(state, { page: saved.page, classId, sessionId });
  } catch {                                                   }
}
const classById = id => db.classes.find(c => c.id === id);
const myClasses = () => db.classes.filter(c => c.teacherEmail === me.email);
const mySessions = () => db.sessions.filter(s => myClasses().some(c => c.id === s.classId)).sort((a, b) => b.start - a.start);
const name = email => db.users.find(u => u.email === email)?.name || email;
const liveFor = classId => db.sessions.find(s => s.classId === classId && !s.end);
const nav = (label, page, attrs = '', style = 'secondary') => b(label, 'navigate', `data-page="${page}" ${attrs}`, style);
const empty = (title, text, action = '') => `<div class="panel empty"><h2>${e(title)}</h2><p>${e(text)}</p>${action}</div>`;

function navigate(page, classId, sessionId) {
  state.page = page;
  if (classId) state.classId = classId;
  if (sessionId) state.sessionId = sessionId;
  state.query = '';
  render();
}
function sessionRows(sessions, historical = false) {
  const rows = table(['Class', 'Date', 'Time', 'Status', ''], sessions.map(s => [e(classById(s.classId)?.name), date(s.start), UI.timeRange(s.start, s.end), badge(s.end ? 'Completed' : 'Live'), s.end ? `<button type="button" class="secondary" data-faculty-records="attendance" data-class-id="${e(s.classId)}" data-session-id="${e(s.id)}">View summary</button>` : nav('View monitoring', 'monitor', `data-class="${e(s.classId)}" data-session="${e(s.id)}"`)]),'No matching records.',sessions.map(s=>s.id));
  return historical ? '<div class="historical-session-table">' + rows + '</div>' : rows;
}
function metrics(items) {
  return `<div class="grid metrics">${items.map(([label, value]) => `<div class="card"><small>${e(label)}</small><div class="metric">${d(value)}</div></div>`).join('')}</div>`;
}
function dashboard() {
  if (!ClassenceRealtime.data) return '<p role="status">' + e(ClassenceRealtime.state.connection === 'DISCONNECTED' ? 'Unable to load dashboard. Reconnecting...' : 'Loading dashboard...') + '</p>';
  const classes = myClasses(), sessions = mySessions(), counts = ClassenceRealtime.data.summary;
  if (!counts) return '<p role="status">Loading dashboard totals...</p>';
  return metrics([['My Classes', counts.classes], ['Enrolled Students', counts.students], ['Active Sessions', counts.active], ['Completed Sessions', counts.completed]]) +
    `<div class="overview-sections"><section class="panel overview-classes"><div class="flex"><h2>My Classes</h2>${nav('View all', 'classes', '', 'link')}${nav('+ Create class', 'create', '', 'primary right')}</div>${classes.length ? table(['Class / section', 'Students', ''], classes.map(c => [`<strong>${d(c.name)}</strong><br><small>${d(c.section)}</small>`, c.students.length, nav('Open', 'details', `data-class="${e(c.id)}"`)]),'No matching records.',classes.map(c=>c.id)) : '<p class="muted">Create your first class to get started.</p>'}</section><section class="panel"><h2>Recent Sessions</h2>${sessionRows(sessions.slice(0, 5), true)}</section></div>`;
}
function classInformation(c, heading = false) {
  return `<div class="class-information">${heading ? `<div class="class-title-row"><h2>${d(c.name)}</h2>${nav('Edit Class', 'edit', `data-class="${e(c.id)}"`, 'secondary class-edit-button')}</div>` : `<strong>${d(c.name)}</strong>`}<p>Section ${d(c.section)} &middot; Teacher: ${d(c.teacher)}</p><div class="class-code-line"><span>Class code: <strong>${d(c.code)}</strong></span>${b(copiedClassCode === c.code && Date.now() < copiedUntil ? 'Copied' : 'Copy class code', 'copy', `data-code="${e(c.code)}" aria-live="polite"`)}</div><p>Google Meet: <a href="${e(c.meet)}" target="_blank" rel="noopener noreferrer">${d(c.meet)}</a></p><p>Enrolled students: <strong>${c.students.length}</strong></p></div>`;
}
function classesView() {
  const classes = myClasses().filter(c => (c.name + ' ' + c.section + ' ' + c.code).toLowerCase().includes(state.query.toLowerCase()));
  return `<section class="panel"><div class="toolbar"><input id="search" class="search-input" type="search" data-filter="query" value="${e(state.query)}" placeholder="Search classes" aria-label="Search classes">${nav('+ Create class', 'create', '', 'primary right')}</div>${table(['Class', 'Section', 'Class code', 'Students', 'Actions'], classes.map(c => [e(c.name), e(c.section), `<code>${d(c.code)}</code>`, c.students.length, nav('View class', 'details', `data-class="${e(c.id)}"`) + ' ' + nav('Edit', 'edit', `data-class="${e(c.id)}"`, 'ghost')]),'No matching records.',classes.map(c=>c.id))}</section>`;
}
function classForm() {
  const c = state.page === 'edit' ? myClasses().find(c => c.id === state.classId) : null;
  if (state.page === 'edit' && !c) return empty('Class unavailable', 'Choose a class from My Classes.', nav('My Classes', 'classes'));
  return `<section class="panel form-panel"><p class="muted">Register the class and its Google Meet link. The enrollment code is generated separately.</p><form data-form="class">${field('name', 'Class name', 'text', c?.name || '', 'required maxlength="160"')}${field('section', 'Section', 'text', c?.section || '', 'required maxlength="80"')}${field('meet', 'Google Meet link', 'url', c?.meet || '', 'required placeholder="https://meet.google.com/abc-defg-hij"')}<small>Use the full, registered Meet URL.</small>${UI.feedback}<div class="toolbar"><button type="submit">${c ? 'Save changes' : 'Create Class'}</button>${nav('Cancel', 'classes')}</div></form></section>`;
}
function details() {
  const c = myClasses().find(c => c.id === state.classId);
  if (!c) return empty('Class unavailable', 'Choose one of your classes.', nav('My Classes', 'classes'));
  const live = liveFor(c.id);
  return `<div class="class-details-actions">${nav('\u2190 My Classes', 'classes', '', 'secondary back-to-classes')}${live ? nav('View monitoring', 'monitor', `data-class="${e(c.id)}" data-session="${live.id}"`, 'primary') : b('Start session', 'start', `data-class="${e(c.id)}"`, 'primary')}</div><div><section class="card">${classInformation(c, true)}</section></div><section class="panel"><h2>Enrolled Students</h2>${table(['Student name', 'Email address', 'Enrollment date'], c.enrolledStudents.map(student => [e(student.name), d(student.email), e(date(student.enrolledAt))]),'No matching records.',c.enrolledStudents.map(student=>student.id))}</section><section class="panel"><h2>Session History</h2>${sessionRows(mySessions().filter(s => s.classId === c.id))}</section>`;
}
function monitor() {
  return `<div id="real-realtime" class="historical-monitor" data-class-id="${e(state.classId)}" data-session-id="${e(state.sessionId)}"></div>`;
}
function attendance() {
  return '<div class="historical-attendance" data-attendance-list></div>';
}
function attendanceDetail() {
  return '<div class="attendance-page" data-attendance-page></div>';
}
function showAttendance(classId, sessionId = '') {
  state.sessionId = sessionId;
  navigate('attendanceDetail', classId, sessionId);
}
function logs() {
  const events = ClassenceRealtime.data?.activityLogs || [];
  return `<section class="panel"><h2>Activity Logs</h2>${table(['Time','Class','Student','Event','Previous','New'],events.map(event=>[e(UI.dateTime(event.receivedAt)),e(event.className),e(event.name || 'System'),e(event.action),d(event.previousState),d(event.state)]),'No activity logs available.',events.map(event=>[event.receivedAt,event.className,event.name,event.action,event.previousState,event.state].join('|')))}</section>`;
}
function profile() {
  const classes = myClasses();
  const students = new Set(classes.flatMap(c => c.students)).size;
  const initials = String(me.name ?? '').replace(/^Prof\.?\s+/i, '').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  return `<section class="panel profile-identity"><div class="profile-identity-text"><div class="profile-heading"><div class="profile-avatar" aria-hidden="true">${d(initials)}</div><h2>${d(me.name)}</h2>${b('Edit Profile', 'edit-profile', '', 'secondary profile-edit-button')}</div><dl class="profile-details"><div><dt>Faculty ID:</dt><dd>${d(me.facultyId)}</dd></div><div><dt>Full Name:</dt><dd>${d(me.name)}</dd></div><div><dt>Academic Position:</dt><dd>${d(me.academicRank)}</dd></div><div><dt>Department:</dt><dd>${d(me.department)}</dd></div><div><dt>Institutional Email Address:</dt><dd>${d(me.email)}</dd></div><div><dt>Account Role:</dt><dd>${d(me.role === 'teacher' ? 'Faculty' : me.role)}</dd></div></dl></div></section><section class="panel profile-overview"><h2>Teaching Overview</h2><dl class="profile-stats"><div><dt>My Classes</dt><dd>${classes.length}</dd></div><div><dt>Enrolled Students</dt><dd>${students}</dd></div><div><dt>Completed Sessions</dt><dd>${ClassenceRealtime.data?.summary?.completed ?? 0}</dd></div></dl></section>`;
}
function openProfileDialog(trigger) {
  if (!me || profileDialog.open) return;
  profileTrigger = trigger;
  profileEditing = true;
  profileDialog.innerHTML = `<h2 id="faculty-profile-title">Edit Faculty Profile</h2><form data-form="faculty-profile" data-owner="${e(me.id)}">${field('fullName', 'Full Name', 'text', me.name || '', 'required maxlength="160" autocomplete="name"')}${field('email', 'Institutional Email Address', 'email', me.email || '', 'required maxlength="254" autocomplete="email"')}${field('department', 'Department', 'text', me.department || '', 'required maxlength="160"')}<label for="profile-position">Academic Position</label><select id="profile-position" name="academicPosition" required>${CW.academicRanks.map(rank => `<option value="${e(rank)}" ${rank === me.academicRank ? 'selected' : ''}>${e(rank)}</option>`).join('')}</select><p data-profile-feedback role="status" aria-live="polite"></p><div class="toolbar"><button type="button" class="secondary" data-profile-close>Cancel</button><button type="submit" class="primary">Save Profile</button></div></form>`;
  profileDialog.showModal();
  profileDialog.querySelector('#fullName')?.focus({ preventScroll: true });
}
function closeProfileDialog() {
  if (!profileDialog.open || profileDialog.dataset.saving) return;
  UI.closeDialog(profileDialog);
}
profileDialog.addEventListener('click', event => {
  if (event.target === profileDialog && !profileDialog.dataset.saving) closeProfileDialog();
});
profileDialog.addEventListener('close', () => {
  profileEditing = false;
  delete profileDialog.dataset.saving;
  profileDialog.innerHTML = '';
  profileTrigger?.focus({ preventScroll: true });
  profileTrigger = null;
});
profileDialog.addEventListener('click', event => {
  if (event.target.closest('[data-profile-close]')) closeProfileDialog();
});
profileDialog.addEventListener('submit', async event => {
  if (event.target.dataset.form !== 'faculty-profile') return;
  event.preventDefault();
  const form = event.target, feedback = form.querySelector('[data-profile-feedback]'), button = form.querySelector('[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  profileDialog.dataset.saving = 'true';
  try {
    await FacultyAPI.updateProfile({ fullName: form.elements.fullName.value, email: form.elements.email.value, department: form.elements.department.value, academicPosition: form.elements.academicPosition.value }, form.dataset.owner);
    await ClassenceRealtime.refresh().catch(() => {});
    delete profileDialog.dataset.saving;
    closeProfileDialog();
    render();
    UI.message('Profile updated');
  } catch (error) {
    if (!FacultyAPI.current) {
      closeProfileDialog();
      render();
      UI.message(error.message, true);
    } else {
      feedback.className = 'error';
      feedback.textContent = error.message;
    }
  } finally {
    delete profileDialog.dataset.saving;
    button.disabled = false;
  }
});
function render(background = false) {
  if (FacultyAPI.current?.id === me?.id && state.page === 'attendanceDetail' && FacultyRecords.isMounted(state.classId, state.sessionId)) { FacultyRecords.refreshAutomatic(); return; }

  if (!background) root.classList.remove('quiet-update');
  try {
    const sameOwner = FacultyAPI.current?.id === me?.id;
    me = FacultyAPI.current;
    if(FacultyAPI.checking&&!me){root.innerHTML='<div class="auth"><h1>Classence</h1><p role="status">Checking your sign-in...</p></div>';return;}
    ClassenceRealtime.ensure();
    const data = ClassenceRealtime.data;
    if(background&&sameOwner&&me&&!data&&root.querySelector(".app")){ClassenceRealtime.mount();return;}
    db = {classes:[],sessions:[],users:[],enrollments:[]};
    for (const c of data?.classes || []) {
      db.classes.push({...c,teacherEmail:me.email,teacher:c.facultyName,enrolledStudents:c.students,students:c.students.map(u=>u.email)});
      for(const u of c.students){db.users.push({...u,role:'student'});db.enrollments.push({email:u.email,classId:c.id,date:date(u.enrolledAt)});}
      for(const session of c.sessions)db.sessions.push({...session,classId:c.id,start:Date.parse(session.startedAt),end:session.endedAt?Date.parse(session.endedAt):null});
    }
    saveNavigation();
    if (!me) { root.innerHTML = teacherAuth(state.authMode); UI.reveal('auth:' + state.authMode); return; }
    const titles = { dashboard: 'Overview', classes: 'My Classes', details: 'Class Details', create: 'Create Class', edit: 'Edit Class', monitor: 'Live Monitoring', attendance: 'Attendance Records', attendanceDetail: 'Session Summary', logs: 'Activity Logs', profile: 'My Profile' };
    const views = { dashboard, classes: classesView, details, create: classForm, edit: classForm, monitor, attendance, attendanceDetail, logs, profile };
    const menu = [['dashboard', 'Overview'], ['classes', 'My Classes'], ['monitor', 'Live Monitoring'], ['attendance', 'Attendance'], ['logs', 'Activity Logs'], ['profile', 'Profile']];
    const group = ['create', 'edit', 'details'].includes(state.page) ? 'classes' : state.page === 'attendanceDetail' ? 'attendance' : state.page;
    if (background && sameOwner && me && root.querySelector('#view')) {
      if (state.page === 'attendance') FacultyRecords.mountList(myClasses());
      else if (state.page === 'monitor') ClassenceRealtime.mount();
      else if (!['create','edit'].includes(state.page)) UI.patchHTML(root.querySelector('#view'),(views[state.page] || dashboard)());
      return;
    }
    root.innerHTML = `<div class="app"><aside class="sidebar">${UI.brand}<nav aria-label="Teacher navigation">${menu.map(([page, label]) => b(label, 'navigate', `data-page="${page}" ${group === page ? 'aria-current="page"' : ''}`, 'nav ' + (group === page ? 'selected' : ''))).join('')}</nav><div class="sidebar-footer">${b('Log Out', 'logout', '', 'primary sidebar-logout')}</div></aside><main id="content"><header class="top"><div><h1>${titles[state.page] || 'Overview'}</h1></div><div class="teacher-header-actions"><div class="teacher-header-account">${state.page === 'profile' ? b('Log Out', 'logout', '', 'primary profile-header-logout') : ''}</div></div></header><p id="global-feedback" role="status" aria-live="polite"></p><div id="view">${(views[state.page] || dashboard)()}</div></main></div>`;
    if (state.page === 'attendance') FacultyRecords.mountList(myClasses());
    if (state.page === 'attendanceDetail') FacultyRecords.mount(state.classId, state.sessionId);
    else FacultyRecords.unmount();
    ClassenceRealtime.mount();UI.reveal([me.id,state.page,state.classId,state.sessionId].join(':'));
  } catch (error) { if(background&&root.querySelector(".app")){UI.message(error.message,true);return;}root.innerHTML = `<div class="auth"><h1>Workspace Unavailable</h1><p>${e(error.message)}</p></div>`; }
}
FacultyRegistration.bind(root, state, render);
root.addEventListener('submit', async event => {
  if (event.target.dataset.form !== 'class') return;
  event.preventDefault();
  const submit = event.target.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(event.target));
    const user=await FacultyAPI.restore();
    if(!user||user.id!==me?.id){render();return;}
    const result = await FacultyAPI.request('/api/auth/live/classes', {method:'POST', body:JSON.stringify(values)});
    await ClassenceRealtime.refresh();
    navigate('details', result.data.classId); UI.message('Class created');
  } catch (error) { if(!FacultyAPI.current)render();UI.message(error.message, true); } finally { submit.disabled = false; }
});
root.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  try {
    const action = el.dataset.action;
    if(!['auth-mode','logout'].includes(action)){const user=await FacultyAPI.restore();if(!user){render();return;}if(user.id!==me?.id){state.page='dashboard';state.classId='';state.sessionId='';render();return;}}
    if(action==='edit-profile') openProfileDialog(el);
    else if (action === 'navigate') { profileEditing=false; if (el.dataset.page === 'edit') { window.FacultyRecords.open('edit', el.dataset.class); return; } state.sessionId = el.dataset.session || ''; navigate(el.dataset.page, el.dataset.class, el.dataset.session); }
    else if (action === 'auth-mode') { if (FacultyRegistration.busy) return; state.authMode = el.dataset.mode; render(); }
    else if (action === 'logout') { let message='Logged out.',failed=false;try{await FacultyAPI.logout();}catch(error){message=error.status===401?'You are signed out; this session is no longer valid.':'Signed out here. Server revocation could not be confirmed. Reconnect to complete logout; the server session remains bounded by its expiry.';failed=error.status!==401;}state.page='dashboard';state.authMode='login';render();UI.message(message,failed); }
    else if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(el.dataset.code);
        copiedClassCode = el.dataset.code;
        copiedUntil = Date.now() + 2000;
        const label = 'Copy class code';
        el.dataset.copyLabel = label;
        clearTimeout(copyFeedbackTimer);
        const originalMinWidth = el.dataset.copyMinWidth ?? el.style.minWidth;
        el.dataset.copyMinWidth = originalMinWidth;
        el.style.minWidth = el.getBoundingClientRect().width + 'px';
        el.setAttribute('aria-live', 'polite');
        el.textContent = 'Copied';
        copyFeedbackTimer = setTimeout(() => {
          copiedUntil = 0;
          const current = root.querySelector('[data-action="copy"]');
          if (current && current.dataset.code === copiedClassCode) current.textContent = label;
          el.textContent = label;
          el.style.minWidth = originalMinWidth;
          delete el.dataset.copyLabel;
          delete el.dataset.copyMinWidth;
        }, 2000);
      }
      catch { UI.message('Copy this class code: ' + el.dataset.code); }
    }
    else if (action === 'start') { const result = await ClassenceRealtime.command('faculty:start-session', {classId:el.dataset.class}); await ClassenceRealtime.refresh(); navigate('monitor', el.dataset.class, result.sessionId); UI.message('Session started.'); }
  } catch (error) { if(!FacultyAPI.current){state.authMode='login';render();}UI.message(error.message, true); }
});
root.addEventListener('input', event => {
  if (!event.target.dataset.filter || event.target.tagName === 'SELECT') return;
  state[event.target.dataset.filter] = event.target.value;
  render(true);
});
window.addEventListener('faculty-data-updated', () => { if (!FacultyRegistration.busy && !root.querySelector('[data-form=class]')) render(true); });
window.addEventListener('faculty-session-ended',event=>{me=null;state.page='dashboard';state.authMode='login';render();if(event.detail?.expired)UI.message('Your session has expired or was revoked. Please sign in again.');});
render();
FacultyAPI.restore().then(()=>{restoreNavigation();render();}).catch(error=>{restoreNavigation();render();UI.message(error.message,true);});
setInterval(()=>{if(FacultyAPI.current&&!FacultyRegistration.busy)FacultyAPI.restore().then(()=>render(true)).catch(error=>{if(!FacultyAPI.current)render();else UI.message(error.message,true);});},30000);

function teacherAuth(mode) {
  if (['register', 'registration-success'].includes(mode)) return FacultyRegistration.render(mode);
  const { field, feedback, button } = UI;
  return `<div class="teacher-login"><div class="teacher-login-image"><img src="assets/images/landing-bg.jpg" alt="Campus overlooking the river and city skyline"></div><section class="teacher-login-form" aria-labelledby="login-heading"><div class="teacher-login-fields"><div class="brand">Classence<small>Online Student Activity Monitoring</small></div><h1 id="login-heading">Faculty Login</h1><form data-form="login">${field('email', 'Email address', 'email', '', 'required maxlength="254" autocomplete="username"')}${field('password', 'Password', 'password', '', 'required minlength="6" autocomplete="current-password"')}<label class="check"><input type="checkbox" data-show-password> Show password</label>${feedback}<button class="full" type="submit">Log in</button></form><p class="auth-switch">New here? ${button('Create account', 'auth-mode', 'data-mode="register"', 'link')}</p></div></section></div>`;
}

window.addEventListener("faculty-realtime-auth-check",()=>render());

window.addEventListener('faculty-attendance-session-selected', event => {
  if (state.page !== 'attendanceDetail') return;
  state.sessionId = event.detail.sessionId;
  saveNavigation();
});
