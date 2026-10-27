
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const missing = '\u2014';
  const display = value => value == null || String(value).trim() === '' || String(value).trim() === '?' ? missing : String(value);
  const text = value => escape(display(value));
  const statusColors = {
    'Online': 'online',
    'Offline': 'offline',
    'Active': 'active',
    'Inactive': 'inactive',
    'Not Monitoring': 'monitoring-off',
    'Session Ended': 'monitoring-off',
    'Unknown': 'unknown',
    'Live': 'live',
    'Completed': 'completed',
    'Not Joined': 'not-joined',
    'Joined': 'joined',
    'Not started': 'not-started',
    'Present': 'present',
    'Late': 'late',
    'Absent': 'absent',
    'Not Detected': 'not-detected',
    'No Active Session': 'no-active-session',
    'Not Connected': 'no-active-session',
    'Left': 'left',
    'Monitoring off': 'monitoring-off',
    'Warning': 'late',
    'Disconnected': 'offline',
    'Error': 'offline'
  };
  const normalizedStatusColors = new Map(Object.entries(statusColors).map(([status, color]) => [status.toLowerCase(), color]));
  const badge = value => `<span class="badge ${normalizedStatusColors.get(String(value ?? '').trim().toLowerCase()) || ''}">${text(value)}</span>`;
  const meetActivity = value => ['Active', 'On Another Tab', 'Inactive', 'Session Ended'].includes(value) ? value : 'Not Monitoring';
  const timestamp = (value, options, kind) => {
    if (display(value) === missing) return missing;
    if (typeof value === 'boolean') return display(value);
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed[kind]('en-US', { ...options, timeZone: 'Asia/Manila' }) : missing;
  };
  const time = value => timestamp(value, { hour: 'numeric', minute: '2-digit', hour12: true }, 'toLocaleTimeString');
  const timeRange = (start, end) => `${time(start)} - ${end == null || end === '' ? 'Ongoing' : time(end)}`;
  const date = value => timestamp(value, { month: 'short', day: 'numeric', year: 'numeric' }, 'toLocaleDateString');
  const dateTime = value => typeof value === 'boolean' ? display(value) : date(value) === missing ? missing : `${date(value)} ${time(value)}`;
  const button = (label, action, attrs = '', style = 'secondary') => `<button type="button" class="${style}" data-action="${action}" ${attrs}>${escape(label)}</button>`;
  const field = (name, label, type = 'text', value = '', attrs = '') => `<label for="${name}">${escape(label)}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" ${attrs}>`;
  const table = (headers, rows, emptyMessage = 'No matching records.', keys = []) => `<div class="tablewrap"><table><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((cells, index) => `<tr${keys[index] == null ? '' : ` data-row-key="${escape(keys[index])}"`}>${cells.map(cell => `<td>${display(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty">${escape(emptyMessage)}</td></tr>`}</tbody></table></div>`;
  const brand = '<div class="brand">Classence<small>Online Student Activity Monitoring</small></div>';
  const feedback = '<p id="feedback" role="status" aria-live="polite"></p>';
  let motionPage;
  const pendingEntrances = new Set();
  const asyncSurfaces = '#real-realtime, [data-attendance-list], [data-attendance-page], [data-privacy-panel]';
  const loadingSurface = container => !container.children.length || [...container.querySelectorAll('[role="status"], h2')].some(element => /^(Loading|Checking your sessions)/.test(element.textContent));
  const motionAllowed = () => window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  function revealComponent(element) {
    if (element && motionAllowed()) element.classList.add('reveal', 'visible');
  }
  function revealSections(container) {
    let index = 0;
    function visit(element) {
      if (element.matches(asyncSurfaces) && loadingSurface(element)) { pendingEntrances.add(element); return; }
      if (element.matches('dialog, .back-navigation, [role="status"], .notice, .toolbar')) return;
      if (element.matches('.card, .panel, .grid, .class-list, .student-profile, .motion-action')) {
        element.classList.add('reveal', 'visible');
        element.style.setProperty('--index', Math.min(index++, 3));
      } else for (const child of element.children) visit(child);
    }
    for (const child of container.children) visit(child);
  }
  function revealReady(container) {
    if (!pendingEntrances.has(container)) return;
    if (!container.isConnected) { pendingEntrances.delete(container); return; }
    if (loadingSurface(container)) return;
    pendingEntrances.delete(container);
    if (motionAllowed()) {
      if (container.matches('.card, .panel')) revealComponent(container);
      else revealSections(container);
    }
  }
  function reveal(page) {
    if (motionPage === page) return;
    motionPage = page;
    pendingEntrances.clear();
    if (!motionAllowed()) return;
    const view = document.getElementById('view');
    const heading = document.querySelector('.top, #view > h1, .teacher-login-fields, .auth');
    heading?.classList.add('motion-page');
    if (!view) return;
    revealSections(view);
  }
  let toastTimer;
  function message(text, error = false) {
    const feedback = document.getElementById('feedback');
    if (error && feedback) {
      feedback.className = 'error';
      feedback.textContent = text;
      return;
    }
    let toast = document.getElementById('notification-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'notification-toast';
      toast.className = 'notification-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('aria-atomic', 'true');
      document.body.appendChild(toast);
    }
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; toast.textContent = ''; }, error ? 6000 : 3500);
  }
  const isNativePicker = element => element?.tagName === 'SELECT' || (element?.tagName === 'INPUT' && element.type === 'date');
  const hasTextSelection = () => Boolean(window.getSelection?.()?.toString());
  let pendingBackgroundRender;
  function backgroundRender(render) {
    if (isNativePicker(document.activeElement) || hasTextSelection()) {
      pendingBackgroundRender = render;
      return;
    }
    pendingBackgroundRender = null;
    safeRender(render);
  }
  document.addEventListener('focusout', event => {
    if (!isNativePicker(event.target)) return;
    setTimeout(() => {
      if (!pendingBackgroundRender || isNativePicker(document.activeElement) || hasTextSelection()) return;
      const render = pendingBackgroundRender;
      pendingBackgroundRender = null;
      safeRender(render);
    }, 0);
  });
  document.addEventListener('selectionchange', () => {
    if (!pendingBackgroundRender || hasTextSelection() || isNativePicker(document.activeElement)) return;
    const render = pendingBackgroundRender;
    pendingBackgroundRender = null;
    safeRender(render);
  });
  function safeRender(render) {
    const openDetails = Array.from(document.querySelectorAll('details')).map(el => el.open);
    const focused = document.activeElement;
    const key = focused?.id;
    const editing = focused && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName);
    const inputs = Array.from(document.querySelectorAll(editing ? 'input, textarea, select' : 'select')).map(el => ({ id: el.id, value: el.value, checked: el.checked, type: el.type }));
    const start = editing ? focused.selectionStart : null;
    const end = editing ? focused.selectionEnd : null;
    const scrollPositions = ['.popup', '.student-content'].map(selector => ({
      selector, top: document.querySelector(selector)?.scrollTop
    }));
    render();
    document.getElementById('app').classList.add('quiet-update');
    document.querySelectorAll('details').forEach((el, index) => { el.open = openDetails[index] || false; });
    inputs.forEach(saved => {
      const el = document.getElementById(saved.id);
      if (el) {
        if (['password', 'confirm'].includes(el.name)) el.type = saved.type;
        el.value = saved.value; el.checked = saved.checked;
      }
    });
    if (key && editing) {
      const restored = document.getElementById(key);
      restored?.focus({ preventScroll: true });
      if (start !== null && ['text', 'search', 'password', 'url', 'tel'].includes(restored?.type)) restored.setSelectionRange(start, end);
    }
    scrollPositions.forEach(({ selector, top }) => {
      const container = document.querySelector(selector);
      if (container && top != null) container.scrollTop = top;
    });
  }
  const patchedHTML = new WeakMap();
  const selectedUpdates = new Map();
  const nodeKey = node => node.nodeType === 1 ? node.id || node.getAttribute('data-row-key') : null;
  const compatible = (node, next) => node.nodeType === next.nodeType && node.nodeName === next.nodeName;
  function patchChildren(parent, next) {
    const previous = Array.from(parent.childNodes), used = new Set();
    const keyed = new Map();
    for (const node of previous) {
      const key = nodeKey(node);
      if (key) { if (!keyed.has(key)) keyed.set(key, []); keyed.get(key).push(node); }
    }
    let cursor = parent.firstChild;
    for (const desired of Array.from(next.childNodes)) {
      const key = nodeKey(desired);
      let current = key ? keyed.get(key)?.find(node => !used.has(node) && compatible(node, desired)) : null;
      if (!key) current = previous.find(node => !used.has(node) && !nodeKey(node) && compatible(node, desired));
      if (!current) { current = desired.cloneNode(true); parent.insertBefore(current, cursor); }
      else {
        if (current !== cursor) parent.insertBefore(current, cursor);
        patchNode(current, desired);
      }
      used.add(current); cursor = current.nextSibling;
    }
    for (const node of previous) if (!used.has(node)) node.remove();
  }
  function patchNode(current, next) {
    if (current.nodeType !== 1) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    if (current.matches('#real-realtime, [data-privacy-panel]') && !next.children.length) return;
    const focused = current === document.activeElement;
    const control = ['INPUT', 'TEXTAREA', 'SELECT'].includes(current.tagName);
    const motionClasses = ['reveal', 'visible', 'motion-page'].filter(name => current.classList.contains(name));
    const motionIndex = current.style.getPropertyValue('--index');
    const preserve = name => current.tagName === 'DETAILS' && name === 'open' || control && ['value', 'checked'].includes(name) || motionClasses.length && name === 'class' || motionIndex && name === 'style' && !next.hasAttribute('style');
    for (const attr of Array.from(current.attributes)) {
      if (!preserve(attr.name) && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    }
    for (const attr of Array.from(next.attributes)) {
      let value = attr.value;
      if (!preserve(attr.name) && current.getAttribute(attr.name) !== value) current.setAttribute(attr.name, value);
    }
    const classes = [...new Set([...next.classList, ...motionClasses])].join(' ');
    if (motionClasses.length && current.className !== classes) current.className = classes;
    if (motionIndex && current.style.getPropertyValue('--index') !== motionIndex) current.style.setProperty('--index', motionIndex);
    if (focused && control) return;
    patchChildren(current, next);
    if (control && current.value !== next.value) current.value = next.value;
    if (current.tagName === 'INPUT' && current.checked !== next.checked) current.checked = next.checked;
  }
  function patchHTML(target, markup, cacheNativePicker = false) {
    if (!target?.isConnected || patchedHTML.get(target) === markup) return;
    const selection = window.getSelection?.();
    if (selection?.toString() && target.contains(selection.anchorNode) && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
      selectedUpdates.set(target, markup);
      return;
    }
    selectedUpdates.delete(target);
    const template = document.createElement('template');
    template.innerHTML = markup;
    patchChildren(target, template.content);
    revealReady(target);
    if (cacheNativePicker || !target.contains(document.activeElement) || !isNativePicker(document.activeElement)) patchedHTML.set(target, markup);
  }
  document.addEventListener('selectionchange', () => {
    if (hasTextSelection()) return;
    for (const [target, markup] of Array.from(selectedUpdates)) {
      selectedUpdates.delete(target);
      if (target.isConnected) patchHTML(target, markup);
    }
  });
  const closingDialogs = new WeakMap();
  function closeDialog(dialog, result = '') {
    if (!dialog?.open) return Promise.resolve();
    if (closingDialogs.has(dialog)) return closingDialogs.get(dialog);
    if (!motionAllowed()) { dialog.close(result); return Promise.resolve(); }
    const promise = new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        dialog.removeEventListener('animationend', ended);
        dialog.removeEventListener('close', finish);
        closingDialogs.delete(dialog);
        dialog.classList.remove('motion-closing');
        if (dialog.open) dialog.close(result);
        resolve();
      };
      const ended = event => { if (event.target === dialog && event.animationName === 'interface-exit') finish(); };
      dialog.addEventListener('animationend', ended);
      dialog.addEventListener('close', finish, { once: true });
      dialog.classList.add('motion-closing');
      timer = setTimeout(finish, 300);
    });
    closingDialogs.set(dialog, promise);
    return promise;
  }
  document.addEventListener('cancel', event => {
    if (event.target.matches('dialog')) { event.preventDefault(); if (!event.target.dataset.saving) closeDialog(event.target); }
  }, true);
  document.addEventListener('submit', event => {
    if (event.target.matches('dialog form[method="dialog"]')) {
      event.preventDefault(); closeDialog(event.target.closest('dialog'), event.submitter?.value || '');
    }
  });
  function confirmAction(title, text, action) {
    const dialog = document.getElementById('confirmation');
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('p').textContent = text;
    const confirm = dialog.querySelector('[data-confirm]');
    confirm.disabled = false;
    confirm.onclick = () => { confirm.disabled = true; closeDialog(dialog).then(action).catch(error => message(error.message, true)); };
    dialog.showModal();
  }
  window.UI = { escape, display, text, badge, meetActivity, time, timeRange, date, dateTime, button, field, table, brand, feedback, message, safeRender, backgroundRender, patchHTML, closeDialog, confirmAction, reveal, revealReady, revealComponent };
})();
