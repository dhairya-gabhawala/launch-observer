export function normalizeUatConfig(config) {
  if (!config || typeof config !== 'object') return { assertions: [] };
  const assertions = Array.isArray(config.assertions) ? config.assertions : [];
  return {
    ...config,
    assertions: assertions.map(assertion => normalizeAssertion(assertion))
  };
}

function normalizeAssertion(assertion) {
  const conditions = Array.isArray(assertion.conditions) ? assertion.conditions : [];
  return {
    id: assertion.id || `assertion-${Math.random().toString(16).slice(2)}`,
    title: assertion.title || assertion.id || 'Assertion',
    description: assertion.description || '',
    logic: assertion.logic === 'any' ? 'any' : 'all',
    conditions: conditions.map(cond => ({
      source: cond.source || 'payload',
      path: cond.path || '',
      operator: cond.operator || 'exists',
      expected: cond.expected
    })),
    scope: assertion.scope === 'page' ? 'page' : 'request',
    count: assertion.count || null,
    value: Number.isFinite(assertion.value) ? assertion.value : assertion.value,
  };
}

export function buildUatTemplate(siteId = 'example-site') {
  return {
    siteId,
    siteName: siteId,
    assertions: [
      {
        id: 'pageview-once',
        title: 'Pageview fires only once',
        description: 'Ensure pageview event fires only once per page view.',
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        logic: 'all',
        conditions: [
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
        title: 'Any condition example',
        description: 'Example using logic any.',
        logic: 'any',
        conditions: [
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

export function validateUatConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return ['Config must be a JSON object.'];
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
    if (!Array.isArray(assertion.conditions) || !assertion.conditions.length) {
      errors.push(`Assertion ${index + 1} must include at least one condition.`);
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
  });
  return errors;
}
