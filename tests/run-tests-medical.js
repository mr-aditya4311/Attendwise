/* AttendWise medical attendance test suite. Run with: node tests/run-tests-medical.js */
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));

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

function near(actual, expected, label, eps) {
  const tol = eps === undefined ? 1e-9 : eps;
  if (Math.abs(actual - expected) > tol) {
    throw new Error((label || 'value') + ' expected ~' + expected + ' got ' + actual);
  }
}

function throwsValidation(input, fieldKey) {
  try {
    E.calculateMedical(input);
  } catch (err) {
    if (!(err instanceof E.ValidationError)) throw new Error('wrong error type: ' + err.message);
    if (!(fieldKey in err.errors)) {
      throw new Error('expected error on ' + fieldKey + ', got ' + Object.keys(err.errors).join(','));
    }
    return err.errors;
  }
  throw new Error('expected ValidationError on ' + fieldKey);
}

console.log('Medical attendance tests');

check('example: 576 total, 20 absent, 2 medical days, 8 lpd', () => {
  const r = E.calculateMedical({ totalLectures: 576, totalAbsent: 20, medicalDays: 2, lecturesPerDay: 8 });
  eq(r.medicalLectures, 16, 'medicalLectures');
  eq(r.adjustedAbsences, 4, 'adjustedAbsences');
  eq(r.remainingAbsences, 4, 'remainingAbsences');
  eq(E.formatPercent(r.originalAttendance), '96.53%', 'original');
  eq(E.formatPercent(r.adjustedAttendance), '99.31%', 'adjusted');
  eq(E.formatSigned(r.improvement), '+2.78 pp', 'improvement');
  eq(r.totalLectures, 576, 'total unchanged');
});

check('example: total lectures is not reduced by medical lectures', () => {
  const r = E.calculateMedical({ totalLectures: 576, totalAbsent: 20, medicalDays: 2, lecturesPerDay: 8 });
  eq(r.totalLectures, 576, 'totalLectures');
  near(r.adjustedAttendance, ((576 - 4) / 576) * 100, 'adjusted formula');
  near(r.originalAttendance, ((576 - 20) / 576) * 100, 'original formula');
});

check('zero medical days leaves attendance unchanged', () => {
  const r = E.calculateMedical({ totalLectures: 100, totalAbsent: 25, medicalDays: 0, lecturesPerDay: 8 });
  eq(r.medicalLectures, 0, 'medicalLectures');
  eq(r.adjustedAbsences, 25, 'adjustedAbsences');
  near(r.improvement, 0, 'improvement');
  near(r.adjustedAttendance, r.originalAttendance, 'adjusted==original');
});

check('zero absences stays at 100% with zero improvement', () => {
  const r = E.calculateMedical({ totalLectures: 80, totalAbsent: 0, medicalDays: 3, lecturesPerDay: 8 });
  eq(r.adjustedAbsences, 0, 'adjustedAbsences');
  near(r.originalAttendance, 100, 'original');
  near(r.adjustedAttendance, 100, 'adjusted');
  near(r.improvement, 0, 'improvement');
  eq(r.remainingAbsences, 0, 'remainingAbsences');
});

check('medical lectures exceed absences: adjusted absences floor at 0, attendance caps at 100', () => {
  const r = E.calculateMedical({ totalLectures: 200, totalAbsent: 10, medicalDays: 5, lecturesPerDay: 8 });
  eq(r.medicalLectures, 40, 'medicalLectures');
  eq(r.adjustedAbsences, 0, 'adjustedAbsences');
  eq(r.remainingAbsences, 0, 'remainingAbsences');
  near(r.adjustedAttendance, 100, 'adjusted');
  if (r.adjustedAttendance > 100) throw new Error('adjusted above 100');
});

check('medical lectures exactly equal absences: adjusted 0', () => {
  const r = E.calculateMedical({ totalLectures: 100, totalAbsent: 16, medicalDays: 2, lecturesPerDay: 8 });
  eq(r.adjustedAbsences, 0, 'adjustedAbsences');
  near(r.adjustedAttendance, 100, 'adjusted');
});

check('validation: totalLectures 0 rejected', () => {
  const errs = throwsValidation({ totalLectures: 0, totalAbsent: 0, medicalDays: 0, lecturesPerDay: 8 }, 'totalLectures');
  eq(errs.totalLectures, 'Total Lectures must be greater than 0.', 'message');
});

check('validation: negative totalAbsent rejected', () => {
  throwsValidation({ totalLectures: 100, totalAbsent: -1, medicalDays: 0, lecturesPerDay: 8 }, 'totalAbsent');
});

check('validation: negative medicalDays rejected', () => {
  throwsValidation({ totalLectures: 100, totalAbsent: 5, medicalDays: -2, lecturesPerDay: 8 }, 'medicalDays');
});

check('validation: totalAbsent greater than totalLectures rejected', () => {
  const errs = throwsValidation({ totalLectures: 50, totalAbsent: 51, medicalDays: 0, lecturesPerDay: 8 }, 'totalAbsent');
  eq(errs.totalAbsent, 'Total absent lectures cannot exceed total lectures.', 'message');
});

check('validation: empty fields reported as required', () => {
  const errs = throwsValidation({ totalLectures: '', totalAbsent: '', medicalDays: '', lecturesPerDay: '' }, 'totalLectures');
  eq(errs.totalLectures, 'Total Lectures is required.', 'totalLectures');
  eq(errs.totalAbsent, 'Total Absent Lectures is required.', 'totalAbsent');
  eq(errs.medicalDays, 'Approved Medical Days is required.', 'medicalDays');
  eq(errs.lecturesPerDay, 'Lectures Per Day is required.', 'lecturesPerDay');
});

check('validation: lecturesPerDay 0 rejected', () => {
  throwsValidation({ totalLectures: 100, totalAbsent: 5, medicalDays: 1, lecturesPerDay: 0 }, 'lecturesPerDay');
});

check('validation: decimal input rejected', () => {
  throwsValidation({ totalLectures: 100.5, totalAbsent: 5, medicalDays: 1, lecturesPerDay: 8 }, 'totalLectures');
});

check('validation: multiple bad fields reported together', () => {
  const errs = throwsValidation({ totalLectures: 0, totalAbsent: -3, medicalDays: -1, lecturesPerDay: 0 }, 'totalLectures');
  ['totalLectures', 'totalAbsent', 'medicalDays', 'lecturesPerDay'].forEach((k) => {
    if (!(k in errs)) throw new Error('missing error for ' + k);
  });
});

console.log('');
console.log('Medical results: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
