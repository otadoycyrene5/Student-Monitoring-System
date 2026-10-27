
(() => {
  'use strict';
  const escape = UI.escape;
  let busy = false;
  const error = name => `<p id="${name}-error" class="field-error" hidden></p>`;
  function input(name, label, type, placeholder, attrs = '') {
    return `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" placeholder="${placeholder}" aria-describedby="${name}-error" ${attrs}>${error(name)}`;
  }
  function password(name, label, placeholder) {
    return `<label for="${name}">${label}<span class="required-mark" aria-hidden="true"> *</span></label><div class="password-control"><input id="${name}" name="${name}" type="password" placeholder="${placeholder}" required minlength="8" autocomplete="new-password" aria-describedby="${name === 'password' ? 'password-help ' : ''}${name}-error"><button type="button" class="secondary password-toggle" data-toggle-password="${name}" aria-controls="${name}" aria-pressed="false" aria-label="Show ${name === 'password' ? 'password' : 'confirm password'}">Show</button></div>${name === 'password' ? '<small id="password-help">Use at least 8 characters.</small>' : ''}${error(name)}`;
  }
  function render(mode) {
    const content = mode === 'registration-success'
      ? `<div class="registration-success" role="status"><h1>Faculty Account Created</h1><p>Faculty account created successfully.</p><p class="muted">You can now log in with your institutional email and password.</p>${UI.button('Log in', 'auth-mode', 'data-mode="login"', 'primary full')}</div>`
      : `<h1>Create Faculty Account</h1><p>Enter your faculty information to get started.</p><form data-form="faculty-register" novalidate>
        <fieldset><legend>Faculty Information</legend>
        ${input('facultyId', 'Faculty ID', 'text', 'e.g., FAC-2026-001', 'required maxlength="80" autocomplete="off"')}
        ${input('name', 'Full Name', 'text', 'Enter your full name', 'required maxlength="100" autocomplete="name"')}
        ${input('department', 'Department', 'text', 'Enter your department', 'required maxlength="150"')}
        <label for="academicRank">Academic Position</label><select id="academicRank" name="academicRank" required aria-describedby="academicRank-error"><option value="">Select academic position</option>${CW.academicRanks.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('')}</select>${error('academicRank')}
        </fieldset>
        <fieldset><legend>Account Credentials</legend>
        ${input('email', 'Institutional Email Address', 'email', 'name@university.edu', 'required maxlength="254" autocomplete="username"')}
        ${password('password', 'Password', 'Create a password')}
        ${password('confirm', 'Confirm Password', 'Confirm your password')}
        </fieldset>
        <div class="registration-agreement"><label class="check" for="agreement"><input id="agreement" name="agreement" type="checkbox" required aria-describedby="agreement-error"><span>I agree to the Terms of Use and Privacy Notice.<span class="required-mark" aria-hidden="true"> *</span></span></label>${error('agreement')}</div>
        <p id="registration-feedback" class="error" role="status" aria-live="polite" hidden></p>
        <button type="submit" class="primary full">Create Account</button>
        </form><p class="auth-switch">Already have an account? ${UI.button('Log in', 'auth-mode', 'data-mode="login"', 'link')}</p>`;
    return `<div class="teacher-login teacher-registration"><div class="teacher-login-image"><img src="assets/images/landing-bg.jpg" alt="Campus overlooking the river and city skyline"></div><section class="teacher-login-form" aria-label="Faculty registration"><div class="teacher-login-fields"><div class="brand">Classence<small>Online Student Activity Monitoring</small></div>${content}</div></section></div>`;
  }
  function validate(values) {
    const errors = {};
    if (!String(values.facultyId || '').trim()) errors.facultyId = 'Faculty ID is required.';
    if (!String(values.name || '').trim()) errors.name = 'Please enter your full name.';
    if (!String(values.department || '').trim()) errors.department = 'Please enter your department.';
    if (!CW.academicRanks.includes(values.academicRank)) errors.academicRank = 'Please select an academic position.';
    if (!/^\S+@\S+\.\S+$/.test(String(values.email || '').trim())) errors.email = 'Enter a valid email address.';
    if (!values.password || !values.password.trim() || values.password.length < 8) errors.password = 'Password must contain at least 8 characters.';
    if (!values.confirm || values.confirm !== values.password) errors.confirm = 'Passwords do not match.';
    if (values.agreement !== 'on') errors.agreement = 'Please accept the Terms of Use and Privacy Notice.';
    return errors;
  }
  function showErrors(form, errors) {
    form.querySelectorAll('.field-error').forEach(node => { node.hidden = true; node.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid'));
    for (const [name, message] of Object.entries(errors)) {
      const field = form.elements.namedItem(name), node = form.querySelector('#' + name + '-error');
      field?.setAttribute('aria-invalid', 'true');
      if (node) { node.textContent = message; node.hidden = false; }
    }
    const first = Object.keys(errors)[0];
    if (first) form.elements.namedItem(first)?.focus();
  }
  function bind(root, state, renderPage) {
    root.addEventListener('change', event => {
      if (event.target.matches('[data-show-password]')) root.querySelectorAll('[name="password"], [name="confirm"]').forEach(input => { input.type = event.target.checked ? 'text' : 'password'; });
    });
    root.addEventListener('click', event => {
      const toggle = event.target.closest('[data-toggle-password]');
      if (!toggle) return;
      const input = document.getElementById(toggle.dataset.togglePassword);
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      toggle.textContent = visible ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(visible));
      toggle.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${input.name === 'password' ? 'password' : 'confirm password'}`);
    });
    root.addEventListener('submit', async event => {
      const form = event.target, kind = form.dataset.form;
      if (!['login', 'faculty-register'].includes(kind)) return;
      event.preventDefault();
      if (busy) return;
      const values = Object.fromEntries(new FormData(form));
      if (kind === 'faculty-register') {
        for (const name of ['facultyId', 'name', 'department', 'email']) { values[name] = String(values[name] || '').trim(); form.elements.namedItem(name).value = values[name]; }
        const errors = validate(values);
        if (form.elements.namedItem('email').validity.typeMismatch) errors.email = 'Enter a valid email address.';
        showErrors(form, errors);
        if (Object.keys(errors).length) return;
      }
      const button = form.querySelector('button[type="submit"]'), label = button.textContent;
      busy = true; button.disabled = true; button.textContent = kind === 'faculty-register' ? 'Creating Account...' : 'Logging in...';
      form.setAttribute('aria-busy', 'true');
      const general = form.querySelector('#registration-feedback, #feedback');
      if (general) { general.hidden = kind === 'faculty-register'; general.textContent = ''; }
      try {
        if (kind === 'faculty-register') {
          await FacultyAPI.register(values);
          state.authMode = 'registration-success';
          busy = false; renderPage();
        } else {
          await FacultyAPI.login(values.email, values.password);
          state.authMode = 'login'; state.page = 'dashboard';
          busy = false; renderPage();
        }
      } catch (error) {
        if (kind === 'faculty-register' && error.errors) {
          const mapping={fullName:'name',academicPosition:'academicRank'};
          showErrors(form,Object.fromEntries(Object.entries(error.errors).map(([key,value])=>[mapping[key]||key,value])));
        }
        else if (general) { general.textContent = error.message; general.hidden = false; }
        else UI.message(error.message, true);
      } finally {
        busy = false; button.disabled = false; button.textContent = label; form.removeAttribute('aria-busy');
      }
    });
  }
  window.FacultyRegistration = { render, validate, bind, get busy() { return busy; } };
})();
