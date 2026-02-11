import { countAssertionMatches, resolveConditionValue } from './resolve.js';

export function evaluateAssertionsForRequest(request, assertions, allRequests) {
  if (!request || !Array.isArray(assertions)) return [];
  const results = [];
  assertions.forEach(assertion => {
    const isPageScope = assertion.scope === 'page';
    const { conditionResults, applicable } = resolveRequestConditionResults(assertion, request);

    if (!applicable) return;

    let passed = assertion.logic === 'any'
      ? conditionResults.some(c => c.passed)
      : conditionResults.every(c => c.passed);

    let countResult = null;
    if (isPageScope && assertion.count && assertion.value !== undefined) {
      const count = countAssertionMatches(assertion, allRequests, request, evaluateCondition);
      const countPassed = evaluateCount(assertion.count, count, assertion.value);
      passed = countPassed;
      countResult = {
        count: assertion.count,
        expected: assertion.value,
        actual: count
      };
    }

    results.push({
      id: assertion.id,
      title: assertion.title,
      description: assertion.description,
      status: passed ? 'passed' : 'failed',
      applicable,
      logic: assertion.logic,
      scope: assertion.scope,
      conditions: conditionResults,
      count: countResult
    });
  });

  return results;
}

function resolveRequestConditionResults(assertion, request) {
  const conditionResults = assertion.conditions.map(condition => {
    const resolved = resolveConditionValue(condition, request);
    const passed = evaluateCondition(condition, resolved.values);
    return {
      ...condition,
      passed,
      actual: resolved.values,
      used: resolved.used
    };
  });
  const applicable = conditionResults.some(c => c.used);
  return { conditionResults, applicable };
}


export function evaluateCondition(condition, values) {
  const operator = condition.operator || 'exists';
  const expected = condition.expected;
  const list = Array.isArray(values) ? values : [values];
  const hasValue = list.some(v => v !== undefined && v !== null && String(v).length > 0);

  switch (operator) {
    case 'exists':
      return hasValue;
    case 'not_exists':
      return !hasValue;
    case 'equals':
      return list.some(v => String(v) === String(expected));
    case 'contains':
      return list.some(v => String(v).includes(String(expected)));
    case 'starts_with':
      return list.some(v => String(v).startsWith(String(expected)));
    case 'ends_with':
      return list.some(v => String(v).endsWith(String(expected)));
    case 'regex': {
      try {
        const regex = new RegExp(String(expected));
        return list.some(v => regex.test(String(v)));
      } catch {
        return false;
      }
    }
    case 'in': {
      const expectedList = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      return list.some(v => expectedList.includes(String(v)));
    }
    case 'not_in': {
      const expectedList = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      return list.every(v => !expectedList.includes(String(v)));
    }
    case 'gt':
      return list.some(v => Number(v) > Number(expected));
    case 'gte':
      return list.some(v => Number(v) >= Number(expected));
    case 'lt':
      return list.some(v => Number(v) < Number(expected));
    case 'lte':
      return list.some(v => Number(v) <= Number(expected));
    case 'range': {
      const [min, max] = Array.isArray(expected) ? expected : [];
      return list.some(v => Number(v) >= Number(min) && Number(v) <= Number(max));
    }
    default:
      return false;
  }
}

export function evaluateCount(mode, actual, expected) {
  const expectedNumber = Number(expected);
  if (!Number.isFinite(expectedNumber)) return false;
  if (mode === 'at_least') return actual >= expectedNumber;
  if (mode === 'at_most') return actual <= expectedNumber;
  return actual === expectedNumber;
}
