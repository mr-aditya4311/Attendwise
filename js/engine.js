/*
 * AttendWise calculation engine.
 * Pure functions only: no DOM access, no storage. Works in the browser
 * (window.AttendEngine) and in Node (module.exports) for the test suite.
 *
 * CORE FORMULA
 *   effectiveAbsent = combinedAbsentOAA - oaaAttendance
 *   attendancePercentage = 100 - ((effectiveAbsent / totalLectures) * 100)
 * Values are kept unrounded internally; round only for display.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AttendEngine = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    displayName: 'Student',
    lecturesPerDay: 8,
    targetPercent: 75
  });

  const TARGET_PRESETS = Object.freeze([65, 70, 75, 80, 85, 90]);
  const INTEGER_PATTERN = /^\d+$/;
  const MAX_ITERATIONS = 1000000;

  class ValidationError extends Error {
    constructor(errors) {
      super('Invalid attendance input: ' + Object.keys(errors).join(', '));
      this.name = 'ValidationError';
      this.errors = errors;
    }
  }

  /* ---------- parsing and validation ---------- */

  // Accepts only plain digit strings (or non-negative safe integers).
  // Decimals, signs, exponents and blanks return null.
  function parseNonNegativeInt(raw) {
    if (typeof raw === 'number') {
      return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
    }
    const text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!INTEGER_PATTERN.test(text)) return null;
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
  }

  function parseTargetPercent(raw) {
    const text = String(raw === undefined || raw === null ? '' : raw).trim();
    if (text === '') return null;
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * validateAttendanceInputs: checks the three calculator inputs.
   * Returns { ok, errors, values } where errors is keyed by field name.
   * Nothing is clamped: invalid input is reported, never changed.
   */
  function validateAttendanceInputs(raw) {
    const errors = {};
    const values = {};
    const source = raw || {};

    const combined = parseNonNegativeInt(source.combinedAbsentOAA);
    const oaa = parseNonNegativeInt(source.oaaAttendance);
    const total = parseNonNegativeInt(source.totalLectures);

    if (combined === null) {
      errors.combinedAbsentOAA = isBlank(source.combinedAbsentOAA)
        ? 'Total Absent + OAA is required.'
        : 'Enter a whole number of 0 or more (no decimals or negatives).';
    } else values.combinedAbsentOAA = combined;

    if (oaa === null) {
      errors.oaaAttendance = isBlank(source.oaaAttendance)
        ? 'O.A. Attendance is required.'
        : 'Enter a whole number of 0 or more (no decimals or negatives).';
    } else values.oaaAttendance = oaa;

    if (total === null) {
      errors.totalLectures = isBlank(source.totalLectures)
        ? 'Total Lecture is required.'
        : 'Enter a whole number of 0 or more (no decimals or negatives).';
    } else if (total === 0) {
      errors.totalLectures = 'Total Lecture must be greater than 0.';
    } else values.totalLectures = total;

    if (combined !== null && oaa !== null && oaa > combined) {
      errors.oaaAttendance = 'O.A. Attendance cannot exceed Total Absent + OAA.';
    }
    if (combined !== null && total !== null && combined > total) {
      errors.combinedAbsentOAA = 'Total Absent + OAA cannot exceed Total Lecture.';
    }

    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
  }

  function assertCount(value, name) {
    const n = parseNonNegativeInt(value);
    if (n === null) {
      throw new ValidationError({ [name]: name + ' must be a non-negative whole number.' });
    }
    return n;
  }

  function assertLecturesPerDay(value) {
    const n = parseNonNegativeInt(value);
    if (n === null || n === 0) {
      throw new ValidationError({ lecturesPerDay: 'Lectures per college day must be a positive whole number.' });
    }
    return n;
  }

  function assertTarget(value) {
    const p = parseTargetPercent(value);
    if (p === null || !(p > 0 && p < 100)) {
      throw new ValidationError({ targetPercent: 'Target must be greater than 0 and less than 100.' });
    }
    return p;
  }

  // Baseline: { total: T, absent: A } where A is effectiveAbsent.
  function assertBaseline(base) {
    const total = assertCount(base && base.total, 'total');
    const absent = assertCount(base && base.absent, 'absent');
    if (total <= 0) {
      throw new ValidationError({ total: 'Total lectures must be greater than 0.' });
    }
    if (absent > total) {
      throw new ValidationError({ absent: 'Effective absences cannot exceed total lectures.' });
    }
    return { total, absent };
  }

  /* ---------- core formula ---------- */

  function percentageOf(effectiveAbsent, totalLectures) {
    if (!(totalLectures > 0)) {
      throw new ValidationError({ totalLectures: 'Total lectures must be greater than 0.' });
    }
    const value = 100 - ((effectiveAbsent / totalLectures) * 100);
    if (!Number.isFinite(value)) {
      throw new ValidationError({ totalLectures: 'Calculation produced a non-finite value.' });
    }
    return value;
  }

  /**
   * calculateCurrentAttendance: the calculator card's core result.
   * Inputs must already be validated (or are checked here via throw).
   */
  function calculateCurrentAttendance(input) {
    const checked = validateAttendanceInputs(input);
    if (!checked.ok) throw new ValidationError(checked.errors);
    const { combinedAbsentOAA, oaaAttendance, totalLectures } = checked.values;
    const effectiveAbsent = combinedAbsentOAA - oaaAttendance;
    const attended = totalLectures - effectiveAbsent;
    return {
      combinedAbsentOAA,
      oaaAttendance,
      totalLectures,
      effectiveAbsent,
      attended,
      percentage: percentageOf(effectiveAbsent, totalLectures)
    };
  }

  /* ---------- future predictor ---------- */

  // Attend X days: total grows by days * lpd, absences unchanged.
  function calculateFutureAttendance(base, options) {
    const b = assertBaseline(base);
    const days = assertCount(options.days, 'days');
    const lpd = assertLecturesPerDay(options.lecturesPerDay);
    const lectures = days * lpd;
    const projectedTotal = b.total + lectures;
    const projectedAbsent = b.absent;
    return {
      days,
      attended: lectures,
      missed: 0,
      projectedTotal,
      projectedEffectiveAbsent: projectedAbsent,
      projectedPercentage: percentageOf(projectedAbsent, projectedTotal)
    };
  }

  // Miss X days: total grows by missed lectures, absences grow by the same amount.
  function simulateAbsence(base, options) {
    const b = assertBaseline(base);
    const days = assertCount(options.days, 'days');
    const lpd = assertLecturesPerDay(options.lecturesPerDay);
    const missed = days * lpd;
    const projectedTotal = b.total + missed;
    const projectedAbsent = b.absent + missed;
    return {
      days,
      attended: 0,
      missed,
      projectedTotal,
      projectedEffectiveAbsent: projectedAbsent,
      projectedPercentage: percentageOf(projectedAbsent, projectedTotal)
    };
  }

  /**
   * calculateMixedScenario: fully attended days, fully absent days and partial
   * days where some lectures are attended. partialAttended must be
   * <= partialDays * lecturesPerDay.
   */
  function calculateMixedScenario(base, options) {
    const b = assertBaseline(base);
    const lpd = assertLecturesPerDay(options.lecturesPerDay);
    const fullyAttendedDays = assertCount(options.fullyAttendedDays, 'fullyAttendedDays');
    const fullyAbsentDays = assertCount(options.fullyAbsentDays, 'fullyAbsentDays');
    const partialDays = assertCount(options.partialDays, 'partialDays');
    const partialAttended = assertCount(options.partialAttended, 'partialAttended');
    const partialLectureSlots = partialDays * lpd;
    if (partialAttended > partialLectureSlots) {
      throw new ValidationError({
        partialAttended: 'Partial lectures attended cannot exceed partial days × lectures per day (' + partialLectureSlots + ').'
      });
    }
    const addedLectures = (fullyAttendedDays + fullyAbsentDays + partialDays) * lpd;
    const attended = fullyAttendedDays * lpd + partialAttended;
    const missed = fullyAbsentDays * lpd + (partialLectureSlots - partialAttended);
    const projectedTotal = b.total + addedLectures;
    const projectedAbsent = b.absent + missed;
    return {
      fullyAttendedDays,
      fullyAbsentDays,
      partialDays,
      partialAttended,
      attended,
      missed,
      projectedTotal,
      projectedEffectiveAbsent: projectedAbsent,
      projectedPercentage: percentageOf(projectedAbsent, projectedTotal)
    };
  }

  /* ---------- target planner ---------- */

  /**
   * calculateRequiredLectures: how many more lectures must be attended (total
   * grows, absences unchanged) to reach targetPercent. The closed-form estimate
   * is ceil(A / (1 - p) - T); the result is verified with the projected formula
   * and bumped if floating point rounding falls short.
   */
  function calculateRequiredLectures(base, targetPercent, lecturesPerDay) {
    const b = assertBaseline(base);
    const target = assertTarget(targetPercent);
    const lpd = assertLecturesPerDay(lecturesPerDay);
    const currentPercentage = percentageOf(b.absent, b.total);

    if (currentPercentage >= target) {
      return {
        alreadyReached: true,
        currentPercentage,
        targetPercent: target,
        requiredLectures: 0,
        requiredCollegeDays: 0,
        projectedTotal: b.total,
        projectedEffectiveAbsent: b.absent,
        projectedPercentage: currentPercentage
      };
    }

    const p = target / 100;
    let required = Math.max(0, Math.ceil((b.absent / (1 - p)) - b.total));
    let guard = 0;
    while (percentageOf(b.absent, b.total + required) < target) {
      required += 1;
      guard += 1;
      if (guard > MAX_ITERATIONS) {
        throw new ValidationError({ targetPercent: 'Could not converge on a required lecture count.' });
      }
    }
    const projectedTotal = b.total + required;
    return {
      alreadyReached: false,
      currentPercentage,
      targetPercent: target,
      requiredLectures: required,
      requiredCollegeDays: Math.ceil(required / lpd),
      projectedTotal,
      projectedEffectiveAbsent: b.absent,
      projectedPercentage: percentageOf(b.absent, projectedTotal)
    };
  }

  /* ---------- attendance impact ---------- */

  /**
   * calculateAttendanceImpact: custom attend/miss lecture counts.
   * attend adds to total only; miss adds to total and to absences.
   */
  function calculateAttendanceImpact(base, options) {
    const b = assertBaseline(base);
    const attendLectures = assertCount(options.attendLectures, 'attendLectures');
    const missLectures = assertCount(options.missLectures, 'missLectures');
    const target = assertTarget(options.targetPercent);

    const currentPercentage = percentageOf(b.absent, b.total);
    const projectedTotal = b.total + attendLectures + missLectures;
    const projectedEffectiveAbsent = b.absent + missLectures;
    const projectedPercentage = percentageOf(projectedEffectiveAbsent, projectedTotal);
    const targetAchieved = projectedPercentage >= target;

    let additionalLecturesNeeded = 0;
    if (!targetAchieved) {
      const p = target / 100;
      let extra = Math.max(0, Math.ceil((projectedEffectiveAbsent / (1 - p)) - projectedTotal));
      let guard = 0;
      while (percentageOf(projectedEffectiveAbsent, projectedTotal + extra) < target) {
        extra += 1;
        guard += 1;
        if (guard > MAX_ITERATIONS) {
          throw new ValidationError({ targetPercent: 'Could not converge on an additional lecture count.' });
        }
      }
      additionalLecturesNeeded = extra;
    }

    return {
      currentPercentage,
      projectedTotal,
      projectedEffectiveAbsent,
      projectedPercentage,
      ppChange: projectedPercentage - currentPercentage,
      targetPercent: target,
      targetAchieved,
      additionalLecturesNeeded
    };
  }

  /* ---------- scenario comparison ---------- */

  /**
   * compareScenarios: rows for current, attend 5/10/15 days, miss 1/2 days and
   * a custom mixed scenario. The custom object holds fullyAttendedDays,
   * fullyAbsentDays, partialDays, partialAttended.
   */
  function compareScenarios(base, options) {
    const b = assertBaseline(base);
    const lpd = assertLecturesPerDay(options.lecturesPerDay);
    const currentPercentage = percentageOf(b.absent, b.total);

    const rows = [];
    rows.push({
      key: 'current',
      scenario: 'Current',
      futureDays: 0,
      attended: 0,
      missed: 0,
      projectedTotal: b.total,
      projectedEffectiveAbsent: b.absent,
      projectedPercentage: currentPercentage,
      differenceFromCurrent: 0
    });

    [5, 10, 15].forEach(function (days) {
      const r = calculateFutureAttendance(b, { days, lecturesPerDay: lpd });
      rows.push(makeRow('attend' + days, 'Attend ' + days + ' days', days, r, currentPercentage));
    });

    [1, 2].forEach(function (days) {
      const r = simulateAbsence(b, { days, lecturesPerDay: lpd });
      rows.push(makeRow('miss' + days, 'Miss ' + days + (days === 1 ? ' day' : ' days'), days, r, currentPercentage));
    });

    const custom = options.custom || {};
    const mixed = calculateMixedScenario(b, {
      lecturesPerDay: lpd,
      fullyAttendedDays: custom.fullyAttendedDays || 0,
      fullyAbsentDays: custom.fullyAbsentDays || 0,
      partialDays: custom.partialDays || 0,
      partialAttended: custom.partialAttended || 0
    });
    rows.push(makeRow('custom', 'Custom mixed', mixed.fullyAttendedDays + mixed.fullyAbsentDays + mixed.partialDays, mixed, currentPercentage));

    return rows;
  }

  function makeRow(key, label, futureDays, result, currentPercentage) {
    return {
      key,
      scenario: label,
      futureDays,
      attended: result.attended,
      missed: result.missed,
      projectedTotal: result.projectedTotal,
      projectedEffectiveAbsent: result.projectedEffectiveAbsent,
      projectedPercentage: result.projectedPercentage,
      differenceFromCurrent: result.projectedPercentage - currentPercentage
    };
  }

  /* ---------- status and display helpers ---------- */

  const STATUS_MESSAGES = Object.freeze({
    reached: 'Your attendance target has been reached.',
    belowTarget: 'Your attendance is below your selected target.',
    projectedReaches: 'Your projected attendance reaches your selected target.',
    invalid: 'Please correct the input values before calculating.'
  });

  function currentStatus(percentage, targetPercent) {
    return percentage >= targetPercent ? STATUS_MESSAGES.reached : STATUS_MESSAGES.belowTarget;
  }

  function formatPercent(value) {
    return Number(value).toFixed(2) + '%';
  }

  function formatSigned(value) {
    const rounded = Number(value).toFixed(2);
    return (value > 0 && rounded !== '0.00' ? '+' : '') + rounded + ' pp';
  }

  /**
   * Builds the substituted-formula breakdown lines for the calculator card.
   */
  function buildBreakdown(result) {
    const eff = result.effectiveAbsent;
    const T = result.totalLectures;
    return [
      'Effective Absent = ' + result.combinedAbsentOAA + ' - ' + result.oaaAttendance + ' = ' + eff,
      'Attendance = 100 - ((' + eff + '/' + T + ')*100) = ' + formatPercent(result.percentage)
    ];
  }

  function buildCopyText(result, displayName) {
    const lines = [
      'AttendWise result' + (displayName ? ' for ' + displayName : ''),
      'Attendance: ' + formatPercent(result.percentage),
    ];
    return lines.concat(buildBreakdown(result)).join('\n');
  }

/* ---------- SAR simulation ---------- */

  /**
   * calculateSar: standalone SAR simulation.
   * Remaining Absent = totalAbsent - approvedSar
   * Before = ((total - totalAbsent) / total) * 100
   * After = ((total - remaining) / total) * 100
   * Total lectures stay unchanged. Simulation only.
   */
  function calculateSar(options) {
    const totalAbsent = assertCount(options.totalAbsent, 'totalAbsent');
    const approvedSar = assertCount(options.approvedSar, 'approvedSar');
    const total = assertCount(options.totalLectures, 'totalLectures');
    const errors = {};
    if (total <= 0) errors.totalLectures = 'Total lectures must be greater than 0.';
    if (totalAbsent > total) errors.totalAbsent = 'Total absent lectures cannot exceed total lectures.';
    if (approvedSar > totalAbsent) errors.approvedSar = 'Approved SAR lectures cannot exceed total absent lectures.';
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const remainingAbsent = totalAbsent - approvedSar;
    const beforePercentage = ((total - totalAbsent) / total) * 100;
    const afterPercentage = ((total - remainingAbsent) / total) * 100;
    return {
      totalAbsent,
      approvedSar,
      totalLectures: total,
      remainingAbsent,
      beforePercentage,
      afterPercentage,
      improvement: afterPercentage - beforePercentage
    };
  }

  /* ---------- medical attendance (standalone simulation) ---------- */

  /**
   * calculateMedical: approved medical leave simulation.
   * medicalLectures = medicalDays * lecturesPerDay
   * adjustedAbsences = max(0, totalAbsent - medicalLectures)
   * Total lectures stay unchanged. Simulation only, not the core formula.
   */
  function calculateMedical(options) {
    const src = options || {};
    const errors = {};
    const totalLectures = parseNonNegativeInt(src.totalLectures);
    const totalAbsent = parseNonNegativeInt(src.totalAbsent);
    const medicalDays = parseNonNegativeInt(src.medicalDays);
    const lecturesPerDay = parseNonNegativeInt(src.lecturesPerDay);

    if (totalLectures === null) {
      errors.totalLectures = isBlank(src.totalLectures)
        ? 'Total Lectures is required.'
        : 'Enter a whole number of 0 or more (no decimals or negatives).';
    } else if (totalLectures === 0) {
      errors.totalLectures = 'Total Lectures must be greater than 0.';
    }
    if (totalAbsent === null) {
      errors.totalAbsent = isBlank(src.totalAbsent)
        ? 'Total Absent Lectures is required.'
        : 'Enter a whole number of 0 or more (no decimals or negatives).';
    }
    if (medicalDays === null) {
      errors.medicalDays = isBlank(src.medicalDays)
        ? 'Approved Medical Days is required.'
        : 'Enter a whole number of 0 or more (no decimals or negatives).';
    }
    if (lecturesPerDay === null) {
      errors.lecturesPerDay = isBlank(src.lecturesPerDay)
        ? 'Lectures Per Day is required.'
        : 'Lectures per college day must be a positive whole number.';
    } else if (lecturesPerDay === 0) {
      errors.lecturesPerDay = 'Lectures per college day must be a positive whole number.';
    }
    if (totalAbsent !== null && totalLectures !== null && totalLectures > 0 && totalAbsent > totalLectures) {
      errors.totalAbsent = 'Total absent lectures cannot exceed total lectures.';
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const medicalLectures = medicalDays * lecturesPerDay;
    const adjustedAbsences = Math.max(0, totalAbsent - medicalLectures);
    const originalAttendance = ((totalLectures - totalAbsent) / totalLectures) * 100;
    const adjustedAttendance = Math.min(100, ((totalLectures - adjustedAbsences) / totalLectures) * 100);
    return {
      totalLectures,
      totalAbsent,
      medicalDays,
      lecturesPerDay,
      medicalLectures,
      adjustedAbsences,
      remainingAbsences: adjustedAbsences,
      originalAttendance,
      adjustedAttendance,
      improvement: adjustedAttendance - originalAttendance
    };
  }

  return {
    DEFAULT_SETTINGS,
    TARGET_PRESETS,
    STATUS_MESSAGES,
    ValidationError,
    parseNonNegativeInt,
    parseTargetPercent,
    validateAttendanceInputs,
    assertCount,
    percentageOf,
    calculateCurrentAttendance,
    calculateFutureAttendance,
    simulateAbsence,
    calculateMixedScenario,
    calculateRequiredLectures,
    calculateAttendanceImpact,
    compareScenarios,
    calculateSar,
    calculateMedical,
    currentStatus,
    formatPercent,
    formatSigned,
    buildBreakdown,
    buildCopyText
  };
});
