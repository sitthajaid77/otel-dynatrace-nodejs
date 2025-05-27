// src/helpers/http-tracer.js - HTTP Request Tracing (CommonJS) - FIXED

const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { addErrorDetails } = require('./span-helpers.js');

/**
 * Trace HTTP requests with automatic span creation and error handling
 * @param {Function} httpClient - HTTP client function (axios, fetch, etc.)
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {Object} options - Request options
 * @param {Object} traceOptions - Tracing options
 * @returns {Promise} HTTP response
 */
async function traceHttpRequest(httpClient, method, url, options = {}, traceOptions = {}) {
  // FIXED: Use trace.getTracer() instead of getActiveTracer()
  const tracer = trace.getTracer('http-tracer');
  const spanName = traceOptions.spanName || `HTTP ${method.toUpperCase()}`;
  
  return tracer.startActiveSpan(spanName, {
    attributes: {
      'http.method': method.toUpperCase(),
      'http.url': url,
      'http.client': traceOptions.clientName || 'unknown',
      'component': 'http-client'
    }
  }, async (span) => {
    const startTime = Date.now();
    
    try {
      // Add request details to span
      span.setAttribute('http.request.start_time', startTime);
      
      // Parse URL for additional attributes
      try {
        const urlObj = new URL(url);
        span.setAttribute('http.host', urlObj.host);
        span.setAttribute('http.scheme', urlObj.protocol.replace(':', ''));
        span.setAttribute('http.target', urlObj.pathname + urlObj.search);
      } catch (e) {
        // Invalid URL, just log the raw URL
        span.setAttribute('http.url.raw', url);
      }
      
      // Add request headers (selective)
      if (options.headers) {
        const allowedHeaders = ['content-type', 'user-agent', 'authorization'];
        Object.entries(options.headers).forEach(([key, value]) => {
          if (allowedHeaders.includes(key.toLowerCase())) {
            const headerValue = key.toLowerCase() === 'authorization' 
              ? `${value.split(' ')[0]} [REDACTED]` 
              : value;
            span.setAttribute(`http.request.header.${key.toLowerCase()}`, headerValue);
          }
        });
      }
      
      // Add request body size if available
      if (options.data || options.body) {
        const bodySize = JSON.stringify(options.data || options.body).length;
        span.setAttribute('http.request.body.size', bodySize);
      }
      
      // Execute HTTP request
      const response = await httpClient(url, {
        method: method.toUpperCase(),
        ...options
      });
      
      // Add response details
      const duration = Date.now() - startTime;
      span.setAttribute('http.response.duration_ms', duration);
      
      if (response.status || response.statusCode) {
        const statusCode = response.status || response.statusCode;
        span.setAttribute('http.status_code', statusCode);
        span.setAttribute('http.response.status_code', statusCode);
        
        // Determine if this is an error status
        if (statusCode >= 400) {
          span.setAttribute('error', true);
          span.setAttribute('error.type', statusCode >= 500 ? 'ServerError' : 'ClientError');
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
      }
      
      // Add response headers (selective)
      if (response.headers) {
        const responseHeaders = response.headers;
        const allowedResponseHeaders = ['content-type', 'content-length', 'cache-control'];
        
        allowedResponseHeaders.forEach(header => {
          const value = responseHeaders[header] || responseHeaders[header.toLowerCase()];
          if (value) {
            span.setAttribute(`http.response.header.${header}`, value);
          }
        });
      }
      
      // Add response body size if available
      if (response.data) {
        const responseSize = JSON.stringify(response.data).length;
        span.setAttribute('http.response.body.size', responseSize);
      }
      
      // Add business context if provided
      if (traceOptions.businessContext) {
        Object.entries(traceOptions.businessContext).forEach(([key, value]) => {
          span.setAttribute(`business.${key}`, String(value));
        });
      }
      
      return response;
      
    } catch (error) {
      // Handle HTTP errors
      const duration = Date.now() - startTime;
      
      addErrorDetails(span, error, {
        step: 'http_request',
        operation: `${method.toUpperCase()} ${url}`,
        context: {
          url,
          method: method.toUpperCase(),
          duration_ms: duration,
          client: traceOptions.clientName || 'unknown'
        }
      });
      
      // Add specific HTTP error information
      if (error.response) {
        span.setAttribute('http.error.status_code', error.response.status);
        span.setAttribute('http.error.response_data', JSON.stringify(error.response.data || {}));
      }
      
      if (error.code) {
        span.setAttribute('http.error.code', error.code);
      }
      
      if (error.config) {
        span.setAttribute('http.error.timeout', error.config.timeout || 'unknown');
      }
      
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a traced axios instance
 * @param {Object} axios - Axios instance
 * @param {Object} defaultTraceOptions - Default tracing options
 * @returns {Object} Traced axios instance
 */
function createTracedAxios(axios, defaultTraceOptions = {}) {
  return {
    get: (url, config = {}) => traceHttpRequest(
      axios.get.bind(axios), 
      'GET', 
      url, 
      config, 
      { ...defaultTraceOptions, ...config.traceOptions }
    ),
    
    post: (url, data, config = {}) => traceHttpRequest(
      (url, options) => axios.post(url, data, options), 
      'POST', 
      url, 
      config, 
      { ...defaultTraceOptions, ...config.traceOptions }
    ),
    
    put: (url, data, config = {}) => traceHttpRequest(
      (url, options) => axios.put(url, data, options), 
      'PUT', 
      url, 
      config, 
      { ...defaultTraceOptions, ...config.traceOptions }
    ),
    
    delete: (url, config = {}) => traceHttpRequest(
      axios.delete.bind(axios), 
      'DELETE', 
      url, 
      config, 
      { ...defaultTraceOptions, ...config.traceOptions }
    ),
    
    patch: (url, data, config = {}) => traceHttpRequest(
      (url, options) => axios.patch(url, data, options), 
      'PATCH', 
      url, 
      config, 
      { ...defaultTraceOptions, ...config.traceOptions }
    ),
    
    // Direct request method
    request: (config) => {
      const { method = 'GET', url, ...restConfig } = config;
      return traceHttpRequest(
        axios.request.bind(axios),
        method,
        url,
        restConfig,
        { ...defaultTraceOptions, ...config.traceOptions }
      );
    }
  };
}

/**
 * Create a traced fetch function
 * @param {Function} fetchFn - Native fetch or polyfill
 * @param {Object} defaultTraceOptions - Default tracing options
 * @returns {Function} Traced fetch function
 */
function createTracedFetch(fetchFn = fetch, defaultTraceOptions = {}) {
  return async (url, options = {}) => {
    const method = options.method || 'GET';
    
    return traceHttpRequest(
      async (url, opts) => {
        const response = await fetchFn(url, opts);
        
        // Convert fetch response to axios-like format for consistency
        return {
          status: response.status,
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          data: await response.json().catch(() => null)
        };
      },
      method,
      url,
      options,
      { ...defaultTraceOptions, ...options.traceOptions, clientName: 'fetch' }
    );
  };
}

/**
 * Wrapper for specific external service calls
 * @param {string} serviceName - External service name
 * @param {Function} httpClient - HTTP client function
 * @returns {Object} Service-specific traced client
 */
function createServiceClient(serviceName, httpClient) {
  const defaultOptions = {
    clientName: serviceName,
    businessContext: {
      external_service: serviceName
    }
  };
  
  return {
    call: async (endpoint, options = {}) => {
      return traceHttpRequest(
        httpClient,
        options.method || 'GET',
        endpoint,
        options,
        {
          ...defaultOptions,
          spanName: `${serviceName} API Call`,
          ...options.traceOptions
        }
      );
    },
    
    get: (endpoint, options = {}) => 
      traceHttpRequest(httpClient, 'GET', endpoint, options, {
        ...defaultOptions,
        spanName: `${serviceName} GET`,
        ...options.traceOptions
      }),
    
    post: (endpoint, data, options = {}) => 
      traceHttpRequest(
        (url, opts) => httpClient(url, { ...opts, data }), 
        'POST', 
        endpoint, 
        options, 
        {
          ...defaultOptions,
          spanName: `${serviceName} POST`,
          ...options.traceOptions
        }
      )
  };
}

// CommonJS exports
module.exports = {
  traceHttpRequest,
  createTracedAxios,
  createTracedFetch,
  createServiceClient
};