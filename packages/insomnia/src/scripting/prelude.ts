// The scripts' API, `insomnia` and its Postman-compatible alias `pm`, as the
// JavaScript evaluated inside the sandbox before a script. It works on plain
// data the host passes in (__input, JSON) and reads back after (__output()),
// so nothing in the sandbox can reach the app. The only host function is
// __log, for console.
//
// Kept as a string, with no template literals inside, so no bundler rewrites it.
export const PRELUDE = String.raw`
(function () {
  'use strict';
  var state = JSON.parse(__input);
  var hasOwn = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
  var describe = function (value) {
    try {
      return typeof value === 'string' ? JSON.stringify(value) : value === undefined ? 'undefined' : JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  };

  function AssertionError(message) {
    this.name = 'AssertionError';
    this.message = message;
    this.stack = '';
  }
  AssertionError.prototype = Object.create(Error.prototype);
  AssertionError.prototype.constructor = AssertionError;

  // ~~ variables ~~
  var environment = state.environment;
  var baseEnvironment = state.environmentIsBase ? environment : state.baseEnvironment;
  var variables = state.variables;
  var iterationData = state.iterationData || {};
  // the project's global environment in use, and its global base under it
  var globals = state.globals || {};
  var globalBase = state.globalBase || {};

  function lookup(key) {
    var stores = [variables, iterationData, environment, baseEnvironment, globals, globalBase];
    for (var i = 0; i < stores.length; i++) {
      if (hasOwn(stores[i], key)) {
        return stores[i][key];
      }
    }
    return undefined;
  }

  function replaceIn(template) {
    return String(template).replace(/{{\s*([\w.$-]+)\s*}}/g, function (match, key) {
      var value = lookup(key);
      return value === undefined ? match : typeof value === 'string' ? value : JSON.stringify(value);
    });
  }

  function scope(store, name, readOnly) {
    var api = {
      name: name,
      get: function (key) { return store[key]; },
      has: function (key) { return hasOwn(store, key); },
      toObject: function () { return JSON.parse(JSON.stringify(store)); },
      replaceIn: replaceIn,
    };
    if (!readOnly) {
      api.set = function (key, value) {
        if (value === undefined) {
          delete store[key];
        } else {
          store[key] = JSON.parse(JSON.stringify(value));
        }
      };
      api.unset = function (key) { delete store[key]; };
      api.clear = function () { Object.keys(store).forEach(function (key) { delete store[key]; }); };
    }
    return api;
  }

  var variablesApi = scope(variables, 'variables', false);
  // pm.variables resolves across every scope, and sets the request's own
  variablesApi.get = lookup;
  variablesApi.has = function (key) { return lookup(key) !== undefined; };

  // ~~ headers ~~
  function headerList(list, readOnly) {
    var same = function (a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); };
    var find = function (name) {
      for (var i = 0; i < list.length; i++) {
        if (!list[i].disabled && same(list[i].name, name)) {
          return list[i];
        }
      }
      return undefined;
    };
    // { key, value } as Postman passes them, or a name and a value
    var pair = function (header, value) {
      return typeof header === 'string' ? { name: header, value: String(value) } : { name: String(header.key || header.name), value: String(header.value) };
    };
    var api = {
      get: function (name) { var header = find(name); return header ? header.value : undefined; },
      has: function (name) { return !!find(name); },
      all: function () { return list.filter(function (header) { return !header.disabled; }).map(function (header) { return { key: header.name, value: header.value }; }); },
      each: function (fn) { api.all().forEach(fn); },
      toObject: function () {
        var object = {};
        api.all().forEach(function (header) { object[header.key.toLowerCase()] = header.value; });
        return object;
      },
    };
    if (!readOnly) {
      api.add = function (header, value) { list.push(pair(header, value)); };
      api.upsert = function (header, value) {
        var next = pair(header, value);
        var existing = find(next.name);
        if (existing) {
          existing.value = next.value;
        } else {
          list.push(next);
        }
      };
      api.remove = function (name) {
        for (var i = list.length - 1; i >= 0; i--) {
          if (same(list[i].name, typeof name === 'string' ? name : name.key || name.name)) {
            list.splice(i, 1);
          }
        }
      };
    }
    return api;
  }

  // ~~ the request ~~
  function requestApi(request, readOnly) {
    var params = request.parameters;
    var query = headerList(params, readOnly);
    // a URL given with a query string: the query replaces the parameters
    var setUrl = function (value) {
      if (readOnly) {
        throw new TypeError('The request can only be changed before it is sent');
      }
      var text = String(value);
      var at = text.indexOf('?');
      if (at < 0) {
        request.url = text;
        return;
      }
      var decode = function (part) {
        try {
          return decodeURIComponent(part.replace(/\+/g, ' '));
        } catch (err) {
          return part;
        }
      };
      request.url = text.slice(0, at);
      params.length = 0;
      text.slice(at + 1).split('&').filter(Boolean).forEach(function (pair) {
        var parts = pair.split('=');
        params.push({ name: decode(parts[0]), value: decode(parts.slice(1).join('=')) });
      });
    };
    var url = {
      toString: function () {
        var enabled = params.filter(function (param) { return !param.disabled; });
        var search = enabled.map(function (param) { return encodeURIComponent(param.name) + '=' + encodeURIComponent(param.value); }).join('&');
        return request.url + (search ? (request.url.indexOf('?') >= 0 ? '&' : '?') + search : '');
      },
      getHost: function () { var match = /^[a-z][\w+.-]*:\/\/([^/:?#]+)/i.exec(request.url); return match ? match[1] : ''; },
      getPath: function () { var match = /^[a-z][\w+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i.exec(request.url); return match && match[1] ? match[1] : '/'; },
      query: query,
    };
    if (!readOnly) {
      url.update = setUrl;
      url.addQueryParams = function (list) {
        (Array.isArray(list) ? list : [list]).forEach(function (param) {
          if (typeof param === 'string') {
            var parts = param.split('=');
            params.push({ name: parts[0], value: parts.slice(1).join('=') });
          } else {
            params.push({ name: String(param.key || param.name), value: String(param.value) });
          }
        });
      };
      url.removeQueryParams = function (names) {
        (Array.isArray(names) ? names : [names]).forEach(function (name) { query.remove(name); });
      };
    }
    var body = {
      toString: function () { return request.body.text || ''; },
    };
    Object.defineProperty(body, 'raw', {
      enumerable: true,
      get: function () { return request.body.text || ''; },
      set: function (value) {
        if (readOnly) {
          throw new TypeError('The request can only be changed before it is sent');
        }
        request.body.text = typeof value === 'string' ? value : JSON.stringify(value);
      },
    });
    Object.defineProperty(body, 'mode', {
      enumerable: true,
      get: function () { return request.body.params ? (request.body.mimeType === 'multipart/form-data' ? 'formdata' : 'urlencoded') : request.body.text !== undefined ? 'raw' : 'none'; },
    });
    if (!readOnly) {
      body.update = function (value) { body.raw = typeof value === 'string' ? value : value && value.raw !== undefined ? value.raw : JSON.stringify(value); };
    }
    var api = {
      id: request.id,
      name: request.name,
      headers: headerList(request.headers, readOnly),
      body: body,
    };
    Object.defineProperty(api, 'url', {
      enumerable: true,
      get: function () { return url; },
      set: setUrl,
    });
    Object.defineProperty(api, 'method', {
      enumerable: true,
      get: function () { return request.method; },
      set: function (value) {
        if (readOnly) {
          throw new TypeError('The request can only be changed before it is sent');
        }
        request.method = String(value).toUpperCase();
      },
    });
    api.addHeader = function (header, value) { api.headers.add(header, value); };
    api.removeHeader = function (name) { api.headers.remove(name); };
    return api;
  }

  // ~~ expect, a small chai ~~
  function deepEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
      return a !== a && b !== b;
    }
    var keysA = Object.keys(a);
    var keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every(function (key) { return hasOwn(b, key) && deepEqual(a[key], b[key]); });
  }
  var typeOf = function (value) {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  };
  var lengthOf = function (value) {
    return value === null || value === undefined ? undefined : typeof value === 'object' && !Array.isArray(value) ? (value.size !== undefined ? value.size : Object.keys(value).length) : value.length;
  };

  function Assertion(actual, message, negate, deep) {
    this._actual = actual;
    this._message = message;
    this._negate = !!negate;
    this._deep = !!deep;
  }
  var chain = function (name) {
    Object.defineProperty(Assertion.prototype, name, { get: function () { return this; } });
  };
  ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also'].forEach(chain);
  Object.defineProperty(Assertion.prototype, 'not', { get: function () { return new Assertion(this._actual, this._message, !this._negate, this._deep); } });
  Object.defineProperty(Assertion.prototype, 'deep', { get: function () { return new Assertion(this._actual, this._message, this._negate, true); } });
  Assertion.prototype._check = function (passed, expectation, negated) {
    if (passed === this._negate) {
      var text = 'expected ' + describe(this._actual) + ' ' + (this._negate ? negated : expectation);
      throw new AssertionError(this._message ? this._message + ': ' + text : text);
    }
    return this;
  };
  var flag = function (name, test, expectation, negated) {
    Object.defineProperty(Assertion.prototype, name, {
      get: function () { return this._check(test(this._actual), expectation, negated); },
    });
  };
  flag('ok', function (value) { return !!value; }, 'to be truthy', 'to be falsy');
  flag('true', function (value) { return value === true; }, 'to be true', 'not to be true');
  flag('false', function (value) { return value === false; }, 'to be false', 'not to be false');
  flag('null', function (value) { return value === null; }, 'to be null', 'not to be null');
  flag('undefined', function (value) { return value === undefined; }, 'to be undefined', 'not to be undefined');
  flag('NaN', function (value) { return value !== value; }, 'to be NaN', 'not to be NaN');
  flag('exist', function (value) { return value !== null && value !== undefined; }, 'to exist', 'not to exist');
  flag('empty', function (value) { return lengthOf(value) === 0; }, 'to be empty', 'not to be empty');
  var method = function (names, fn) {
    names.forEach(function (name) { Assertion.prototype[name] = fn; });
  };
  method(['equal', 'equals', 'eq'], function (expected) {
    return this._deep ? this.eql(expected) : this._check(this._actual === expected, 'to equal ' + describe(expected), 'not to equal ' + describe(expected));
  });
  method(['eql', 'eqls'], function (expected) {
    return this._check(deepEqual(this._actual, expected), 'to deeply equal ' + describe(expected), 'not to deeply equal ' + describe(expected));
  });
  method(['above', 'gt', 'greaterThan'], function (n) { return this._check(this._actual > n, 'to be above ' + n, 'to be at most ' + n); });
  method(['below', 'lt', 'lessThan'], function (n) { return this._check(this._actual < n, 'to be below ' + n, 'to be at least ' + n); });
  method(['least', 'gte'], function (n) { return this._check(this._actual >= n, 'to be at least ' + n, 'to be below ' + n); });
  method(['most', 'lte'], function (n) { return this._check(this._actual <= n, 'to be at most ' + n, 'to be above ' + n); });
  method(['within'], function (low, high) { return this._check(this._actual >= low && this._actual <= high, 'to be within ' + low + '..' + high, 'not to be within ' + low + '..' + high); });
  method(['a', 'an'], function (type) {
    var lower = String(type).toLowerCase();
    return this._check(typeOf(this._actual) === lower, 'to be a ' + lower, 'not to be a ' + lower);
  });
  method(['include', 'includes', 'contain', 'contains'], function (value) {
    var actual = this._actual;
    var found = typeof actual === 'string' ? actual.indexOf(value) >= 0
      : Array.isArray(actual) ? actual.some(function (item) { return deepEqual(item, value); })
        : actual && typeof actual === 'object' && value && typeof value === 'object' ? Object.keys(value).every(function (key) { return deepEqual(actual[key], value[key]); })
          : false;
    return this._check(found, 'to include ' + describe(value), 'not to include ' + describe(value));
  });
  method(['property'], function (name, value) {
    var actual = this._actual;
    var has = actual !== null && actual !== undefined && (typeof actual === 'object' ? name in actual : actual[name] !== undefined);
    if (arguments.length < 2) {
      this._check(has, 'to have property ' + describe(name), 'not to have property ' + describe(name));
      return new Assertion(has ? actual[name] : undefined, this._message);
    }
    var matches = has && (this._deep ? deepEqual(actual[name], value) : actual[name] === value);
    return this._check(matches, 'to have property ' + describe(name) + ' of ' + describe(value), 'not to have property ' + describe(name) + ' of ' + describe(value));
  });
  method(['lengthOf', 'length'], function (n) {
    return this._check(lengthOf(this._actual) === n, 'to have a length of ' + n, 'not to have a length of ' + n);
  });
  method(['match', 'matches'], function (pattern) {
    return this._check(pattern.test(String(this._actual)), 'to match ' + pattern, 'not to match ' + pattern);
  });
  method(['oneOf'], function (list) {
    var actual = this._actual;
    return this._check(list.some(function (item) { return deepEqual(item, actual); }), 'to be one of ' + describe(list), 'not to be one of ' + describe(list));
  });
  method(['keys', 'key'], function () {
    var wanted = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
    var actual = this._actual || {};
    return this._check(wanted.every(function (key) { return hasOwn(actual, key); }), 'to have keys ' + describe(wanted), 'not to have keys ' + describe(wanted));
  });
  method(['string'], function (value) {
    return this._check(String(this._actual).indexOf(value) >= 0, 'to contain ' + describe(value), 'not to contain ' + describe(value));
  });
  method(['satisfy', 'satisfies'], function (fn) {
    return this._check(!!fn(this._actual), 'to satisfy the function', 'not to satisfy the function');
  });

  function expect(actual, message) {
    return new Assertion(actual, message);
  }
  expect.fail = function (message) {
    throw new AssertionError(message || 'expect.fail()');
  };

  // ~~ the response ~~
  function responseApi(response) {
    var text = function () { return response.body; };
    var json = function () {
      try {
        return JSON.parse(response.body);
      } catch (err) {
        throw new SyntaxError('The response body is not JSON: ' + err.message);
      }
    };
    var headers = headerList(response.headers, true);
    var check = function (passed, text) {
      if (!passed) {
        throw new AssertionError(text);
      }
    };
    var to = {
      have: {
        status: function (expected) {
          if (typeof expected === 'number') {
            check(response.code === expected, 'expected response to have status code ' + expected + ' but got ' + response.code);
          } else {
            check(response.status === expected, 'expected response to have status reason ' + describe(expected) + ' but got ' + describe(response.status));
          }
        },
        header: function (name, value) {
          check(headers.has(name), 'expected response to have header ' + name);
          if (arguments.length > 1) {
            check(headers.get(name) === value, 'expected response header ' + name + ' to be ' + describe(value) + ' but got ' + describe(headers.get(name)));
          }
        },
        body: function (expected) {
          if (arguments.length) {
            check(response.body === (typeof expected === 'string' ? expected : JSON.stringify(expected)), 'expected response body to be ' + describe(expected));
          } else {
            check(response.body.length > 0, 'expected response to have a body');
          }
        },
        jsonBody: function () {
          try {
            JSON.parse(response.body);
          } catch (err) {
            throw new AssertionError('expected response to have a JSON body');
          }
        },
      },
      be: {},
    };
    var statusFlag = function (name, test, text) {
      Object.defineProperty(to.be, name, { get: function () { check(test(response.code), 'expected response to be ' + text + ' but got ' + response.code); return true; } });
    };
    statusFlag('ok', function (code) { return code >= 200 && code < 300; }, 'ok (2xx)');
    statusFlag('success', function (code) { return code >= 200 && code < 300; }, 'a success (2xx)');
    statusFlag('redirection', function (code) { return code >= 300 && code < 400; }, 'a redirection (3xx)');
    statusFlag('clientError', function (code) { return code >= 400 && code < 500; }, 'a client error (4xx)');
    statusFlag('serverError', function (code) { return code >= 500; }, 'a server error (5xx)');
    statusFlag('error', function (code) { return code >= 400; }, 'an error (4xx or 5xx)');
    statusFlag('notFound', function (code) { return code === 404; }, 'not found (404)');
    return {
      code: response.code,
      status: response.status,
      responseTime: response.responseTime,
      responseSize: response.body.length,
      headers: headers,
      text: text,
      json: json,
      to: to,
    };
  }

  // ~~ tests ~~
  var pending = [];
  function test(name, fn) {
    var record = function (passed, err) {
      state.tests.push({ name: String(name), passed: passed, error: err ? String(err.message || err) : undefined });
    };
    try {
      var result = typeof fn === 'function' ? fn() : undefined;
      if (result && typeof result.then === 'function') {
        pending.push(result.then(function () { record(true); }, function (err) { record(false, err); }));
      } else {
        record(true);
      }
    } catch (err) {
      record(false, err);
    }
  }
  test.skip = function () {};

  // ~~ console ~~
  var log = function (level) {
    return function () {
      var parts = Array.prototype.map.call(arguments, function (arg) { return typeof arg === 'string' ? arg : describe(arg); });
      __log(level, parts.join(' '));
    };
  };
  globalThis.console = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };

  var api = {
    environment: scope(environment, 'environment', false),
    baseEnvironment: scope(baseEnvironment, 'baseEnvironment', false),
    // Insomnium keeps a collection's variables in its base environment
    collectionVariables: scope(baseEnvironment, 'collectionVariables', false),
    globals: scope(globals, 'globals', false),
    variables: variablesApi,
    iterationData: scope(iterationData, 'iterationData', true),
    request: requestApi(state.request, state.event !== 'prerequest'),
    response: state.response ? responseApi(state.response) : undefined,
    info: { eventName: state.event, requestName: state.request.name, requestId: state.request.id, iteration: state.iteration || 0 },
    test: test,
    expect: expect,
  };
  globalThis.insomnia = api;
  globalThis.pm = api;
  globalThis.__pending = function () { return Promise.all(pending); };
  globalThis.__output = function () {
    return JSON.stringify({ request: state.request, environment: environment, baseEnvironment: baseEnvironment, globals: globals, variables: variables, tests: state.tests });
  };
})();
`;
