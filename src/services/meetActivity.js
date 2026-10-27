'use strict';

const delay = 5 * 60 * 1000;
function nextUnfocusedSince(previous, state, now, freshMs, delayed = false, notBefore = 0) {
  if (delayed || state !== 'MEET_TAB_NOT_SELECTED') return null;
  const prior = previous?.observation?.unfocusedSince;
  const report = +new Date(previous?.last_report_at);
  if (previous?.tab_state === state && prior && Number.isFinite(Date.parse(prior)) &&
      Date.parse(prior) <= report && report >= notBefore && now >= report && now - report <= freshMs &&
      !previous.observation.delayed) return prior;
  return new Date(now).toISOString();
}
function classify(monitoring, now = Date.now(), freshMs = 75000) {
  const report = +new Date(monitoring?.lastReportAt);
  if (monitoring?.health !== 'RECENT' || monitoring.delayed || !Number.isFinite(report) ||
      now < report || now - report > freshMs || !(Date.parse(monitoring.expiresAt) > now)) return 'Unknown';
  if (monitoring.tabState === 'MEET_TAB_SELECTED') return 'Active';
  if (monitoring.tabState !== 'MEET_TAB_NOT_SELECTED') return 'Unknown';
  const since = Date.parse(monitoring.unfocusedSince);
  return Number.isFinite(since) && since <= report && now - since >= delay ? 'Inactive' : 'On Another Tab';
}

module.exports = {nextUnfocusedSince,classify,delay};
