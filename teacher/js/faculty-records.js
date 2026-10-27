(() => {
  'use strict';
  const e = UI.escape;
  const dialog = document.createElement('dialog');
  dialog.id = 'faculty-records-dialog';
  dialog.setAttribute('aria-labelledby', 'records-title');
  document.body.appendChild(dialog);
  let record = null, klass = null, history = [], owner = null, epoch = 0, busy = false;
  let mode = null, host = null, correctionEditing = false;
  const api = (path, method, body) => FacultyAPI.request('/api/auth/live/' + path, {
    ...(method ? { method } : {}), ...(body ? { body: JSON.stringify(body) } : {})
  }).then(result => result.data);
  const surface = () => mode === 'attendance' ? host : dialog;
  const valid = token => token === epoch && owner === FacultyAPI.current?.id &&
    (mode !== 'attendance' || host?.isConnected);
  const feedback = message => {
    const node = surface()?.querySelector('[data-records-feedback]');
    if (node) node.textContent = message;
  };
  const dirty = () => !!record && [...(surface()?.querySelectorAll('[data-attendance-student]') || [])]
    .some(select => select.value !== record.rows.find(row => row.studentId === select.dataset.attendanceStudent)?.status);
  const back = '<button type="button" class="secondary back-to-attendance motion-action" data-records-close>\u2190 Attendance Records</button>';

  function editView() {
    dialog.innerHTML = `<h2 id="records-title">Edit Database-backed Class</h2><form data-records-form="class"><label for="records-name">Class name</label><input id="records-name" name="name" value="${UI.text(klass.name)}" required maxlength="160"><label for="records-section">Section</label><input id="records-section" name="section" value="${e(klass.section)}" required maxlength="80"><label for="records-meet">Google Meet link</label><input id="records-meet" name="meet" value="${e(klass.meet)}" type="url" required maxlength="2048"><p class="muted small">Class code ${e(klass.code)} and enrollments are preserved. End any live session before changing its Meet link.</p><div class="toolbar"><button type="button" class="secondary" data-records-close>Cancel</button><button type="submit" class="primary">Save Class</button></div></form><p data-records-feedback role="status" aria-live="polite"></p>`;
  }

  let historyOwner = null, listRows = [], listClasses = [], listAt = 0, listFlight = null, listError = '', listFilter = '', listKey = '';
  const readCache = new Map();
  function readSnapshot(sessionId) {
    const identity = FacultyAPI.current?.id;
    const key = identity + ':' + sessionId;
    let entry = readCache.get(key);
    if (!identity || !sessionId) return null;
    if (!entry) { entry = { data: null, at: 0, pending: null }; readCache.set(key, entry); }
    if (!entry.pending && Date.now() - entry.at > 20000) {
      entry.at = Date.now();
      entry.pending = api('sessions/' + sessionId + '/attendance').then(next => {
        if (identity !== FacultyAPI.current?.id) return;
        entry.data = next;
      }).catch(() => { entry.data = null; }).finally(() => {
        entry.pending = null;
        if (identity === FacultyAPI.current?.id) window.ClassenceRealtime?.mount();
      });
    }
    return entry.data;
  }
  function attendanceReviewState(session) {
    if (session.attendanceCount == null || session.finalizedCount == null) return '';
    const total = Number(session.attendanceCount), finalized = Number(session.finalizedCount);
    const missing = Math.max(0, Number(session.eligibleCount || 0) - total);
    const unclassified = Number(session.unclassifiedCount || 0);
    const state = (total > 0 && finalized === total) || session.automaticFinalized ? 'Finalized' : 'Open for Faculty review';
    return `<br><small class="muted">${e(state)}${unclassified ? ' &middot; ' + e(unclassified) + ' unclassified' : ''}${missing ? ' &middot; ' + e(missing) + ' awaiting attendance records' : ''}${!total && !missing ? ' &middot; No attendance records' : ''}</small>`;
  }
  function listView() {
    const target = document.querySelector('[data-attendance-list]');
    if (!target) return;
    const done = listRows.filter(session => session.status === 'Completed' && (!listFilter || session.classId === listFilter));
    UI.patchHTML(target, `<section class="panel"><div class="toolbar"><label class="control">Class<select id="classFilter" data-records-filter><option value="">All my classes</option>${listClasses.map(c => `<option value="${e(c.id)}" ${listFilter === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></label></div>${UI.table(['Class','Date','Time','Present','Late','Absent',''],done.map(session => [e(session.className) + attendanceReviewState(session),UI.date(session.startedAt),UI.timeRange(session.startedAt,session.endedAt),UI.text(session.presentCount),UI.text(session.lateCount),UI.text(session.absentCount),`<button type="button" class="secondary" data-faculty-records="attendance" data-class-id="${e(session.classId)}" data-session-id="${e(session.id)}">View summary</button>`]),listFlight?'Loading attendance records...':'No attendance records available.',done.map(session=>session.id))}<p role="status" data-records-list-feedback>${e(listError)}</p></section>`, true);
  }
  function mountList(classes) {
    const identity = FacultyAPI.current?.id;
    if (!identity) return;
    if (historyOwner !== identity) { historyOwner = identity; listRows = []; listClasses = []; listAt = 0; listFlight = null; listFilter = ''; }
    listClasses = classes;
    const key = listClasses.map(c => c.id).join(',');
    if (!listFlight && (key !== listKey || Date.now() - listAt > 20000 || listRows.some(s => !listClasses.some(c => c.id === s.classId)))) {
      listAt = Date.now(); listKey = key; listError = '';
      const job = Promise.all(listClasses.map(c => api('classes/' + c.id + '/sessions').then(rows => rows.map(session => ({...session,classId:c.id,className:c.name})))));
      listFlight = job;
      job.then(groups => { if (identity === FacultyAPI.current?.id && key === listClasses.map(c => c.id).join(',')) listRows = groups.flat().sort((a,b) => Date.parse(b.startedAt)-Date.parse(a.startedAt)); })
        .catch(error => { if (identity === FacultyAPI.current?.id) listError = error.message; })
        .finally(() => { if (listFlight === job) listFlight = null; if (identity === FacultyAPI.current?.id) listView(); });
    }
    listView();
  }
  const activityBadge = value => { const display = UI.meetActivity(value); return display==='On Another Tab'?'<span class="badge inactive">On Another Tab</span>':UI.badge(display); };
  function studentRows() {
    return record.rows.map(row => [UI.text(row.name)+'<br><small>Meet activity: '+activityBadge(window.ClassenceRealtime?.activityFor(record.sessionId,row.studentId)||'Not Monitoring')+'</small>',!(record.correctionOpen && correctionEditing) ? `<span data-attendance-status="${e(row.studentId)}">${UI.badge(row.status)}</span>` : `<select aria-label="Attendance for ${e(row.name)}" data-attendance-student="${e(row.studentId)}">${['Present','Late','Absent','Not Joined'].map(status=>`<option ${row.status===status?'selected':''} ${status==='Absent'&&record.status!=='Completed'?'disabled':''}>${status}</option>`).join('')}</select>`,UI.time(row.firstJoinedAt),UI.time(row.lastLeftAt),row.connectedMs == null ? UI.text(null) : Math.floor(Number(row.connectedMs)/60000)+' min',row.tabSwitches == null ? 'N/A' : UI.text(row.tabSwitches)]);
  }
  function attendanceView() {
    if (!host?.isConnected) return;
    host.classList.add('historical-attendance');
    if (!record) { host.innerHTML = `${back}<section class="panel empty"><h2>Summary unavailable</h2><p>No sessions for this class yet.</p></section>`; return; }
    const totals = ['Present','Late','Absent'].map(status=>`<div class="card"><small>${status}</small><div class="metric">${record.rows.filter(row=>row.status===status).length}</div></div>`).join('');
    UI.patchHTML(host, `${back}<div class="attendance-summary"><div class="grid metrics">${totals}</div></div><section class="panel"><h2>${UI.text(klass.name)}</h2><p class="muted">${e(UI.date(record.startedAt))} &middot; ${e(UI.timeRange(record.startedAt,record.endedAt))} &middot; ${record.finalized?'Finalized':record.automatic&&!record.correctionOpen?'Automatic attendance':'Open for Faculty review'}</p><form data-records-form="attendance">${UI.table(['Student name','Attendance','First join','Last leave','Connected time','Tab switches'],studentRows(),'No eligible Students for this session.',record.rows.map(row=>row.studentId))}${!(record.correctionOpen&&correctionEditing)?'':`<div class="toolbar attendance-actions"><button type="submit" class="primary" ${!record.rows.length?'disabled':''}>Save Attendance</button><button type="button" class="primary" data-records-finalize ${record.status!=='Completed'||!record.rows.length?'disabled':''}>Finalize Attendance</button></div>`}</form></section><div class="toolbar"><button type="button" class="secondary" data-action="navigate" data-page="logs" data-class="${e(klass.id)}" data-session="${e(record.sessionId)}">Review session logs</button></div><p data-records-feedback role="status" aria-live="polite"></p>`);
  }

  async function refreshAutomatic() {
    if(mode!=='attendance'||!record||record.correctionOpen||busy||!host?.isConnected)return;
    const token=epoch;busy=true;
    try{const next=await api('sessions/'+record.sessionId+'/attendance');if(valid(token)){record=next;attendanceView();}}
    catch(error){if(valid(token))feedback(error.message);}
    finally{if(token===epoch)busy=false;}
  }
  async function load(sessionId) {
    const token = epoch;
    busy = true;
    try {
      const next = await api('sessions/' + sessionId + '/attendance');
      if (!valid(token)) return;
      record = next;
      host.dataset.sessionId = next.sessionId;
      window.dispatchEvent(new CustomEvent('faculty-attendance-session-selected', { detail: { sessionId: next.sessionId } }));
      attendanceView();
    } finally { if (token === epoch) busy = false; }
  }

  async function mount(classId, sessionId) {
    host = document.querySelector('[data-attendance-page]');
    if (!host) return;
    const token = ++epoch;
    owner = FacultyAPI.current?.id;
    if (!owner) return;
    mode = 'attendance'; busy = true; record = klass = null; history = []; correctionEditing = false;
    host.dataset.classId = classId;
    host.dataset.sessionId = sessionId || '';
    host.innerHTML = `${back}<section class="panel"><p role="status">Loading attendance...</p></section>`;
    try {
      const nextClass = await api('classes/' + classId);
      if (!valid(token)) return;
      const nextHistory = await api('classes/' + classId + '/sessions');
      if (!valid(token)) return;
      klass = nextClass; history = nextHistory;
      if (history.length) await load(history.find(session => session.id === sessionId)?.id || history[0].id);
      else attendanceView();
    } catch (error) {
      if (valid(token)) host.innerHTML = `${back}<section class="panel"><h2>Attendance unavailable</h2><p role="alert">${e(error.message)}</p><button type="button" class="secondary" data-records-retry>Try again</button></section>`;
    } finally { if (token === epoch) busy = false; }
  }

  async function open(action, classId, sessionId) {
    if (action === 'attendance') { window.showAttendance(classId, sessionId); return; }
    if (busy) return;
    owner = FacultyAPI.current?.id;
    if (!owner) return;
    const token = ++epoch;
    mode = 'class'; busy = true; record = null;
    dialog.innerHTML = '<h2 id="records-title">Loading Database-backed Records</h2><p role="status">Loading...</p><button type="button" class="secondary" data-records-close>Cancel</button><p data-records-feedback role="status" aria-live="polite"></p>';
    dialog.showModal();
    try { const next = await api('classes/' + classId); if (valid(token)) { klass = next; editView(); } }
    catch (error) { if (valid(token)) feedback(error.message); }
    finally { if (token === epoch) busy = false; }
  }

  async function change(action, values = {}) {
    if (busy) return;
    busy = true;
    const token = epoch;
    const controls = [...surface().querySelectorAll('button,input,select')].map(node => ({ node, disabled: node.disabled }));
    controls.forEach(({ node }) => { node.disabled = true; });
    try {
      if (action === 'class') {
        const next = await api('classes/' + klass.id, 'PATCH', { ...values, version: klass.version });
        if (!valid(token)) return;
        klass = next; UI.closeDialog(dialog); window.ClassenceRealtime?.refresh(); UI.message('Class updated');
      } else {
        if (action === 'finalize' && dirty()) throw Error('Save attendance changes before finalizing.');
        const next = await api('sessions/' + record.sessionId + '/attendance' + (action === 'save' ? '' : '/' + action), action === 'save' ? 'PATCH' : 'POST', { ...values, version: record.version });
        if (!valid(token)) return;
        record = next; correctionEditing = action === 'reopen' || correctionEditing && !!next.correctionOpen; listAt = 0; readCache.delete(owner + ':' + record.sessionId); attendanceView();
        feedback(action === 'save' ? 'Attendance saved' : action === 'finalize' ? 'Attendance finalized' : 'Attendance reopened. Save corrections, then finalize again.');
      }
    } catch (error) { if (valid(token)) feedback(error.message); }
    finally { if (token === epoch) busy = false; controls.forEach(({ node, disabled }) => { if (node.isConnected) node.disabled = disabled; }); }
  }

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!form.matches('[data-records-form]')) return;
    event.preventDefault();
    if (form.dataset.recordsForm === 'class') change('class', Object.fromEntries(new FormData(form)));
    else if (form.dataset.recordsForm === 'reopen') change('reopen', Object.fromEntries(new FormData(form)));
    else change('save', { changes: [...form.querySelectorAll('[data-attendance-student]')].map(select => ({ studentId: select.dataset.attendanceStudent, status: select.value })) });
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.matches('[data-faculty-records]')) { event.preventDefault(); open(button.dataset.facultyRecords, button.dataset.classId, button.dataset.sessionId); }
    if (button.matches('[data-records-close]')) {
      const close = () => { if (mode === 'attendance') window.navigate('attendance'); else { epoch++; busy = false; UI.closeDialog(dialog); } };
      if (mode === 'attendance' && dirty()) UI.confirmAction('Discard unsaved attendance?', 'Return to Attendance Records without saving these changes?', close);
      else close();
    }
    if (button.matches('[data-records-retry]')) mount(host.dataset.classId, host.dataset.sessionId);
    if (button.matches('[data-records-reload]') && !busy) {
      const reload = () => load(record.sessionId).catch(error => feedback(error.message));
      if (dirty()) UI.confirmAction('Discard unsaved attendance?', 'Reload the saved attendance records?', reload);
      else reload();
    }
    if (button.matches('[data-records-finalize]')) change('finalize');
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-records-filter]')) { listFilter = event.target.value; listView(); return; }

  });
  dialog.addEventListener('cancel', () => { epoch++; busy = false; });
  function unmount() {
    if (mode !== 'attendance') return;
    epoch++; busy = false; mode = null; host = null; record = klass = null; history = []; correctionEditing = false;
  }
  window.addEventListener('faculty-session-ended', () => { epoch++; busy = false; dialog.close(); dialog.innerHTML = ''; record = klass = null; history = []; correctionEditing = false; owner = null; mode = null; host = null; });
  window.FacultyRecords = {
    open, mount, unmount, mountList, readSnapshot, refreshAutomatic, invalidateRead: sessionId => { if(sessionId)readCache.delete(FacultyAPI.current?.id+':'+sessionId);listAt=0; },
    isMounted: (classId, sessionId) => mode === 'attendance' && host?.isConnected && owner === FacultyAPI.current?.id && host.dataset.classId === classId && host.dataset.sessionId === (sessionId || '')
  };
})();
