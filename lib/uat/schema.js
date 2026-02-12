/**
 * Normalize a raw UAT config into a consistent structure.
 * @param {object} config
 * @returns {object}
 */
export function normalizeUatConfig(config) {
  if (!config || typeof config !== 'object') return { assertions: [] };
  const assertions = Array.isArray(config.assertions) ? config.assertions : [];
  const globalConfig = normalizeGlobalConfig(config.global || null);
  return {
    ...config,
    global: globalConfig,
    assertions: assertions.map(assertion => normalizeAssertion(assertion))
  };
}

/**
 * Normalize a single assertion definition.
 * @param {object} assertion
 * @returns {object}
 */
function normalizeAssertion(assertion) {
  const conditions = Array.isArray(assertion.conditions) ? assertion.conditions : [];
  const validations = Array.isArray(assertion.validations) ? assertion.validations : [];
  return {
    id: assertion.id || `assertion-${Math.random().toString(16).slice(2)}`,
    title: assertion.title || assertion.id || 'Assertion',
    description: assertion.description || '',
    conditionsLogic: assertion.conditionsLogic === 'any' ? 'any' : 'all',
    conditions: conditions.map(cond => normalizeCondition(cond)),
    validations: validations.map(cond => normalizeCondition(cond)),
    scope: assertion.scope === 'page' ? 'page' : 'request',
    count: assertion.count || null,
    value: Number.isFinite(assertion.value) ? assertion.value : assertion.value,
  };
}

/**
 * Normalize global UAT rules.
 * @param {object|null} globalConfig
 * @returns {object}
 */
function normalizeGlobalConfig(globalConfig) {
  if (!globalConfig || typeof globalConfig !== 'object') {
    return {
      includeServices: [],
      excludeServices: [],
      includeConditions: [],
      excludeConditions: []
    };
  }
  const includeServices = Array.isArray(globalConfig.includeServices) ? globalConfig.includeServices : [];
  const excludeServices = Array.isArray(globalConfig.excludeServices) ? globalConfig.excludeServices : [];
  const includeConditions = Array.isArray(globalConfig.includeConditions) ? globalConfig.includeConditions : [];
  const excludeConditions = Array.isArray(globalConfig.excludeConditions) ? globalConfig.excludeConditions : [];
  return {
    includeServices,
    excludeServices,
    includeConditions: includeConditions.map(cond => normalizeCondition(cond)),
    excludeConditions: excludeConditions.map(cond => normalizeCondition(cond))
  };
}

/**
 * Normalize a single condition definition.
 * @param {object} condition
 * @returns {object}
 */
function normalizeCondition(condition) {
  const cond = condition || {};
  return {
    source: cond.source || 'payload',
    path: cond.path || '',
    operator: cond.operator || 'exists',
    expected: cond.expected
  };
}

/**
 * Build a sample UAT template with examples for each operator.
 * @param {string} [siteId='example-site']
 * @returns {object}
 */
export function buildUatTemplate(siteId = 'example-site') {
  return {
    siteId,
    siteName: siteId,
    global: {
      includeServices: ['adobe-analytics', 'adobe-edge'],
      excludeServices: ['meta'],
      excludeConditions: [
        {
          source: 'payload',
          path: 'events[0].xdm.eventType',
          operator: 'equals',
          expected: 'web.webinteraction.linkClicks'
        }
      ],
      includeConditions: []
    },
    assertions: [
      {
        id: 'pageview-once',
        title: 'Pageview fires only once',
        description: 'Ensure pageview event fires only once per page view.',
        conditionsLogic: 'all',
        conditions: [
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.siteSection',
            operator: 'equals',
            expected: 'Homepage'
          }
        ],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'equals',
            expected: 'web.webpagedetails.pageViews'
          }
        ],
        scope: 'page',
        count: 'exactly',
        value: 1
      },
      {
        id: 'page-name-present',
        title: 'Page name is present',
        description: 'Ensure page name is set in Adobe Analytics eVar.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0]._experience.analytics.customDimensions.eVars.eVar41',
            operator: 'exists'
          }
        ]
      },
      {
        id: 'link-click-event',
        title: 'Link click event type',
        description: 'Example of equals + request scope.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'equals',
            expected: 'web.webinteraction.linkClicks'
          }
        ]
      },
      {
        id: 'page-name-contains',
        title: 'Page name contains keyword',
        description: 'Example of contains operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0]._experience.analytics.customDimensions.eVars.eVar41',
            operator: 'contains',
            expected: 'Home'
          }
        ]
      },
      {
        id: 'event-type-prefix',
        title: 'Event type starts with web.',
        description: 'Example of starts_with operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'starts_with',
            expected: 'web.'
          }
        ]
      },
      {
        id: 'event-type-suffix',
        title: 'Event type ends with pageViews',
        description: 'Example of ends_with operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'ends_with',
            expected: 'pageViews'
          }
        ]
      },
      {
        id: 'event-type-regex',
        title: 'Event type matches regex',
        description: 'Example of regex operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'regex',
            expected: '^web\\.'
          }
        ]
      },
      {
        id: 'event-type-in-list',
        title: 'Event type in list',
        description: 'Example of in operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'in',
            expected: ['web.webpagedetails.pageViews', 'web.webinteraction.linkClicks']
          }
        ]
      },
      {
        id: 'event-type-not-in-list',
        title: 'Event type not in list',
        description: 'Example of not_in operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'not_in',
            expected: ['web.webinteraction.linkClicks']
          }
        ]
      },
      {
        id: 'page-name-not-exists',
        title: 'Page name not exists',
        description: 'Example of not_exists operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0]._experience.analytics.customDimensions.eVars.eVar41',
            operator: 'not_exists'
          }
        ]
      },
      {
        id: 'numeric-gt',
        title: 'Numeric greater than',
        description: 'Example of gt operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.pageViews.value',
            operator: 'gt',
            expected: 0
          }
        ]
      },
      {
        id: 'numeric-gte',
        title: 'Numeric greater than or equal',
        description: 'Example of gte operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.pageViews.value',
            operator: 'gte',
            expected: 1
          }
        ]
      },
      {
        id: 'numeric-lt',
        title: 'Numeric less than',
        description: 'Example of lt operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.pageViews.value',
            operator: 'lt',
            expected: 10
          }
        ]
      },
      {
        id: 'numeric-lte',
        title: 'Numeric less than or equal',
        description: 'Example of lte operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.pageViews.value',
            operator: 'lte',
            expected: 1
          }
        ]
      },
      {
        id: 'numeric-range',
        title: 'Numeric range',
        description: 'Example of range operator.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.pageViews.value',
            operator: 'range',
            expected: [1, 5]
          }
        ]
      },
      {
        id: 'query-param-equals',
        title: 'Query parameter equals',
        description: 'Example using query source.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'query',
            path: 'configId',
            operator: 'equals',
            expected: 'your-config-id'
          }
        ]
      },
      {
        id: 'header-exists',
        title: 'Header exists',
        description: 'Example using headers source.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'headers',
            path: 'content-type',
            operator: 'exists'
          }
        ]
      },
      {
        id: 'raw-contains',
        title: 'Raw body contains',
        description: 'Example using raw source.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'raw',
            path: '',
            operator: 'contains',
            expected: 'pageName'
          }
        ]
      },
      {
        id: 'pageview-at-least-once',
        title: 'Pageview fires at least once',
        description: 'Example of page scope with at_least count.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'equals',
            expected: 'web.webpagedetails.pageViews'
          }
        ],
        scope: 'page',
        count: 'at_least',
        value: 1
      },
      {
        id: 'pageview-at-most-once',
        title: 'Pageview fires at most once',
        description: 'Example of page scope with at_most count.',
        conditionsLogic: 'all',
        conditions: [],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'equals',
            expected: 'web.webpagedetails.pageViews'
          }
        ],
        scope: 'page',
        count: 'at_most',
        value: 1
      },
      {
        id: 'any-condition-example',
        title: 'Any conditions example',
        description: 'Example using conditionsLogic any.',
        conditionsLogic: 'any',
        conditions: [
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.siteSection',
            operator: 'equals',
            expected: 'Homepage'
          },
          {
            source: 'payload',
            path: 'events[0].web.webPageDetails.siteSection',
            operator: 'equals',
            expected: 'Landing'
          }
        ],
        validations: [
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'equals',
            expected: 'web.webpagedetails.pageViews'
          },
          {
            source: 'payload',
            path: 'events[0].xdm.eventType',
            operator: 'equals',
            expected: 'web.webinteraction.linkClicks'
          }
        ]
      }
    ]
  };
}

/**
 * Validate a UAT config and return a list of errors.
 * @param {object} config
 * @returns {Array<string>}
 */
export function validateUatConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return ['Config must be a JSON object.'];
  }
  if (config.global && typeof config.global === 'object') {
    const global = config.global;
    if (global.includeServices && !Array.isArray(global.includeServices)) {
      errors.push('Global includeServices must be an array of service IDs.');
    }
    if (global.excludeServices && !Array.isArray(global.excludeServices)) {
      errors.push('Global excludeServices must be an array of service IDs.');
    }
    if (global.includeConditions && !Array.isArray(global.includeConditions)) {
      errors.push('Global includeConditions must be an array of condition objects.');
    }
    if (global.excludeConditions && !Array.isArray(global.excludeConditions)) {
      errors.push('Global excludeConditions must be an array of condition objects.');
    }
    (global.includeConditions || []).forEach((condition, cIdx) => {
      if (!condition || typeof condition !== 'object') {
        errors.push(`Global include condition ${cIdx + 1} must be an object.`);
        return;
      }
      if (!condition.path && condition.source !== 'raw') {
        errors.push(`Global include condition ${cIdx + 1} must include a path.`);
      }
      if (!condition.operator) {
        errors.push(`Global include condition ${cIdx + 1} must include an operator.`);
      }
      if (condition.operator && ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'range'].includes(condition.operator)) {
        if (condition.expected === undefined) {
          errors.push(`Global include condition ${cIdx + 1} must include an expected value.`);
        }
      }
    });
    (global.excludeConditions || []).forEach((condition, cIdx) => {
      if (!condition || typeof condition !== 'object') {
        errors.push(`Global exclude condition ${cIdx + 1} must be an object.`);
        return;
      }
      if (!condition.path && condition.source !== 'raw') {
        errors.push(`Global exclude condition ${cIdx + 1} must include a path.`);
      }
      if (!condition.operator) {
        errors.push(`Global exclude condition ${cIdx + 1} must include an operator.`);
      }
      if (condition.operator && ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'range'].includes(condition.operator)) {
        if (condition.expected === undefined) {
          errors.push(`Global exclude condition ${cIdx + 1} must include an expected value.`);
        }
      }
    });
  }
  if (!Array.isArray(config.assertions)) {
    errors.push('Config must include an assertions array.');
    return errors;
  }
  config.assertions.forEach((assertion, index) => {
    if (!assertion || typeof assertion !== 'object') {
      errors.push(`Assertion ${index + 1} must be an object.`);
      return;
    }
    if (!Array.isArray(assertion.validations) || !assertion.validations.length) {
      errors.push(`Assertion ${index + 1} must include at least one validation.`);
    }
    if (assertion.conditionsLogic && !['all', 'any'].includes(assertion.conditionsLogic)) {
      errors.push(`Assertion ${index + 1} has invalid conditionsLogic.`);
    }
    if (assertion.scope && assertion.scope !== 'page' && assertion.scope !== 'request') {
      errors.push(`Assertion ${index + 1} has invalid scope.`);
    }
    if (assertion.scope === 'page') {
      if (!assertion.count || !['exactly', 'at_least', 'at_most'].includes(assertion.count)) {
        errors.push(`Assertion ${index + 1} must include a valid count (exactly, at_least, at_most).`);
      }
      if (assertion.value === undefined || assertion.value === null || Number.isNaN(Number(assertion.value))) {
        errors.push(`Assertion ${index + 1} must include a numeric value for count.`);
      }
    }
    (assertion.conditions || []).forEach((condition, cIdx) => {
      if (!condition || typeof condition !== 'object') {
        errors.push(`Assertion ${index + 1} condition ${cIdx + 1} must be an object.`);
        return;
      }
      if (!condition.path && condition.source !== 'raw') {
        errors.push(`Assertion ${index + 1} condition ${cIdx + 1} must include a path.`);
      }
      if (!condition.operator) {
        errors.push(`Assertion ${index + 1} condition ${cIdx + 1} must include an operator.`);
      }
      if (condition.operator && ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'range'].includes(condition.operator)) {
        if (condition.expected === undefined) {
          errors.push(`Assertion ${index + 1} condition ${cIdx + 1} must include an expected value.`);
        }
      }
    });
    (assertion.validations || []).forEach((condition, cIdx) => {
      if (!condition || typeof condition !== 'object') {
        errors.push(`Assertion ${index + 1} validation ${cIdx + 1} must be an object.`);
        return;
      }
      if (!condition.path && condition.source !== 'raw') {
        errors.push(`Assertion ${index + 1} validation ${cIdx + 1} must include a path.`);
      }
      if (!condition.operator) {
        errors.push(`Assertion ${index + 1} validation ${cIdx + 1} must include an operator.`);
      }
      if (condition.operator && ['equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'range'].includes(condition.operator)) {
        if (condition.expected === undefined) {
          errors.push(`Assertion ${index + 1} validation ${cIdx + 1} must include an expected value.`);
        }
      }
    });
  });
  return errors;
}
