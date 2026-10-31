/*
 * AttendWise UI layer. All calculations go through AttendEngine; this file
 * only reads inputs, calls the engine, and renders results.
 */
const ERP_BACKEND_URL = "https://attendwise-backend-tihk.onrender.com";
(function () {
  'use strict';

  var E = window.AttendEngine;
  var S = window.AttendStorage;

  var state = {
    settings: null,
    lastCalc: null,        // { inputs, result }
    lastPredictor: null
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }

  /* ---------- routing and nav ---------- */

  var VIEWS = ['home', 'calculator', 'predictor', 'planner', 'medical', 'settings'];

  function showView(name, focusTarget) {
    if (VIEWS.indexOf(name) === -1) name = 'home';
    VIEWS.forEach(function (v) {
      var sec = $('view-' + v);
      if (sec) sec.hidden = (v !== name);
    });
    document.querySelectorAll('[data-route]').forEach(function (a) {
      if (a.tagName === 'A' && a.closest('.site-nav')) {
        var wantFocus = focusTarget === 'scenarios' ? 'scenarios' : '';
        var isCurrent = a.getAttribute('data-route') === name && (a.getAttribute('data-focus') || '') === wantFocus;
        if (isCurrent) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    });
    closeMenu();
    if (name === 'predictor') renderPredictorBaseline();
    if (name === 'planner') renderPlanner();
    if (name === 'home') renderHome();
    var main = $('main');
    if (main) main.focus({ preventScroll: true });
    if (focusTarget === 'missed') {
      $('pred-tool').value = 'miss';
      togglePredictorPanels();
    }
    if (focusTarget === 'scenarios') {
      renderScenarioTable();
    }
    window.scrollTo(0, 0);
  }

  function routeFromHash() {
    var hash = (window.location.hash || '#home').slice(1);
    showView(hash);
  }

  function closeMenu() {
    var nav = $('site-nav');
    var toggle = $('menu-toggle');
    if (!nav) return;
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.querySelector('.sr-only').textContent = 'Open menu';
  }

  function toggleMenu() {
    var nav = $('site-nav');
    var toggle = $('menu-toggle');
    var open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('.sr-only').textContent = open ? 'Close menu' : 'Open menu';
  }

  /* ---------- calculator ---------- */

  var CALC_FIELDS = ['combinedAbsentOAA', 'oaaAttendance', 'totalLectures'];

  function readCalcInputs() {
    var out = {};
    CALC_FIELDS.forEach(function (f) { out[f] = $(f).value; });
    return out;
  }

  function clearCalcErrors() {
    CALC_FIELDS.forEach(function (f) {
      $(f).removeAttribute('aria-invalid');
      setText(f + '-error', '');
    });
    setText('calc-form-status', '');
  }

  function showCalcErrors(errors) {
    CALC_FIELDS.forEach(function (f) {
      if (errors[f]) {
        $(f).setAttribute('aria-invalid', 'true');
        setText(f + '-error', errors[f]);
      }
    });
    setText('calc-form-status', 'Please correct the input values before calculating.');
  }

  function renderCalcResult(result) {
    setText('calc-result', E.formatPercent(result.percentage));
    var statusEl = $('calc-status');
    statusEl.textContent = E.currentStatus(result.percentage, state.settings.targetPercent) +
      ' (target ' + E.formatPercent(state.settings.targetPercent).replace('.00', '') + ')';
    statusEl.className = 'status-line ' + (result.percentage >= state.settings.targetPercent ? 'ok' : 'warn');
    var bd = $('calc-breakdown');
    bd.innerHTML = '';
    E.buildBreakdown({
      combinedAbsentOAA: result.combinedAbsentOAA,
      oaaAttendance: result.oaaAttendance,
      totalLectures: result.totalLectures,
      effectiveAbsent: result.effectiveAbsent,
      percentage: result.percentage
    }).forEach(function (line) {
      var p = document.createElement('p');
      p.className = 'mono';
      p.textContent = line;
      bd.appendChild(p);
    });
    $('calc-copy').disabled = false;
    setProgress('calc', result.percentage, state.settings.targetPercent);
    setText('home-current', E.formatPercent(result.percentage));
    $('home-ring').style.setProperty('--pct', clampPct(result.percentage));
    $('home-current').classList.remove('warn-text');
    $('home-progress-fill').style.width = clampPct(result.percentage) + '%';
  }

  function clampPct(v) {
    if (!isFinite(v)) return 0;
    return Math.min(100, Math.max(0, v));
  }

  function setProgress(prefix, current, target) {
    var fill = $(prefix === 'calc' ? 'calc-progress-fill' : 'home-progress-fill');
    fill.style.width = clampPct(current) + '%';
    if (prefix === 'calc') {
      var mc = $('calc-marker-current');
      var mt = $('calc-marker-target');
      mc.hidden = false;
      mt.hidden = false;
      mc.style.left = clampPct(current) + '%';
      mc.setAttribute('title', 'Current ' + E.formatPercent(current));
      mt.style.left = clampPct(target) + '%';
      mt.setAttribute('title', 'Target ' + target + '%');
    }
  }

  function calculate(ev) {
    if (ev) ev.preventDefault();
    clearCalcErrors();
    var inputs = readCalcInputs();
    var checked = E.validateAttendanceInputs(inputs);
    if (!checked.ok) {
      showCalcErrors(checked.errors);
      state.lastCalc = null;
      $('calc-copy').disabled = true;
      $('calc-result').textContent = '-';
      $('calc-status').textContent = E.STATUS_MESSAGES.invalid;
      $('calc-status').className = 'status-line error';
      $('calc-breakdown').innerHTML = '';
      return;
    }
    var result = E.calculateCurrentAttendance(inputs);
    state.lastCalc = { inputs: inputs, result: result };
    renderCalcResult(result);
    recordHistory(inputs, result);
    renderScenarioTable();
    renderPredictorBaseline();
    setText('calc-form-status', 'Calculated. Inputs are kept so you can adjust them.');
  }

  function resetCalculator() {
    CALC_FIELDS.forEach(function (f) { $(f).value = ''; });
    clearCalcErrors();
    state.lastCalc = null;
    $('calc-result').textContent = '-';
    $('calc-status').textContent = '';
    $('calc-breakdown').innerHTML = '';
    $('calc-copy').disabled = true;
    setText('calc-copy-status', '');
    $('calc-marker-current').hidden = true;
    $('calc-marker-target').hidden = true;
    $('calc-progress-fill').style.width = '0%';
    setText('home-current', 'Not calculated yet');
    $('home-ring').style.setProperty('--pct', 0);
    $('home-current').classList.add('warn-text');
    $('home-progress-fill').style.width = '0%';
    renderScenarioTable();
    renderPredictorBaseline();
    $('combinedAbsentOAA').focus();
    $('sar-quick').value = '';
    $('sar-quick-result').hidden = true;
    setText('sar-quick-error', '');
    setText('sar-quick-note', '');
  }

  function copyCalculationResult() {
    if (!state.lastCalc) {
      setText('calc-copy-status', 'Calculate a result before copying.');
      return Promise.resolve(false);
    }
    var text = E.buildCopyText(state.lastCalc.result, state.settings.displayName);
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    };
    var done = function (ok) {
      setText('calc-copy-status', ok ? 'Result copied to clipboard.' : 'Copy failed. Select the result text and copy it manually.');
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return done(true); }, function () { return done(fallback()); });
    }
    return Promise.resolve(done(fallback()));
  }

  /* ---------- history ---------- */

  function recordHistory(inputs, result) {
    var entry = {
      timestamp: new Date().toISOString(),
      kind: 'calculation',
      inputs: { combinedAbsentOAA: result.combinedAbsentOAA, oaaAttendance: result.oaaAttendance, totalLectures: result.totalLectures },
      currentPercent: result.percentage,
      scenario: 'Current calculation',
      projected: null
    };
    S.appendHistory(entry);
    renderHistory();
  }

  function renderHistory() {
    var list = $('history-list');
    list.innerHTML = '';
    var items = S.loadHistory();
    if (!items.length) {
      var li0 = document.createElement('li');
      li0.className = 'muted';
      li0.textContent = 'No calculations saved yet.';
      list.appendChild(li0);
      return;
    }
    items.forEach(function (h) {
      var li = document.createElement('li');
      var d = new Date(h.timestamp);
      var when = isNaN(d.getTime()) ? h.timestamp : d.toLocaleString();
      if (h.kind === 'medical') {
        li.textContent = when + ' · Medical Calculator: Total Lectures=' + h.inputs.totalLectures +
          ', Total Absent=' + h.inputs.totalAbsent + ', Medical Days=' + h.inputs.medicalDays +
          ', Lectures/Day=' + h.inputs.lecturesPerDay + ' → ' + E.formatPercent(h.currentPercent) +
          ' before, ' + h.projected + ' after';
      } else if (h.kind === 'prediction') {
        li.textContent = when + ' · prediction (T=' + h.inputs.totalLectures + ', A=' + h.inputs.effectiveAbsent +
          ', current ' + E.formatPercent(h.currentPercent) + ') · ' + h.scenario + ' → ' + h.projected;
      } else {
        li.textContent = when + ' · calculation: Total Absent+OAA=' + h.inputs.combinedAbsentOAA +
          ', O.A. Attendance=' + h.inputs.oaaAttendance + ', Total Lecture=' + h.inputs.totalLectures +
          ' → ' + E.formatPercent(h.currentPercent);
      }
      list.appendChild(li);
    });
  }

  function clearHistoryUI() {
    S.clearHistory();
    renderHistory();
    setText('history-status', 'History cleared.');
  }


  /* ---------- medical attendance (own inputs, independent of lastCalc) ---------- */

  var MEDICAL_FIELDS = { totalLectures: 'medical-total', totalAbsent: 'medical-absent', medicalDays: 'medical-days' };


  function clearMedicalErrors() {
    Object.keys(MEDICAL_FIELDS).forEach(function (k) {
      var id = MEDICAL_FIELDS[k];
      $(id).removeAttribute('aria-invalid');
      setText(id + '-error', '');
    });
    setText('medical-form-status', '');
  }

  function clearMedicalResult() {
    ['med-original', 'med-medical-lectures', 'med-adjusted-absences', 'med-adjusted-att', 'med-improvement', 'med-remaining'].forEach(function (id) {
      setText(id, '-');
    });
    setText('medical-status', '');
  }

  function runMedical(ev) {
    if (ev) ev.preventDefault();
    clearMedicalErrors();
    var inputs = {
      totalLectures: $('medical-total').value,
      totalAbsent: $('medical-absent').value,
      medicalDays: $('medical-days').value,
      lecturesPerDay: state.settings.lecturesPerDay
    };
    var r;
    try {
      r = E.calculateMedical(inputs);
    } catch (err) {
      if (err instanceof E.ValidationError) {
        Object.keys(err.errors).forEach(function (k) {
          var id = MEDICAL_FIELDS[k];
          if (!id) return;
          $(id).setAttribute('aria-invalid', 'true');
          setText(id + '-error', err.errors[k]);
        });
        setText('medical-form-status', 'Please correct the input values before calculating.');
        clearMedicalResult();
        setText('medical-status', E.STATUS_MESSAGES.invalid);
        return;
      }
      throw err;
    }
    setText('med-original', E.formatPercent(r.originalAttendance));
    setText('med-medical-lectures', String(r.medicalLectures));
    setText('med-adjusted-absences', String(r.adjustedAbsences));
    setText('med-adjusted-att', E.formatPercent(r.adjustedAttendance));
    setText('med-improvement', E.formatSigned(r.improvement));
    setText('med-remaining', String(r.remainingAbsences));
    setText('medical-status', 'Total lectures stay at ' + r.totalLectures + '. Medical lectures are removed from absences only.');
    setText('medical-form-status', 'Calculated. Inputs are kept so you can adjust them.');
    recordMedicalHistory(r);
  }

  function resetMedical() {
    Object.keys(MEDICAL_FIELDS).forEach(function (k) { $(MEDICAL_FIELDS[k]).value = ''; });
    clearMedicalErrors();
    clearMedicalResult();
    $('medical-total').focus();
  }

  function recordMedicalHistory(r) {
    S.appendHistory({
      timestamp: new Date().toISOString(),
      kind: 'medical',
      inputs: { totalLectures: r.totalLectures, totalAbsent: r.totalAbsent, medicalDays: r.medicalDays, lecturesPerDay: r.lecturesPerDay },
      currentPercent: r.originalAttendance,
      scenario: 'Medical Calculator',
      projected: E.formatPercent(r.adjustedAttendance)
    });
    renderHistory();
  }

  /* ---------- settings ---------- */

  function loadAndApplySettings() {
    var loaded = S.loadSettings(E);
    state.settings = loaded.settings;
    $('set-name').value = state.settings.displayName;
    $('set-lpd').value = String(state.settings.lecturesPerDay);
    $('set-target').value = String(state.settings.targetPercent);
    refreshStorageNote(loaded.usingMemory);
    applyWelcome();
    buildTargetSelect();
  }

  function refreshStorageNote(usingMemory) {
    setText('storage-note', usingMemory
      ? 'Browser storage is unavailable, so settings and history are kept in memory only and will be lost when you close this page.'
      : 'Settings and history are saved in this browser (localStorage).');
    if (usingMemory) {
      setText('settings-status', 'Browser storage is unavailable. Changes will stay in memory only.');
    }
  }

  function applyWelcome() {
    setText('welcome-name', state.settings.displayName);
    setText('welcome-target', state.settings.targetPercent + '%');
    setText('welcome-lpd', String(state.settings.lecturesPerDay));
  }

  function saveSettingsFromForm(ev) {
    ev.preventDefault();
    ['set-lpd-error', 'set-target-error'].forEach(function (id) { setText(id, ''); });
    var result = S.saveSettings(E, {
      displayName: $('set-name').value,
      lecturesPerDay: $('set-lpd').value,
      targetPercent: $('set-target').value
    });
    if (!result.ok) {
      if (result.errors.lecturesPerDay) setText('set-lpd-error', result.errors.lecturesPerDay);
      if (result.errors.targetPercent) setText('set-target-error', result.errors.targetPercent);
      setText('settings-status', 'Please correct the input values before saving.');
      return;
    }
    state.settings = result.settings;
    applyWelcome();
    buildTargetSelect();
    refreshStorageNote(result.usingMemory);
    setText('settings-status', result.usingMemory
      ? 'Saved in memory only (browser storage unavailable).'
      : 'Settings saved.');
    if (state.lastCalc) renderCalcResult(state.lastCalc.result);
    renderScenarioTable();
    renderPredictorBaseline();
  }

  function resetSettingsToDefaults() {
    var r = S.resetSettings(E);
    state.settings = r.settings;
    $('set-name').value = state.settings.displayName;
    $('set-lpd').value = String(state.settings.lecturesPerDay);
    $('set-target').value = String(state.settings.targetPercent);
    ['set-lpd-error', 'set-target-error'].forEach(function (id) { setText(id, ''); });
    applyWelcome();
    buildTargetSelect();
    refreshStorageNote(r.usingMemory);
    setText('settings-status', 'Reset to defaults: Student, 8 lectures per day, 75% target.');
    if (state.lastCalc) renderCalcResult(state.lastCalc.result);
    renderScenarioTable();
    renderPredictorBaseline();
  }

  /* ---------- predictor ---------- */

  function baseline() {
    if (!state.lastCalc) return null;
    return { total: state.lastCalc.result.totalLectures, absent: state.lastCalc.result.effectiveAbsent };
  }

  function renderPredictorBaseline() {
    var b = baseline();
    if (!b) {
      setText('pred-T', '-');
      setText('pred-A', '-');
      setText('pred-cur', '-');
      setText('pred-baseline-note', 'Calculate your attendance on the Calculator page first. The predictor uses the last calculated result.');
      return;
    }
    setText('pred-T', String(b.total));
    setText('pred-A', String(b.absent));
    setText('pred-cur', E.formatPercent(E.percentageOf(b.absent, b.total)));
    setText('pred-baseline-note', 'Using your last calculated result as the baseline.');
      }

  function togglePredictorPanels() {
    var mode = $('pred-tool').value;
    $('pred-attend-panel').hidden = mode !== 'attend';
    $('pred-miss-panel').hidden = mode !== 'miss';
    $('pred-mixed-panel').hidden = mode !== 'mixed';
    $('pred-days').closest('.field').hidden = mode === 'mixed';
    ['pred-days-error'].forEach(function (id) { setText(id, ''); });
  }

  function setDaysValue(n) {
    $('pred-days').value = String(n);
  }

  function runPredictor() {
    var b = baseline();
    setText('pred-days-error', '');
    setText('pred-status', '');
    $('pred-result').innerHTML = '';
    if (!b) {
      setText('pred-status', 'Calculate your attendance first, then run a prediction.');
      return;
    }
    var mode = $('pred-tool').value;
    var lpd = state.settings.lecturesPerDay;
    try {
      var out;
      if (mode === 'attend') {
        out = E.calculateFutureAttendance(b, { days: $('pred-days').value, lecturesPerDay: lpd });
        out.label = 'Attend ' + out.days + ' day(s)';
      } else if (mode === 'miss') {
        out = E.simulateAbsence(b, { days: $('pred-days').value, lecturesPerDay: lpd });
        out.label = 'Miss ' + out.days + ' day(s)';
      } else {
        out = E.calculateMixedScenario(b, {
          lecturesPerDay: lpd,
          fullyAttendedDays: $('mix-full-att').value,
          fullyAbsentDays: $('mix-full-abs').value,
          partialDays: $('mix-partial-days').value,
          partialAttended: $('mix-partial-att').value
        });
        out.label = 'Mixed scenario';
      }
    } catch (err) {
      if (err instanceof E.ValidationError) {
        showPredErrors(err.errors);
        setText('pred-status', E.STATUS_MESSAGES.invalid);
        return;
      }
      throw err;
    }
    renderPredictorResult(out, b);
    S.appendHistory({
      timestamp: new Date().toISOString(),
      kind: 'prediction',
      inputs: { totalLectures: b.total, effectiveAbsent: b.absent },
      currentPercent: E.percentageOf(b.absent, b.total),
      scenario: out.label,
      projected: E.formatPercent(out.projectedPercentage)
    });
    renderHistory();
  }

  function showPredErrors(errors) {
    Object.keys(errors).forEach(function (key) {
      var id = key === 'days' ? 'pred-days-error' : null;
      if (key === 'partialAttended') id = 'mix-partial-att-error';
      if (key === 'fullyAttendedDays') id = 'mix-full-att-error';
      if (key === 'fullyAbsentDays') id = 'mix-full-abs-error';
      if (key === 'partialDays') id = 'mix-partial-days-error';
      if (id) setText(id, errors[key]);
    });
  }

  function renderPredictorResult(out, b) {
    var cur = E.percentageOf(b.absent, b.total);
    var box = $('pred-result');
    box.innerHTML = '';
    var lines = [
      out.label,
      'Projected total lectures = ' + out.projectedTotal,
      'Projected effective absences = ' + out.projectedEffectiveAbsent,
      'Projected attendance = 100 - ((' + out.projectedEffectiveAbsent + '/' + out.projectedTotal + ')*100) = ' + E.formatPercent(out.projectedPercentage),
      'Change from current: ' + E.formatSigned(out.projectedPercentage - cur)
    ];
    lines.forEach(function (t) { var p = document.createElement('p'); p.className = 'mono'; p.textContent = t; box.appendChild(p); });
    setText('pred-status', E.currentStatus(out.projectedPercentage, state.settings.targetPercent) === E.STATUS_MESSAGES.reached
      ? E.STATUS_MESSAGES.projectedReaches : E.STATUS_MESSAGES.belowTarget);
    state.lastPredictor = out;
  }

  function quickAttend(days) {
    $('pred-tool').value = 'attend';
    togglePredictorPanels();
    setDaysValue(days);
    runPredictor();
  }

  function quickMiss(days) {
    $('pred-tool').value = 'miss';
    togglePredictorPanels();
    setDaysValue(days);
    runPredictor();
  }

  function runImpact() {
    var b = baseline();
    ['imp-attend-error', 'imp-attend-days-error', 'imp-miss-error', 'imp-custom-error'].forEach(function (id) { setText(id, ''); });
    $('imp-result').innerHTML = '';
    setText('imp-status', '');
    if (!b) { setText('imp-status', 'Calculate your attendance first.'); return; }
    try {
      var r = E.calculateAttendanceImpact(b, {
        attendLectures: Number($('imp-attend-days').value || 0) * state.settings.lecturesPerDay + Number($('imp-attend').value || 0),
        missLectures: $('imp-miss').value,
        targetPercent: $('imp-custom').value
      });
      var box = $('imp-result');
      [
        'Current = ' + E.formatPercent(r.currentPercentage),
        'Projected = ' + E.formatPercent(r.projectedPercentage) + ' (total ' + r.projectedTotal + ', effective absences ' + r.projectedEffectiveAbsent + ')',
        'Change = ' + E.formatSigned(r.ppChange),
        'Target ' + r.targetPercent + '%: ' + (r.targetAchieved ? 'achieved' : 'not achieved'),
        r.targetAchieved ? 'No additional lectures needed for this target.' : 'Additional lectures needed to reach target: ' + r.additionalLecturesNeeded
      ].forEach(function (t) { var p = document.createElement('p'); p.className = 'mono'; p.textContent = t; box.appendChild(p); });
      setText('imp-status', r.targetAchieved ? E.STATUS_MESSAGES.projectedReaches : E.STATUS_MESSAGES.belowTarget);
    } catch (err) {
      if (err instanceof E.ValidationError) {
        if (err.errors.attendLectures) setText('imp-attend-days-error', 'Days + lectures attended exceed the limit. Check both fields.');
        if (err.errors.missLectures) setText('imp-miss-error', err.errors.missLectures);
        if (err.errors.targetPercent) setText('imp-custom-error', err.errors.targetPercent);
        setText('imp-status', E.STATUS_MESSAGES.invalid);
        return;
      }
      throw err;
    }
  }

  /* ---------- quick SAR under calculator result ---------- */

  function runQuickSar() {
    setText('sar-quick-error', '');
    setText('sar-quick-note', '');
    var out = $('sar-quick-result');
    out.hidden = true;
    var b = baseline();
    if (!b) { setText('sar-quick-note', 'Calculate your attendance first.'); return; }
    var raw = $('sar-quick').value;
    if (String(raw).trim() === '') { setText('sar-quick-note', 'Enter approved SAR lectures to see the after-SAR attendance.'); return; }
    try {
      var r = E.calculateSar({ totalAbsent: String(b.absent), approvedSar: raw, totalLectures: String(b.total) });
      out.hidden = false;
      out.textContent = 'After SAR: ' + E.formatPercent(r.afterPercentage);
      setText('sar-quick-note',
        'Remaining absent lectures = ' + r.totalAbsent + ' - ' + r.approvedSar + ' = ' + r.remainingAbsent +
        ' · Before SAR: ' + E.formatPercent(r.beforePercentage) + ' · Simulation only.');
    } catch (err) {
      if (err instanceof E.ValidationError) {
        setText('sar-quick-error', err.errors.approvedSar || err.errors.totalAbsent || err.errors.totalLectures || 'Check the value.');
        return;
      }
      throw err;
    }
  }

  /* ---------- quick SAR under calculator result ---------- */

  function runQuickSar() {
    setText('sar-quick-error', '');
    setText('sar-quick-note', '');
    var out = $('sar-quick-result');
    out.hidden = true;
    var b = baseline();
    if (!b) { setText('sar-quick-note', 'Calculate your attendance first.'); return; }
    var raw = $('sar-quick').value;
    if (String(raw).trim() === '') { setText('sar-quick-note', 'Enter approved SAR lectures to see the after-SAR attendance.'); return; }
    try {
      var r = E.calculateSar({ totalAbsent: String(b.absent), approvedSar: raw, totalLectures: String(b.total) });
      out.hidden = false;
      out.textContent = 'After SAR: ' + E.formatPercent(r.afterPercentage);
      setText('sar-quick-note',
        'Remaining absent lectures = ' + r.totalAbsent + ' - ' + r.approvedSar + ' = ' + r.remainingAbsent +
        ' · Before SAR: ' + E.formatPercent(r.beforePercentage) + ' · Simulation only.');
    } catch (err) {
      if (err instanceof E.ValidationError) {
        setText('sar-quick-error', err.errors.approvedSar || err.errors.totalAbsent || err.errors.totalLectures || 'Check the value.');
        return;
      }
      throw err;
    }
  }


  /* ---------- scenario table and chart ---------- */

  function customMixedFromPredictor() {
    return {
      fullyAttendedDays: parseInt($('mix-full-att').value, 10) || 0,
      fullyAbsentDays: parseInt($('mix-full-abs').value, 10) || 0,
      partialDays: parseInt($('mix-partial-days').value, 10) || 0,
      partialAttended: parseInt($('mix-partial-att').value, 10) || 0
    };
  }

  function renderScenarioTable() {
    var body = $('scenario-body');
    var chart = $('scenario-chart');
    body.innerHTML = '';
    chart.innerHTML = '';
    var b = baseline();
    if (!b) {
      setText('scenario-status', 'Calculate your attendance to see the scenario comparison.');
      return;
    }
    var rows;
    try {
      rows = E.compareScenarios(b, { lecturesPerDay: state.settings.lecturesPerDay, custom: customMixedFromPredictor() });
    } catch (err) {
      if (err instanceof E.ValidationError) {
        setText('scenario-status', 'Custom mixed scenario needs correction in the Future Predictor: ' + Object.values(err.errors).join(' '));
        return;
      }
      throw err;
    }
    setText('scenario-status', 'Custom mixed uses the values in the Future Predictor mixed scenario fields.');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      [
        r.scenario,
        r.futureDays,
        r.attended,
        r.missed,
        r.projectedTotal,
        r.projectedEffectiveAbsent,
        E.formatPercent(r.projectedPercentage),
        E.formatSigned(r.differenceFromCurrent)
      ].forEach(function (v, i) {
        var td = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) td.setAttribute('scope', 'row');
        td.textContent = String(v);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    chart.innerHTML = buildBarChartSVG(rows, state.settings.targetPercent);
  }

  function buildBarChartSVG(rows, target) {
    var W = 520, H = 240, padL = 40, padR = 12, padT = 16, padB = 56;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var n = rows.length;
    var slot = innerW / n;
    var barW = Math.max(14, slot * 0.6);
    var yFor = function (v) { return padT + innerH - (clampPct(v) / 100) * innerH; };
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-labelledby="chart-title chart-desc" preserveAspectRatio="xMidYMid meet">');
    parts.push('<title id="chart-title">Projected attendance by scenario</title>');
    parts.push('<desc id="chart-desc">Bar chart of projected attendance percent for each scenario, with the target line.</desc>');
    [0, 25, 50, 75, 100].forEach(function (g) {
      var y = yFor(g);
      parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="#F2D9A0" stroke-width="1"/>');
      parts.push('<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#747474">' + g + '</text>');
    });
    var ty = yFor(target);
    parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty + '" y2="' + ty + '" stroke="#D93025" stroke-width="1.5" stroke-dasharray="5 4"/>');
    parts.push('<text x="' + (W - padR) + '" y="' + (ty - 4) + '" text-anchor="end" font-size="11" fill="#D93025">Target ' + target + '%</text>');
    rows.forEach(function (r, i) {
      var x = padL + i * slot + (slot - barW) / 2;
      var y = yFor(r.projectedPercentage);
      var h = padT + innerH - y;
      var color = r.projectedPercentage >= target ? '#27834A' : '#FF8000';
      parts.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) + '" height="' + h.toFixed(2) + '" fill="' + color + '" rx="3"><title>' + escapeXml(r.scenario) + ': ' + E.formatPercent(r.projectedPercentage) + '</title></rect>');
      parts.push('<text x="' + (x + barW / 2).toFixed(2) + '" y="' + (y - 4).toFixed(2) + '" text-anchor="middle" font-size="10" fill="#202020">' + r.projectedPercentage.toFixed(1) + '</text>');
      parts.push('<text x="' + (x + barW / 2).toFixed(2) + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="10" fill="#747474">' + escapeXml(shortLabel(r.scenario)) + '</text>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  function shortLabel(s) {
    return s.replace('Attend ', 'A').replace('Miss ', 'M').replace(' days', 'd').replace(' day', 'd').replace('Custom mixed', 'Custom').replace('Current', 'Now');
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- target planner ---------- */

  function buildTargetSelect() {
    // The Target Planner seeds from the saved settings target on first view (see renderPlanner).
    // Changing settings resets that seed so the planner follows the new target.
    delete $('plan-target').dataset.init;
  }

  function renderPlanner() {
    if (!$('plan-target').dataset.init) {
      var preset = String(state.settings.targetPercent);
      var presetOptions = Array.prototype.map.call($('plan-target').options, function (o) { return o.value; });
      $('plan-target').value = presetOptions.indexOf(preset) !== -1 ? preset : 'custom';
      $('plan-custom').value = preset;
      $('plan-target').dataset.init = '1';
    }
    togglePlanCustom();
  }

  function togglePlanCustom() {
    $('plan-custom-wrap').hidden = $('plan-target').value !== 'custom';
  }

  function runPlanner() {
    setText('plan-custom-error', '');
    setText('plan-status', '');
    $('plan-result').innerHTML = '';
    var b = baseline();
    if (!b) { setText('plan-status', 'Calculate your attendance first.'); return; }
    var raw = $('plan-target').value === 'custom' ? $('plan-custom').value : $('plan-target').value;
    try {
      var r = E.calculateRequiredLectures(b, raw, state.settings.lecturesPerDay);
      var box = $('plan-result');
      var lines = [
        'Current = ' + E.formatPercent(r.currentPercentage) + ' (target ' + r.targetPercent + '%)'
      ];
      if (r.alreadyReached) {
        lines.push('Your attendance target has been reached. No additional lectures are needed.');
      } else {
        lines.push('Required additional lectures = ' + r.requiredLectures);
        lines.push('Required college days = ceil(' + r.requiredLectures + ' / ' + state.settings.lecturesPerDay + ') = ' + r.requiredCollegeDays);
        lines.push('Projected total lectures = ' + r.projectedTotal);
        lines.push('Projected attendance = 100 - ((' + r.projectedEffectiveAbsent + '/' + r.projectedTotal + ')*100) = ' + E.formatPercent(r.projectedPercentage));
        lines.push('Your projected attendance reaches your selected target.');
      }
      lines.forEach(function (t) { var p = document.createElement('p'); p.className = 'mono'; p.textContent = t; box.appendChild(p); });
      setText('plan-status', r.alreadyReached ? E.STATUS_MESSAGES.reached : E.STATUS_MESSAGES.projectedReaches);
    } catch (err) {
      if (err instanceof E.ValidationError) {
        if (err.errors.targetPercent) setText('plan-custom-error', err.errors.targetPercent);
        setText('plan-status', E.STATUS_MESSAGES.invalid);
        return;
      }
      throw err;
    }
  }

  /* ---------- home ---------- */

  function renderHome() {
    applyWelcome();
    renderHistory();
  }

  /* ---------- init ---------- */

  function init() {
    loadAndApplySettings();
    renderHistory();
    renderScenarioTable();
    renderPredictorBaseline();

    $('menu-toggle').addEventListener('click', toggleMenu);
    document.querySelectorAll('[data-route]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        var route = a.getAttribute('data-route');
        if (a.tagName === 'A') {
          ev.preventDefault();
          var focus = a.getAttribute('data-focus');
          history.replaceState(null, '', '#' + route);
          showView(route, focus);
        }
      });
    });
    window.addEventListener('hashchange', routeFromHash);

    $('calc-form').addEventListener('submit', calculate);
    $('calc-reset').addEventListener('click', resetCalculator);
    $('calc-copy').addEventListener('click', copyCalculationResult);

    $('settings-form').addEventListener('submit', saveSettingsFromForm);
    $('set-reset').addEventListener('click', resetSettingsToDefaults);

    $('pred-tool').addEventListener('change', togglePredictorPanels);
    document.querySelectorAll('[data-attend]').forEach(function (b) {
      b.addEventListener('click', function () { quickAttend(b.getAttribute('data-attend')); });
    });
    document.querySelectorAll('[data-miss]').forEach(function (b) {
      b.addEventListener('click', function () { quickMiss(b.getAttribute('data-miss')); });
    });
    $('pred-run').addEventListener('click', runPredictor);
    $('imp-run').addEventListener('click', runImpact);
    $('plan-target').addEventListener('change', function () { togglePlanCustom(); });
    $('plan-run').addEventListener('click', runPlanner);
    $('sar-quick').addEventListener('input', runQuickSar);
    $('history-clear').addEventListener('click', clearHistoryUI);
    $('medical-form').addEventListener('submit', runMedical);
    $('medical-reset').addEventListener('click', resetMedical);

    togglePredictorPanels();
        routeFromHash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
// Backend API URL (Local testing ke liye http://localhost:5000, deploy hone ke baad Render URL)
const BACKEND_URL = "http://localhost:5000";

const modal = document.getElementById("erpModal");
const openModalBtn = document.getElementById("openErpModalBtn");
const closeModalBtn = document.getElementById("closeErpModalBtn");
const submitBtn = document.getElementById("erpSubmitBtn");
const statusMsg = document.getElementById("erpStatusMsg");
const lastSyncedText = document.getElementById("lastSyncedText");

// Modal toggle
if (openModalBtn) openModalBtn.onclick = () => modal.style.display = "flex";
if (closeModalBtn) closeModalBtn.onclick = () => modal.style.display = "none";

// 1. Check if user already synced earlier (Auto-Load on Page Open)
async function checkExistingUser() {
    const token = localStorage.getItem("attendwise_token");
    if (!token) return;

    try {
        const res = await fetch(`${BACKEND_URL}/api/my-attendance`, {
            headers: { "Authorization": token }
        });
        const result = await res.json();
        if (result.success) {
            applyAttendanceData(result.user.attended, result.user.total, result.user.last_synced);
        }
    } catch (err) {
        console.warn("Offline or backend unreachable, using cached local data.");
    }
}

// 2. Login & Sync Button Handler
if (submitBtn) {
    submitBtn.onclick = async () => {
        const username = document.getElementById("erpRoll").value.trim();
        const password = document.getElementById("erpPass").value.trim();

        if (!username || !password) {
            statusMsg.innerText = "Please enter both Roll No and Password.";
            return;
        }

        statusMsg.innerText = "Syncing with ERP...";
        submitBtn.disabled = true;

        try {
            const res = await fetch(`${BACKEND_URL}/api/connect-erp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            if (data.success) {
                localStorage.setItem("attendwise_token", data.token);
                applyAttendanceData(data.data.attended, data.data.totalLectures, new Date());
                statusMsg.innerText = "Success! Synced.";
                setTimeout(() => {
                    modal.style.display = "none";
                    statusMsg.innerText = "";
                }, 1000);
            } else {
                statusMsg.innerText = data.message || "Login failed. Check credentials.";
            }
        } catch (err) {
            statusMsg.innerText = "Server down ya network error. Try again.";
        } finally {
            submitBtn.disabled = false;
        }
    };
}

// ==========================================
// ATTENDWISE PSIT ERP AUTOMATION ENGINE
// ==========================================
const ERP_BACKEND_URL = "http://localhost:5000";

// Exact Field Auto-Fill Engine
function fillInputsWithExactIds() {
    const raw = localStorage.getItem("attendwise_erp_data");
    if (!raw) return;

    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        return;
    }

    // Yahan 'const' ki jagah 'let' hona chahiye taaki value assign ho sake
    let totalLectures = data.totalLectures ?? 0;
    let absentOAA = data.totalAbsentWithOAA ?? 0;
    let oaa = data.oaa ?? 0;
    let pf = data.pf ?? 0;
    let attended = data.attended ?? (totalLectures - (absentOAA - oaa));
    let percentage = data.percentage ?? (totalLectures > 0 ? ((attended / totalLectures) * 100).toFixed(2) : 0);

    // 1. CALCULATOR INPUTS
    const inAbsent = document.getElementById("combinedAbsentOAA");
    const inOaa = document.getElementById("oaaAttendance");
    const inTotal = document.getElementById("totallectures");

    if (inAbsent && inAbsent.value != absentOAA) {
        inAbsent.value = absentOAA;
        inAbsent.dispatchEvent(new Event("input", { bubbles: true }));
        inAbsent.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (inOaa && inOaa.value != oaa) {
        inOaa.value = oaa;
        inOaa.dispatchEvent(new Event("input", { bubbles: true }));
        inOaa.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (inTotal && inTotal.value != totalLectures) {
        inTotal.value = totalLectures;
        inTotal.dispatchEvent(new Event("input", { bubbles: true }));
        inTotal.dispatchEvent(new Event("change", { bubbles: true }));
    }
    

    // 2. MEDICAL INPUTS
    const inMedTotal = document.getElementById("medical-total");
    const inMedAbsent = document.getElementById("medical-absent");
    if (inMedTotal && inMedTotal.value != totalLectures) {
        inMedTotal.value = totalLectures;
        inMedTotal.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (inMedAbsent && inMedAbsent.value != absentOAA) {
        inMedAbsent.value = absentOAA;
        inMedAbsent.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // 3. HOME SCREEN CARDS UPDATE

    // 3. HOME SCREEN CARDS UPDATE (Clean & Safe)
    const cardTotal = Number(data.totalLectures) || 0;
    const cardAbsentOAA = Number(data.totalAbsentWithOAA) || 0;
    const cardOAA = Number(data.oaa) || 0;
    
    // Net absent aur attended lectures
    const cardNetAbsent = Math.max(0, cardAbsentOAA - cardOAA);
    const cardAttended = Math.max(0, cardTotal - cardNetAbsent);

    // Percentages (Agar backend se ERP ka exact aya hai toh wo, nahi toh calculated)
    const finalWithoutPf = data.percentWithoutPf 
        ? data.percentWithoutPf 
        : (cardTotal > 0 ? ((cardAttended / cardTotal) * 100).toFixed(2) : "0.00");

    const finalWithPf = data.percentWithPf 
        ? data.percentWithPf 
        : (data.percentage || finalWithoutPf);

    // 1. With PF card update (Lectures attended / total hi rahenge)
    const elWithPf = document.getElementById("homePercentWithPf");
    const elLectWithPf = document.getElementById("homeLecturesWithPf");
    if (elWithPf) elWithPf.innerText = `${finalWithPf}%`;
    if (elLectWithPf) elLectWithPf.innerText = `${cardAttended} / ${cardTotal}`;

    // 2. Without PF card update
    const elWithoutPf = document.getElementById("homePercentWithoutPf");
    const elLectWithoutPf = document.getElementById("homeLecturesWithoutPf");
    if (elWithoutPf) elWithoutPf.innerText = `${finalWithoutPf}%`;
    if (elLectWithoutPf) elLectWithoutPf.innerText = `${cardAttended} / ${cardTotal}`;


    // 4. AUTO-TRIGGER CALCULATE BUTTON
    const calcBtns = document.querySelectorAll("button");
    for (let btn of calcBtns) {
        if (btn.innerText && btn.innerText.trim().toLowerCase() === "calculate") {
            btn.click();
            break;
        }
    }

    // 5. HEADER STATUS UPDATE
    const syncStatus = document.getElementById("lastSyncedText");
    if (syncStatus && data.lastSynced) {
        syncStatus.innerText = `Synced: ${new Date(data.lastSynced).toLocaleDateString()}`;
    }
}

// Global data save helper
function saveGlobalErpAttendance(erpData) {
    erpData.lastSynced = new Date().toISOString();
    localStorage.setItem("attendwise_erp_data", JSON.stringify(erpData));
    fillInputsWithExactIds();
}

// Modal and Button Bindings
function initErpSyncUI() {
    const modal = document.getElementById("erpModal");
    const openModalBtn = document.getElementById("openErpModalBtn");
    const closeModalBtn = document.getElementById("closeErpModalBtn");
    const submitBtn = document.getElementById("erpSubmitBtn");
    const statusMsg = document.getElementById("erpStatusMsg");

    if (openModalBtn) {
        openModalBtn.onclick = () => {
            if (modal) modal.style.display = "flex";
        };
    }

    if (closeModalBtn) {
        closeModalBtn.onclick = () => {
            if (modal) modal.style.display = "none";
        };
    }

    if (submitBtn) {
        submitBtn.onclick = async () => {
            const username = document.getElementById("erpRoll")?.value.trim();
            const password = document.getElementById("erpPass")?.value.trim();

            if (!username || !password) {
                if (statusMsg) statusMsg.innerText = "Roll No aur Password dono enter karein.";
                return;
            }

            if (statusMsg) statusMsg.innerText = "Syncing with ERP...";
            submitBtn.disabled = true;

            try {
                const res = await fetch(`${ERP_BACKEND_URL}/api/connect-erp`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password })
                });

                const json = await res.json();
                if (json.success) {
                    localStorage.setItem("attendwise_token", json.token);
                    saveGlobalErpAttendance(json.data);
                    if (statusMsg) statusMsg.innerText = "Synced successfully!";
                    setTimeout(() => {
                        if (modal) modal.style.display = "none";
                        if (statusMsg) statusMsg.innerText = "";
                    }, 800);
                } else {
                    if (statusMsg) statusMsg.innerText = json.message || "Login failed. Details check karein.";
                }
            } catch (err) {
                if (statusMsg) statusMsg.innerText = "Backend server unreachable (port 5000 check karein).";
            } finally {
                submitBtn.disabled = false;
            }
        };
    }
}

// Auto-Load on startup
async function checkSavedErpSession() {
    const token = localStorage.getItem("attendwise_token");
    if (!token) return;

    try {
        const res = await fetch(`${ERP_BACKEND_URL}/api/my-attendance`, {
            headers: { "Authorization": token }
        });
        const json = await res.json();
        if (json.success) {
            saveGlobalErpAttendance(json.data);
        }
    } catch (e) {
        // Fallback to local storage
        fillInputsWithExactIds();
    }
}

// Global Lifecycle Event Listeners
document.addEventListener("DOMContentLoaded", () => {
    initErpSyncUI();
    fillInputsWithExactIds();
    checkSavedErpSession();
});

window.addEventListener("hashchange", () => setTimeout(fillInputsWithExactIds, 80));
document.addEventListener("click", () => setTimeout(fillInputsWithExactIds, 120));
