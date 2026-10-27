
'use strict';
const { escape: e, text: d, badge, button: b, field } = UI;
const root = document.getElementById('app');
const state = { authMode: 'login', page: 'home', classId: '', query: '' };
let db, me;
let authBusy=false;
const studentProfileDialog=document.getElementById('student-profile-dialog');
let studentProfileTrigger=null;
const studentNavigationKey = 'classence-student-navigation';
function saveStudentNavigation() {
  try {
    const saved = me ? { email: me.email, page: state.page, classId: state.classId } : { authMode: state.authMode };
    sessionStorage.setItem(studentNavigationKey, JSON.stringify(saved));
  } catch {                                                                  }
}
function restoreStudentNavigation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(studentNavigationKey));
    const user = StudentAPI.current;
    if (!saved) return;
    if (!user) { if (['login', 'register'].includes(saved.authMode)) state.authMode = saved.authMode; return; }
    if (saved.email !== user.email || !['home', 'classes', 'enroll', 'session', 'profile'].includes(saved.page)) return;
    state.page = saved.page;
    state.classId = saved.classId || '';
  } catch {                                                                         }
}

const nav = (label, page, attrs = '', style = 'secondary') => b(label, 'navigate', `data-page="${page}" ${attrs}`, style);
const enrolled = () => db.classes.filter(c => c.students.includes(me.email));
const liveFor = classId => db.sessions.find(s => s.classId === classId && !s.end);
function home() {
  return `<h1>Hello, ${d(String(me.name ?? '').trim().split(/\s+/)[0])}</h1><p class="muted" data-animate>Your classes and monitoring sessions at a glance.</p><h2 data-animate>Current Session</h2><div id="real-realtime" data-student-home></div>`;
}
function classesView() {
  const classes = enrolled();
  const items = classes.filter(c => (c.name + ' ' + c.section).toLowerCase().includes(state.query.toLowerCase()));
  return `<h1>My Classes</h1>${nav('+ Enroll in a class', 'enroll', 'data-animate', 'primary full')}<input id="search" class="search-input" aria-label="Search classes" type="search" data-search data-animate value="${e(state.query)}" placeholder="Search classes"><div class="stack class-list"><p class="muted enrolled-count">${classes.length} enrolled ${classes.length === 1 ? 'class' : 'classes'}</p>${items.length ? items.map(c => `<section class="card"><div class="eyebrow">${d(c.section)}</div><h2>${d(c.name)}</h2><p class="muted">${d(c.teacher)}</p><div class="flex">${badge(liveFor(c.id) ? 'Live' : 'No Active Session')}${nav('View class', 'session', `data-class="${c.id}"`)}</div></section>`).join('') : `<div class="empty"><h2>${classes.length ? 'No matching classes' : 'Your classes will appear here'}</h2><p>${classes.length ? 'Try another class name or section.' : 'Enter the enrollment code shared by your teacher.'}</p></div>`}</div>`;
}
function enrollment() {
  return `${nav('\u2190 My Classes', 'classes', '', 'secondary back-navigation')}<h1>Enroll in a Class</h1><form data-form="enroll">${field('code', 'Class code', 'text', '', 'required maxlength="30" placeholder="CL-A3F902" autocomplete="off"')}${UI.feedback}<button type="submit" class="full">Enroll</button></form><div class="notice">The class code is separate from the Google Meet code. Enrollment does not mark you present.</div>`;
}
function sessionView() {
  if (!ClassenceRealtime.data) return '<p role="status">Loading class...</p>';
  const c = enrolled().find(c => c.id === state.classId);
  if (!c) return `<h1>Class Unavailable</h1><p>You can view only classes you are enrolled in.</p>${nav('My Classes', 'classes')}`;
  const live=liveFor(c.id),joined=live?.participants?.some(participant=>participant.participation==='Joined');
  return `${nav('\u2190 My Classes', 'classes', '', 'secondary back-navigation')}<div class="eyebrow class-section">${d(c.section)}</div><h1>${d(c.name)}</h1><p class="muted">${d(c.teacher)}</p><div id="real-realtime" data-student-class="${e(c.id)}"></div>${joined?'':`<a class="button-link secondary full" href="${e(c.meet)}" target="_blank" rel="noopener noreferrer">Open registered Google Meet</a>`}${b('Unenroll from Class', 'unenroll', `data-class="${e(c.id)}"`, 'secondary full unenroll-button')}`;
}
function profile() {
  const initials = String(me.name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  const information = [['Student ID', me.studentId], ['Full Name', me.name], ['Program', me.program], ['Year Level', me.yearLevel], ['Section', me.section], ['Institutional Email Address', me.email], ['Account Role', 'Student']];
  const active = db.sessions.filter(session => !session.end);
  const metrics = [['My Classes', enrolled().length], ['Active Sessions', active.length], ['Joined Sessions', active.filter(session => session.participants.some(p=>p.participation==='Joined')).length]];
  return `<h1>My Profile</h1><section class="card student-profile"><div class="profile-heading"><div class="profile-avatar" aria-hidden="true">${d(initials)}</div><div><h2>${d(me.name)}</h2>${me.studentId ? `<small>${e(me.studentId)}</small>` : ''}</div></div><h3>Student Information</h3><dl class="profile-details">${information.map(([label, value]) => `<div><dt>${e(label)}:</dt><dd>${d(value)}</dd></div>`).join('')}</dl>${b('Edit Profile', 'edit-profile', '', 'secondary full student-profile-edit')}</section><section class="card student-privacy-settings"><h2>Privacy Settings</h2><p class="muted small">Google Meet-only monitoring is enabled only after your agreement and stops when you leave, log out, or the session ends.</p>${b('Withdraw Monitoring Consent', 'withdraw-monitoring', '', 'secondary full')}</section><section class="card student-profile profile-overview"><h2>Student Overview</h2><dl class="profile-stats">${metrics.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${d(value)}</dd></div>`).join('')}</dl></section>${b('Log out', 'logout', '', 'primary full')}`;
}
function openStudentProfileDialog(trigger) {
  if (!me || studentProfileDialog.open) return;
  studentProfileTrigger=trigger;
  const required=(forId,label)=>`<label for="${forId}">${label}<span class="required-mark" aria-hidden="true"> *</span></label>`;
  studentProfileDialog.innerHTML=`<h2 id="student-profile-title">Edit Student Profile</h2><form data-form="student-profile" data-owner="${e(me.id)}">${required('student-profile-name','Full Name')}<input id="student-profile-name" name="fullName" type="text" value="${e(me.name)}" required maxlength="160" autocomplete="name">${required('student-profile-email','Institutional Email Address')}<input id="student-profile-email" name="email" type="email" value="${e(me.email)}" required maxlength="254" autocomplete="email">${required('student-profile-program','Program')}<input id="student-profile-program" name="program" type="text" value="${e(me.program)}" required maxlength="160">${required('student-profile-year-level','Year Level')}<select id="student-profile-year-level" name="yearLevel" required>${CW.yearLevels.map(year=>`<option value="${year}" ${String(me.yearLevel)===year?'selected':''}>Year ${year}</option>`).join('')}</select>${required('student-profile-section','Section')}<input id="student-profile-section" name="section" type="text" value="${e(me.section)}" required maxlength="80"><p data-profile-feedback role="status" aria-live="polite"></p><div class="toolbar"><button type="button" class="secondary" data-student-profile-close>Cancel</button><button type="submit" class="primary">Save Profile</button></div></form>`;
  studentProfileDialog.showModal();
  studentProfileDialog.querySelector('#student-profile-name')?.focus({preventScroll:true});
}
function closeStudentProfileDialog() {
  if (!studentProfileDialog.open || studentProfileDialog.dataset.saving) return;
  UI.closeDialog(studentProfileDialog);
}
studentProfileDialog.addEventListener('cancel',event=>{if(studentProfileDialog.dataset.saving)event.preventDefault();});
studentProfileDialog.addEventListener('click',event=>{if(event.target===studentProfileDialog)closeStudentProfileDialog();if(event.target.closest('[data-student-profile-close]'))closeStudentProfileDialog();});
studentProfileDialog.addEventListener('close',()=>{delete studentProfileDialog.dataset.saving;studentProfileDialog.innerHTML='';studentProfileTrigger?.focus({preventScroll:true});studentProfileTrigger=null;});
studentProfileDialog.addEventListener('submit',async event=>{
  if(event.target.dataset.form!=='student-profile')return;
  event.preventDefault();
  const form=event.target,feedback=form.querySelector('[data-profile-feedback]'),submit=form.querySelector('[type=submit]');
  if(submit.disabled||!form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));
  for(const key of ['fullName','email','program','section'])values[key]=String(values[key]||'').trim();
  if(!/^\S+@\S+\.\S+$/.test(values.email)){feedback.className='error';feedback.textContent='Enter a valid institutional email address.';form.elements.email.focus();return;}
  submit.disabled=true;studentProfileDialog.dataset.saving='true';
  try{
    await StudentAPI.updateProfile(values,form.dataset.owner);
    await ClassenceRealtime.refresh().catch(()=>{});
    delete studentProfileDialog.dataset.saving;
    closeStudentProfileDialog();
    render();
    UI.message('Profile updated');
  }catch(error){
    if(!StudentAPI.current){closeStudentProfileDialog();render();UI.message(error.message,true);}
    else{feedback.className='error';feedback.textContent=error.message;}
  }finally{delete studentProfileDialog.dataset.saving;submit.disabled=false;}
});
function studentAuth(mode) {
  const registration = mode === 'register';
  const authField = (name, label, type, attrs) => `${field(name, label, type, '', `${attrs} aria-describedby="${name}-error"`)}<p id="${name}-error" class="auth-field-error" hidden></p>`;
  const academicFields = registration ? authField('studentId', 'Student ID', 'text', 'required maxlength="80" autocomplete="off"') + authField('name', 'Full name', 'text', 'required maxlength="80" autocomplete="name"') + authField('program', 'Program / Course', 'text', 'required maxlength="120"') + `<label for="yearLevel">Year Level<span class="required-mark" aria-hidden="true"> *</span></label><select id="yearLevel" name="yearLevel" required aria-describedby="yearLevel-error"><option value="">Select year level</option>${CW.yearLevels.map(year => `<option value="${year}">Year ${year}</option>`).join('')}</select><p id="yearLevel-error" class="auth-field-error" hidden></p>` + authField('section', 'Section', 'text', 'required maxlength="80"') : '';
  return `<div class="auth student-auth">${UI.brand}<h1>${registration ? 'Create Student Account' : 'Student Login'}</h1>${registration ? '<p class="auth-intro">Enter your information to get started.</p>' : ''}<form data-form="${registration ? 'register' : 'login'}" novalidate>${academicFields}${authField('email', registration ? 'Institutional Email Address' : 'Email address', 'email', 'required maxlength="254" autocomplete="username"')}${authField('password', 'Password', 'password', `required minlength="${registration ? 8 : 6}" autocomplete="${registration ? 'new-password' : 'current-password'}"`)}${registration ? authField('confirm', 'Confirm password', 'password', 'required minlength="8" autocomplete="new-password"') : ''}<label class="check"><input type="checkbox" data-show-password> Show password</label>${registration ? '<label class="check" for="agreement"><input id="agreement" name="agreement" type="checkbox" required aria-describedby="agreement-error">I agree to the Terms of Use and Privacy Notice.</label><p id="agreement-error" class="auth-field-error" hidden></p><label class="check" for="monitoringAgreement"><input id="monitoringAgreement" name="monitoringAgreement" type="checkbox" required aria-describedby="monitoringAgreement-error">I agree to Google Meet-only monitoring for eligible live sessions. I can withdraw this in Privacy Settings at any time.</label><p id="monitoringAgreement-error" class="auth-field-error" hidden></p>' : ''}${UI.feedback}<button type="submit" class="primary full">${registration ? 'Create Account' : 'Log in'}</button></form><p class="auth-switch">${registration ? 'Already have an account?' : 'New here?'} ${b(registration ? 'Log in' : 'Create account', 'auth-mode', `data-mode="${registration ? 'login' : 'register'}"`, 'link')}</p></div>`;
}
function bindStudentAuth() {
  root.addEventListener('change', event => {
    if (event.target.matches('[data-show-password]')) root.querySelectorAll('[name="password"], [name="confirm"]').forEach(input => { input.type = event.target.checked ? 'text' : 'password'; });
  });
  root.addEventListener('submit', async event => {
    const form = event.target, registration = form.dataset.form === 'register';
    if (!['login', 'register'].includes(form.dataset.form)) return;
    event.preventDefault();
    if(authBusy)return;
    const values = Object.fromEntries(new FormData(form));
    values.email = String(values.email || '').trim(); form.elements.email.value = values.email;
    if (registration) for (const key of ['studentId', 'name', 'program', 'yearLevel', 'section']) { values[key] = String(values[key] || '').trim(); form.elements.namedItem(key).value = values[key]; }
    const errors = {};
    if (registration && !values.studentId) errors.studentId = 'Please enter your Student ID.';
    if (registration && !values.name) errors.name = 'Please enter your full name.';
    if (registration && !values.program) errors.program = 'Please enter your program or course.';
    if (registration && !CW.yearLevels.includes(values.yearLevel)) errors.yearLevel = 'Select a valid year level.';
    if (registration && !values.section) errors.section = 'Please enter your section.';
    if (!/^\S+@\S+\.\S+$/.test(values.email) || form.elements.email.validity.typeMismatch) errors.email = 'Enter a valid email address.';
    const minimum = registration ? 8 : 6;
    if (!values.password || !values.password.trim() || values.password.length < minimum) errors.password = `Password must contain at least ${minimum} characters.`;
    if (registration && (!values.confirm || values.password !== values.confirm)) errors.confirm = 'Passwords do not match.';
    if(registration&&values.agreement!=='on')errors.agreement='Please accept the Terms of Use and Privacy Notice.';
    if(registration&&values.monitoringAgreement!=='on')errors.monitoringAgreement='Explicit Google Meet-only monitoring agreement is required.';
    form.querySelectorAll('.auth-field-error').forEach(node => { node.hidden = true; node.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
    const feedback = form.querySelector('#feedback'); feedback.textContent = '';
    const showErrors = messages => {
      for (const [name, text] of Object.entries(messages)) {
        const input = form.elements.namedItem(name), node = form.querySelector('#' + name + '-error');
        input.setAttribute('aria-invalid', 'true'); node.textContent = text; node.hidden = false;
      }
      form.elements.namedItem(Object.keys(messages)[0])?.focus();
    };
    if (Object.keys(errors).length) { showErrors(errors); return; }
    const submit = form.querySelector('[type="submit"]');
    authBusy=true;submit.disabled = true;const label=submit.textContent;submit.textContent=registration?'Creating Account...':'Logging in...';
    try {
      if (registration) { await StudentAPI.register(values); await window.StudentMonitoring?.enable(values.email); } else await StudentAPI.login(values.email, values.password);
      state.authMode = 'login'; state.page = 'home'; state.classId = ''; state.query = ''; render();if(registration)UI.message('Student account created. Please log in.');
    } catch (error) {
      if (registration && error.errors) showErrors(Object.fromEntries(Object.entries(error.errors).map(([key,value])=>[key==='fullName'?'name':key,value])));
      else { const visibleFeedback=document.querySelector('#feedback')||feedback;visibleFeedback.className = 'error';visibleFeedback.textContent = error.message;document.querySelector('#password')?.focus(); }
    } finally { authBusy=false;submit.disabled = false;submit.textContent=label; }
  });
}
function render(background = false) {
  if (!background) root.classList.remove('quiet-update');
  try {
    const sameOwner = StudentAPI.current?.id === me?.id;
    me=StudentAPI.current;
    ClassenceRealtime.ensure();
    const data=ClassenceRealtime.data;
    if (background && sameOwner && me && !data && root.querySelector('#view')) { ClassenceRealtime.mount(); return; }
    db={classes:[],sessions:[]};
    for(const c of data?.classes || []){
      db.classes.push({...c,teacher:c.facultyName,students:[me?.email]});
      for(const session of c.sessions)db.sessions.push({...session,classId:c.id,start:Date.parse(session.startedAt),end:session.endedAt?Date.parse(session.endedAt):null});
    }
    if(!StudentAPI.checking)saveStudentNavigation();
    if(StudentAPI.checking&&!me){root.innerHTML=`<main class="popup">${UI.brand}<p role="status">Restoring your session...</p></main>`;return;}
    if (!me) { root.innerHTML = `<main class="popup">${studentAuth(state.authMode)}<button type="button" class="secondary button-small privacy-public-button" data-privacy-public>Read Student Privacy Notice</button></main>`; UI.reveal('auth:' + state.authMode); return; }
    const views = { home, classes: classesView, enroll: enrollment, session: sessionView, profile };
    if (background && sameOwner && root.querySelector('#view')) {
      if (state.page !== 'enroll') UI.patchHTML(root.querySelector('#view'), (views[state.page] || home)());
      ClassenceRealtime.mount(); return;
    }
    root.innerHTML = `<main class="popup student-workspace"><div class="student-content"><header class="popup-header">${UI.brand}</header><p id="global-feedback" role="status" aria-live="polite"></p><div id="view">${(views[state.page] || home)()}</div></div><nav class="popup-nav" aria-label="Student navigation">${nav('Home', 'home', state.page === 'home' ? 'aria-current="page"' : '', state.page === 'home' ? 'selected' : 'ghost')}${nav('My Classes', 'classes', ['classes', 'session', 'enroll'].includes(state.page) ? 'aria-current="page"' : '', ['classes', 'session', 'enroll'].includes(state.page) ? 'selected' : 'ghost')}${nav('Profile', 'profile', state.page === 'profile' ? 'aria-current="page"' : '', state.page === 'profile' ? 'selected' : 'ghost')}</nav></main>`;
    ClassenceRealtime.mount();UI.reveal([me.id,state.page,state.classId].join(':'));
  } catch (error) { root.innerHTML = `<main class="popup"><h1>Unable to load your session</h1><p>${e(error.message)}</p></main>`; }
}
bindStudentAuth();
root.addEventListener('submit', async event => {
  if (event.target.dataset.form !== 'enroll') return;
  event.preventDefault();
  try {
    const code = new FormData(event.target).get('code');
    const user=await StudentAPI.restore();
    if(!user||user.id!==me?.id){render();return;}
    const result=await StudentAPI.request('/api/auth/live/enroll',{method:'POST',body:JSON.stringify({code:String(code).trim()})});await ClassenceRealtime.refresh();state.classId=result.data.classId; state.page='session';render(); UI.message('Enrolled successfully. Join when the session is available.');
  } catch (error) { UI.message(error.message, true); }
});
root.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  try {
    const action = el.dataset.action;
    if(action==='auth-mode'&&authBusy)return;
    if(!['auth-mode','logout'].includes(action)){const user=await StudentAPI.restore();if(!user){render();return;}if(user.id!==me?.id){state.page='home';render();return;}}
    if (action === 'navigate') { state.page = el.dataset.page; state.query = ''; if (el.dataset.class) state.classId = el.dataset.class; render(); }
    else if (action === 'edit-profile') openStudentProfileDialog(el);
    else if (action === 'enable-monitoring') { const session=db.sessions.find(item=>String(item.id)===String(el.dataset.sessionId)&&!item.end&&item.participants?.some(participant=>participant.participation==='Joined'));if(!session){UI.message('Join this live class session before enabling monitoring.',true);return;}UI.confirmAction('Enable Google Meet Monitoring?', 'Classence will observe only this class\'s registered Google Meet tab. It does not collect page contents, messages, screenshots, keystrokes, audio, video, browsing history, or unrelated tabs.', async()=>{await window.StudentMonitoring?.enable(me.email);await window.StudentMonitoring?.autoStart(session.id,me.email);await ClassenceRealtime.refresh();UI.message('Google Meet-only monitoring enabled.');}, 'Enable Monitoring'); }
    else if (action === 'withdraw-monitoring') UI.confirmAction('Withdraw Monitoring Consent?', 'This stops current Google Meet-only monitoring and prevents automatic monitoring in future sessions until you provide consent again during setup.', async()=>{await window.StudentMonitoring?.withdraw();UI.message('Monitoring consent withdrawn.');}, 'Withdraw Consent');
    else if (action === 'unenroll') { const classId=el.dataset.class,c=enrolled().find(item=>item.id===classId);if(c?.sessions?.some(session=>session.status==='Live'&&session.participants?.some(participant=>participant.participation==='Joined'))){UI.message('Leave the active session before unenrolling from this class.',true);return;}UI.confirmAction('Unenroll from Class?', 'Are you sure you want to unenroll from this class? You will no longer see this class in My Classes. Your existing attendance and session history will be preserved.', async()=>{let result;try{result=await StudentAPI.request('/api/auth/live/classes/'+encodeURIComponent(classId)+'/enrollment',{method:'DELETE'});}catch(error){if(error.status===404&&error.message==='Route not found')throw new Error('Unenrollment is unavailable until the Classence backend is restarted.');throw error;}await ClassenceRealtime.refresh();state.classId='';state.page='classes';render();UI.message('Unenrolled from class.');return result;},'Confirm Unenroll'); }
    else if (action === 'auth-mode') { state.authMode = el.dataset.mode; render(); }
    else if (action === 'logout') UI.confirmAction('Log out?', 'Your backend sign-in session will be revoked.', async () => {let message='Logged out.',failed=false;try{await StudentAPI.logout();}catch{message='Signed out here. Server revocation could not be confirmed. Reconnect to complete logout; the server session remains bounded by its expiry.';failed=true;}state.page='home';state.authMode='login';render();UI.message(message,failed);});
  } catch (error) { UI.message(error.message, true); }
});
root.addEventListener('input', event => { if (event.target.matches('[data-search]')) { state.query = event.target.value; render(true); } });
window.addEventListener('student-data-updated',()=>{if(!authBusy&&!root.querySelector('[data-form=enroll]'))render(true);});
window.addEventListener('student-session-ended',()=>{me=null;document.querySelector('#confirmation').close();studentProfileDialog.close();state.page='home';state.authMode='login';render();});
const initialRestore=StudentAPI.restore();render();initialRestore.then(()=>{restoreStudentNavigation();render();}).catch(error=>{render();const feedback=document.querySelector('#feedback');if(feedback){feedback.className='error';feedback.textContent=error.message+' Reopen the popup to retry restoring your session.';}});
setInterval(()=>{if(StudentAPI.current&&!authBusy)StudentAPI.restore().then(()=>render(true)).catch(error=>{UI.message(error.message,true);});},30000);

window.addEventListener("student-realtime-auth-check",()=>render(true));
