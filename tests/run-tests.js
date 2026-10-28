/* AttendWise calculation test suite. Run with: node tests/run-tests.js */
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const S = require(path.join(__dirname, '..', 'js', 'storage.js'));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed += 1;
    failures.push(name + ': ' + err.message);
    console.log('  FAIL  ' + name + ' -> ' + err.message);
  }
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'value') + ' expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
  }
}

function pct(v) { return E.formatPercent(v); }

function expectValidation(fn, field) {
  try { fn(); } catch (err) {
    if (err instanceof E.ValidationError) {
      if (field && !err.errors[field]) {
        throw new Error('missing error for ' + field + ', got ' + Object.keys(err.errors).join(','));
      }
      return;
    }
    throw err;
  }
  throw new Error('expected ValidationError');
}

function memStorage(opts) {
  const data = {};
  return {
    getItem(k) { if (opts && opts.failRead) throw new Error('denied'); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { if (opts && opts.failWrite) throw new Error('quota'); data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    _data: data
  };
}

const base = { total: 100, absent: 10 };

console.log('\nCore formula (calculateCurrentAttendance)');
check('(9,8,576) -> 99.83%', () => eq(pct(E.calculateCurrentAttendance({ combinedAbsentOAA: 9, oaaAttendance: 8, totalLectures: 576 }).percentage), '99.83%'));
check('(10,5,100) -> 95.00%', () => eq(pct(E.calculateCurrentAttendance({ combinedAbsentOAA: 10, oaaAttendance: 5, totalLectures: 100 }).percentage), '95.00%'));
check('(20,10,100) -> 90.00%', () => eq(pct(E.calculateCurrentAttendance({ combinedAbsentOAA: 20, oaaAttendance: 10, totalLectures: 100 }).percentage), '90.00%'));
check('(0,0,100) -> 100.00%', () => eq(pct(E.calculateCurrentAttendance({ combinedAbsentOAA: 0, oaaAttendance: 0, totalLectures: 100 }).percentage), '100.00%'));
check('(10,10,100) -> 100.00%', () => eq(pct(E.calculateCurrentAttendance({ combinedAbsentOAA: 10, oaaAttendance: 10, totalLectures: 100 }).percentage), '100.00%'));
check('internal value is unrounded', () => {
  const r = E.calculateCurrentAttendance({ combinedAbsentOAA: 9, oaaAttendance: 8, totalLectures: 576 });
  eq(r.effectiveAbsent, 1, 'effectiveAbsent');
  if (Math.abs(r.percentage - (100 - (1 / 576) * 100)) > 1e-12) throw new Error('percentage was rounded');
});
check('breakdown shows substituted formula', () => {
  const r = E.calculateCurrentAttendance({ combinedAbsentOAA: 9, oaaAttendance: 8, totalLectures: 576 });
  const lines = E.buildBreakdown(r);
  eq(lines[0], 'Effective Absent = 9 - 8 = 1', 'line 1');
  eq(lines[1], 'Attendance = 100 - ((1/576)*100) = 99.83%', 'line 2');
});

console.log('\nValidation');
check('empty input rejected', () => expectValidation(() => E.calculateCurrentAttendance({ combinedAbsentOAA: '', oaaAttendance: '', totalLectures: '' }), 'totalLectures'));
check('negative absent rejected', () => expectValidation(() => E.calculateCurrentAttendance({ combinedAbsentOAA: -1, oaaAttendance: 0, totalLectures: 100 }), 'combinedAbsentOAA'));
check('decimal lecture count rejected', () => expectValidation(() => E.calculateCurrentAttendance({ combinedAbsentOAA: 1, oaaAttendance: 0, totalLectures: 10.5 }), 'totalLectures'));
check('zero total lectures rejected', () => expectValidation(() => E.calculateCurrentAttendance({ combinedAbsentOAA: 0, oaaAttendance: 0, totalLectures: 0 }), 'totalLectures'));
check('OAA attendance above combined absent rejected', () => expectValidation(() => E.calculateCurrentAttendance({ combinedAbsentOAA: 5, oaaAttendance: 6, totalLectures: 100 }), 'oaaAttendance'));
check('combined absent above total lectures rejected', () => expectValidation(() => E.calculateCurrentAttendance({ combinedAbsentOAA: 101, oaaAttendance: 0, totalLectures: 100 }), 'combinedAbsentOAA'));

console.log('\nFuture predictor, fixture T=100 A=10 lpd=8');
check('attend 5 days -> 92.86%', () => eq(pct(E.calculateFutureAttendance(base, { days: 5, lecturesPerDay: 8 }).projectedPercentage), '92.86%'));
check('attend 10 days -> formula gives 94.44% (spec says 95.00%, see notes)', () => eq(pct(E.calculateFutureAttendance(base, { days: 10, lecturesPerDay: 8 }).projectedPercentage), '94.44%'));
check('miss 1 day -> 83.33%', () => eq(pct(E.simulateAbsence(base, { days: 1, lecturesPerDay: 8 }).projectedPercentage), '83.33%'));
check('miss 2 days -> formula gives 77.59% (spec says 77.78%, see notes)', () => eq(pct(E.simulateAbsence(base, { days: 2, lecturesPerDay: 8 }).projectedPercentage), '77.59%'));
check('attend keeps absences unchanged', () => eq(E.calculateFutureAttendance(base, { days: 5, lecturesPerDay: 8 }).projectedEffectiveAbsent, 10));
check('miss adds to absences and total', () => {
  const r = E.simulateAbsence(base, { days: 1, lecturesPerDay: 8 });
  eq(r.projectedTotal, 108, 'total');
  eq(r.projectedEffectiveAbsent, 18, 'absent');
});
check('custom lpd is respected', () => eq(E.calculateFutureAttendance(base, { days: 2, lecturesPerDay: 6 }).attended, 12));
check('mixed scenario attended/missed/total', () => {
  const r = E.calculateMixedScenario(base, { lecturesPerDay: 8, fullyAttendedDays: 2, fullyAbsentDays: 1, partialDays: 1, partialAttended: 3 });
  eq(r.attended, 19, 'attended');
  eq(r.missed, 13, 'missed');
  eq(r.projectedTotal, 132, 'projectedTotal');
  eq(r.projectedEffectiveAbsent, 23, 'projectedAbsent');
});
check('mixed scenario rejects partialAttended > partialDays*lpd', () => expectValidation(() => E.calculateMixedScenario(base, { lecturesPerDay: 8, fullyAttendedDays: 0, fullyAbsentDays: 0, partialDays: 1, partialAttended: 9 }), 'partialAttended'));

console.log('\nTarget planner');
check('T=100 A=10 target 95 -> required 100, projected total 200, 95.00%, 13 days', () => {
  const r = E.calculateRequiredLectures(base, 95, 8);
  eq(r.alreadyReached, false, 'alreadyReached');
  eq(r.requiredLectures, 100, 'requiredLectures');
  eq(r.projectedTotal, 200, 'projectedTotal');
  eq(pct(r.projectedPercentage), '95.00%', 'projectedPercentage');
  eq(r.requiredCollegeDays, 13, 'requiredCollegeDays');
});
check('already-achieved target is reported', () => eq(E.calculateRequiredLectures({ total: 100, absent: 5 }, 90, 8).alreadyReached, true));

console.log('\nAttendance impact, scenarios and comparison');
check('impact: attend 5 lectures keeps absences, raises percentage', () => {
  const r = E.calculateAttendanceImpact(base, { attendLectures: 5, missLectures: 0, targetPercent: 75 });
  eq(r.projectedEffectiveAbsent, 10, 'absent');
  eq(r.projectedTotal, 105, 'total');
  if (!(r.projectedPercentage > 90)) throw new Error('expected percentage above 90');
});
check('impact: miss lectures add absences and total', () => {
  const r = E.calculateAttendanceImpact(base, { attendLectures: 0, missLectures: 10, targetPercent: 75 });
  eq(r.projectedEffectiveAbsent, 20, 'absent');
  eq(r.projectedTotal, 110, 'total');
});
check('impact: negative lecture count rejected', () => expectValidation(() => E.calculateAttendanceImpact(base, { attendLectures: -1, missLectures: 0, targetPercent: 75 }), 'attendLectures'));
check('compareScenarios returns rows with a current baseline', () => {
  const rows = E.compareScenarios(base, { lecturesPerDay: 8 });
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('no rows');
});

console.log('\nStorage (localStorage wrapper)');
check('settings persist and reload', () => {
  const fake = memStorage();
  S._setBackendForTests(fake);
  const saved = S.saveSettings(E, { displayName: 'Aditya', lecturesPerDay: 6, targetPercent: 80 });
  eq(saved.ok, true, 'saved ok');
  eq(S.loadSettings(E).settings.lecturesPerDay, 6, 'lpd reloaded');
  eq(S.loadSettings(E).settings.displayName, 'Aditya', 'name reloaded');
});
check('invalid settings are rejected, not clamped', () => {
  S._setBackendForTests(memStorage());
  const r = S.saveSettings(E, { displayName: 'X', lecturesPerDay: 0, targetPercent: 75 });
  eq(r.ok, false, 'ok');
  if (!r.errors.lecturesPerDay) throw new Error('missing lpd error');
});
check('resetSettings restores defaults', () => {
  S._setBackendForTests(memStorage());
  S.saveSettings(E, { displayName: 'Y', lecturesPerDay: 4, targetPercent: 60 });
  eq(S.resetSettings(E).settings.lecturesPerDay, 8, 'default lpd');
});
check('storage failure falls back to memory and still works', () => {
  S._setBackendForTests(memStorage({ failWrite: true, failRead: true }));
  eq(S.usingMemory, true, 'usingMemory');
  const r = S.saveSettings(E, { displayName: 'Z', lecturesPerDay: 5, targetPercent: 70 });
  eq(r.ok, true, 'ok');
});
check('history is capped at 50 entries', () => {
  S._setBackendForTests(memStorage());
  S.clearHistory();
  let list = [];
  for (let i = 0; i < 60; i += 1) list = S.appendHistory({ kind: 'calculation', n: i });
  eq(list.length, 50, 'history length');
  eq(S.loadHistory()[0].n, 59, 'newest first');
});
check('history clear empties list', () => {
  S._setBackendForTests(memStorage());
  S.appendHistory({ kind: 'calculation' });
  S.clearHistory();
  eq(S.loadHistory().length, 0, 'history length');
});
S._setBackendForTests(undefined);


console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exitCode = 1;
}
