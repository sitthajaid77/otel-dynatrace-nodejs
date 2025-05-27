// src/tracer.js - Enhanced Dynatrace Tracer Class (CommonJS)

const { trace, context, SpanStatusCode } = require('@opentelemetry/api');
const { addErrorDetails, addBusinessContext } = require('./helpers/span-helpers.js');

/**
 * Enhanced Dynatrace Tracer class with comprehensive tracing capabilities
 */
class DynatraceTracer {
  #tracer;
  #serviceName;
  #version;

  constructor(serviceName, version = '1.0.0') {
    if (!serviceName) {
      throw new Error('serviceName is required for tracer');
    }
    
    this.#serviceName = serviceName;
    this.#version = version;
    this.#tracer = trace.getTracer(serviceName, version);
  }

  /**
   * Get the service name
   * @returns {string} Service name
   */
  getServiceName() {
    return this.#serviceName;
  }

  /**
   * Get the service version
   * @returns {string} Service version
   */
  getVersion() {
    return this.#version;
  }

  /**
   * Start a new span
   * @param {string} name - Span name
   * @param {Object} options - Span options
   * @param {Object} attributes - Initial attributes
   * @returns {Span} OpenTelemetry span
   */
  startSpan(name, options = {}, attributes = {}) {
    const spanOptions = {
      attributes: {
        'service.name': this.#serviceName,
        'service.version': this.#version,
        ...attributes
      },
      ...options
    };

    const span = this.#tracer.startSpan(name, spanOptions);
    
    // Add timestamp
    span.setAttribute('span.start_time', Date.now());
    
    return span;
  }

  /**
   * Start an active span (automatically sets as current span)
   * @param {string} name - Span name
   * @param {Object} options - Span options
   * @param {Function} callback - Function to execute within span context
   * @returns {*} Result of callback function
   */
  startActiveSpan(name, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    return this.#tracer.startActiveSpan(name, options, callback);
  }

  /**
   * End a span with proper cleanup
   * @param {Span} span - Span to end
   * @param {Object} finalAttributes - Final attributes to add before ending
   */
  endSpan(span, finalAttributes = {}) {
    if (!span) {
      console.warn('No span provided to endSpan');
      return;
    }

    try {
      // Add final attributes
      Object.entries(finalAttributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });

      // Add end timestamp
      span.setAttribute('span.end_time', Date.now());
      
      // End the span
      span.end();
    } catch (error) {
      console.error('Error ending span:', error);
      span.end(); // Still try to end the span
    }
  }

  /**
   * Execute function within a span context (synchronous)
   * @param {string} name - Span name
   * @param {Object} attributes - Initial span attributes
   * @param {Function} callback - Function to execute
   * @param {Object} options - Additional options
   * @returns {*} Result of callback function
   */
  withSpan(name, attributes = {}, callback, options = {}) {
    if (typeof attributes === 'function') {
      options = callback || {};
      callback = attributes;
      attributes = {};
    }

    const startTime = Date.now();
    const span = this.startSpan(name, options.spanOptions, {
      'operation.type': 'sync',
      ...attributes
    });

    return context.with(trace.setSpan(context.active(), span), () => {
      try {
        // Execute callback
        const result = callback(span);
        
        // Add success attributes
        const duration = Date.now() - startTime;
        span.setAttribute('operation.success', true);
        span.setAttribute('operation.duration_ms', duration);
        span.setStatus({ code: SpanStatusCode.OK });
        
        return result;
      } catch (error) {
        // Add error details
        const duration = Date.now() - startTime;
        addErrorDetails(span, error, {
          step: options.step || 'execution',
          operation: name,
          context: {
            duration_ms: duration,
            operation_type: 'sync'
          }
        });
        
        throw error;
      } finally {
        this.endSpan(span);
      }
    });
  }

  /**
   * Execute async function within a span context
   * @param {string} name - Span name
   * @param {Object} attributes - Initial span attributes
   * @param {Function} callback - Async function to execute
   * @param {Object} options - Additional options
   * @returns {Promise} Result of callback function
   */
  async withSpanAsync(name, attributes = {}, callback, options = {}) {
    if (typeof attributes === 'function') {
      options = callback || {};
      callback = attributes;
      attributes = {};
    }

    const startTime = Date.now();
    const span = this.startSpan(name, options.spanOptions, {
      'operation.type': 'async',
      ...attributes
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        // Execute async callback
        const result = await callback(span);
        
        // Add success attributes
        const duration = Date.now() - startTime;
        span.setAttribute('operation.success', true);
        span.setAttribute('operation.duration_ms', duration);
        span.setStatus({ code: SpanStatusCode.OK });
        
        return result;
      } catch (error) {
        // Add error details
        const duration = Date.now() - startTime;
        addErrorDetails(span, error, {
          step: options.step || 'execution',
          operation: name,
          context: {
            duration_ms: duration,
            operation_type: 'async'
          }
        });
        
        throw error;
      } finally {
        this.endSpan(span);
      }
    });
  }

  /**
   * Execute business operation with enhanced context
   * @param {string} operationName - Business operation name
   * @param {Object} businessContext - Business-specific data
   * @param {Function} callback - Function to execute
   * @param {Object} options - Additional options
   * @returns {*} Result of callback function
   */
  withBusinessSpan(operationName, businessContext = {}, callback, options = {}) {
    const attributes = {
      'operation.type': 'business',
      'operation.name': operationName,
      'business.operation': operationName
    };

    return this.withSpan(operationName, attributes, (span) => {
      // Add business context
      addBusinessContext(span, businessContext);
      
      // Add HTTP context if available
      if (options.req) {
        this.addHttpContext(span, options.req, options.res);
      }
      
      return callback(span);
    }, options);
  }

  /**
   * Execute async business operation with enhanced context
   * @param {string} operationName - Business operation name
   * @param {Object} businessContext - Business-specific data
   * @param {Function} callback - Async function to execute
   * @param {Object} options - Additional options
   * @returns {Promise} Result of callback function
   */
  async withBusinessSpanAsync(operationName, businessContext = {}, callback, options = {}) {
    const attributes = {
      'operation.type': 'business',
      'operation.name': operationName,
      'business.operation': operationName
    };

    return this.withSpanAsync(operationName, attributes, async (span) => {
      // Add business context
      addBusinessContext(span, businessContext);
      
      // Add HTTP context if available
      if (options.req) {
        this.addHttpContext(span, options.req, options.res);
      }
      
      return await callback(span);
    }, options);
  }

  /**
   * Add HTTP context to span
   * @param {Span} span - Target span
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object (optional)
   */
  addHttpContext(span, req, res = null) {
    if (!span || !req) return;

    span.setAttribute('http.method', req.method);
    span.setAttribute('http.url', req.originalUrl || req.url);
    span.setAttribute('http.scheme', req.protocol);
    span.setAttribute('http.host', req.get('host') || 'unknown');

    // Add request headers
    const userAgent = req.get('user-agent');
    if (userAgent) {
      span.setAttribute('http.user_agent', userAgent);
    }

    const requestId = req.get('x-request-id') || req.get('x-tid');
    if (requestId) {
      span.setAttribute('http.request_id', requestId);
    }

    // Add response information if available
    if (res && res.statusCode) {
      span.setAttribute('http.status_code', res.statusCode);
    }
  }

  /**
   * Create a child span from current active span
   * @param {string} name - Child span name
   * @param {Object} attributes - Span attributes
   * @returns {Span} Child span
   */
  createChildSpan(name, attributes = {}) {
    const parentSpan = trace.getActiveSpan();
    if (!parentSpan) {
      console.warn('No active span found for creating child span');
      return this.startSpan(name, {}, attributes);
    }

    return this.startSpan(name, {
      parent: parentSpan
    }, {
      'span.parent_id': parentSpan.spanContext().spanId,
      ...attributes
    });
  }

  /**
   * Get current active span
   * @returns {Span|null} Current active span
   */
  getCurrentSpan() {
    return trace.getActiveSpan();
  }

  /**
   * Check if there's an active span
   * @returns {boolean} True if there's an active span
   */
  hasActiveSpan() {
    return trace.getActiveSpan() !== undefined;
  }

  /**
   * Add attributes to current active span
   * @param {Object} attributes - Attributes to add
   */
  addAttributesToCurrentSpan(attributes = {}) {
    const span = trace.getActiveSpan();
    if (span) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, String(value));
      });
    }
  }

  /**
   * Add business context to current active span
   * @param {Object} businessContext - Business context to add
   */
  addBusinessContextToCurrentSpan(businessContext = {}) {
    const span = trace.getActiveSpan();
    if (span) {
      addBusinessContext(span, businessContext);
    }
  }

  /**
   * Record an event on current active span
   * @param {string} name - Event name
   * @param {Object} attributes - Event attributes
   */
  addEvent(name, attributes = {}) {
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent(name, {
        timestamp: Date.now(),
        ...attributes
      });
    }
  }

  /**
   * Record an exception on current active span
   * @param {Error} error - Error to record
   * @param {Object} context - Additional context
   */
  recordException(error, context = {}) {
    const span = trace.getActiveSpan();
    if (span) {
      addErrorDetails(span, error, context);
    }
  }

  /**
   * Get underlying OpenTelemetry tracer
   * @returns {Tracer} OpenTelemetry tracer instance
   */
  getTracer() {
    return this.#tracer;
  }
}

// CommonJS export
module.exports = { DynatraceTracer };