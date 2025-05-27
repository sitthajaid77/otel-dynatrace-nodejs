// src/helpers/span-helpers.js - Enhanced Span Utilities

import { trace, SpanStatusCode } from '@opentelemetry/api';

/**
 * Add business context attributes to span
 * @param {Span} span - OpenTelemetry span
 * @param {Object} context - Business context data
 */
export function addBusinessContext(span, context = {}) {
  if (!span) return;
  
  Object.entries(context).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const attributeKey = key.startsWith('business.') ? key : `business.${key}`;
      span.setAttribute(attributeKey, String(value));
    }
  });
}

/**
 * Add comprehensive error information to span
 * @param {Span} span - OpenTelemetry span
 * @param {Error} error - Error object
 * @param {Object} options - Additional error context
 */
export function addErrorDetails(span, error, options = {}) {
  if (!span || !error) return;
  
  // Record the exception
  span.recordException(error);
  
  // Set error status
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message
  });
  
  // Add detailed error attributes
  span.setAttribute('error', true);
  span.setAttribute('error.type', error.constructor.name);
  span.setAttribute('error.message', error.message);
  span.setAttribute('error.timestamp', Date.now());
  
  // Add stack trace (first few lines for readability)
  if (error.stack) {
    const stackLines = error.stack.split('\n').slice(0, 5).join('\n');
    span.setAttribute('error.stack_preview', stackLines);
  }
  
  // Add error code if available
  if (error.code) {
    span.setAttribute('error.code', error.code);
  }
  
  // Add HTTP status if available
  if (error.status || error.statusCode) {
    span.setAttribute('error.http_status', error.status || error.statusCode);
  }
  
  // Add additional context
  if (options.step) {
    span.setAttribute('error.step', options.step);
  }
  
  if (options.operation) {
    span.setAttribute('error.operation', options.operation);
  }
  
  if (options.context) {
    Object.entries(options.context).forEach(([key, value]) => {
      span.setAttribute(`error.context.${key}`, String(value));
    });
  }
}

/**
 * Add HTTP request/response information to span
 * @param {Span} span - OpenTelemetry span
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object (optional)
 */
export function addHttpContext(span, req, res = null) {
  if (!span || !req) return;
  
  // Request information
  span.setAttribute('http.method', req.method);
  span.setAttribute('http.url', req.originalUrl || req.url);
  span.setAttribute('http.scheme', req.protocol);
  span.setAttribute('http.host', req.get('host') || 'unknown');
  span.setAttribute('http.user_agent', req.get('user-agent') || 'unknown');
  
  // Custom headers
  const tid = req.get('x-tid') || req.get('x-transaction-id');
  if (tid) {
    span.setAttribute('http.transaction_id', tid);
  }
  
  const contentType = req.get('content-type');
  if (contentType) {
    span.setAttribute('http.request.content_type', contentType);
  }
  
  // Request body size
  const contentLength = req.get('content-length');
  if (contentLength) {
    span.setAttribute('http.request.content_length', parseInt(contentLength));
  }
  
  // Response information (if available)
  if (res) {
    if (res.statusCode) {
      span.setAttribute('http.status_code', res.statusCode);
    }
    
    // Response content type
    const responseContentType = res.get('content-type');
    if (responseContentType) {
      span.setAttribute('http.response.content_type', responseContentType);
    }
  }
}

/**
 * Add database operation context to span
 * @param {Span} span - OpenTelemetry span
 * @param {Object} operation - Database operation details
 */
export function addDatabaseContext(span, operation = {}) {
  if (!span) return;
  
  if (operation.type) {
    span.setAttribute('db.operation', operation.type);
  }
  
  if (operation.collection || operation.table) {
    span.setAttribute('db.collection.name', operation.collection || operation.table);
  }
  
  if (operation.database) {
    span.setAttribute('db.name', operation.database);
  }
  
  if (operation.query) {
    // Only log query structure, not actual data for security
    span.setAttribute('db.statement.type', typeof operation.query);
  }
  
  if (operation.duration) {
    span.setAttribute('db.duration_ms', operation.duration);
  }
  
  if (operation.recordCount !== undefined) {
    span.setAttribute('db.record_count', operation.recordCount);
  }
}

/**
 * Create a span with automatic error handling and context
 * @param {string} name - Span name
 * @param {Object} attributes - Initial span attributes
 * @param {Function} callback - Function to execute within span
 * @param {Object} options - Additional options
 */
export function withSpan(name, attributes = {}, callback, options = {}) {
  const tracer = trace.getActiveTracer() || trace.getTracer('default');
  
  return tracer.startActiveSpan(name, { attributes }, (span) => {
    const startTime = Date.now();
    
    try {
      // Add timing information
      span.setAttribute('operation.start_time', startTime);
      
      // Execute callback
      const result = callback(span);
      
      // Add success attributes
      span.setAttribute('operation.success', true);
      span.setAttribute('operation.duration_ms', Date.now() - startTime);
      
      return result;
    } catch (error) {
      // Add error details with timing context
      addErrorDetails(span, error, {
        step: options.step || 'execution',
        operation: name,
        context: {
          duration_ms: Date.now() - startTime
        }
      });
      
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Async version of withSpan
 * @param {string} name - Span name
 * @param {Object} attributes - Initial span attributes
 * @param {Function} callback - Async function to execute within span
 * @param {Object} options - Additional options
 */
export async function withSpanAsync(name, attributes = {}, callback, options = {}) {
  const tracer = trace.getActiveTracer() || trace.getTracer('default');
  
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    const startTime = Date.now();
    
    try {
      // Add timing information
      span.setAttribute('operation.start_time', startTime);
      
      // Execute async callback
      const result = await callback(span);
      
      // Add success attributes
      span.setAttribute('operation.success', true);
      span.setAttribute('operation.duration_ms', Date.now() - startTime);
      
      return result;
    } catch (error) {
      // Add error details with timing context
      addErrorDetails(span, error, {
        step: options.step || 'execution',
        operation: name,
        context: {
          duration_ms: Date.now() - startTime
        }
      });
      
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a business operation span with enhanced context
 * @param {string} operationName - Business operation name
 * @param {Object} businessContext - Business-specific data
 * @param {Function} callback - Function to execute
 * @param {Object} options - Additional options
 */
export function withBusinessSpan(operationName, businessContext = {}, callback, options = {}) {
  const attributes = {
    'operation.type': 'business',
    'operation.name': operationName,
    ...Object.entries(businessContext).reduce((acc, [key, value]) => {
      acc[`business.${key}`] = String(value);
      return acc;
    }, {})
  };
  
  return withSpan(operationName, attributes, (span) => {
    // Add HTTP context if request is available
    if (options.req) {
      addHttpContext(span, options.req, options.res);
    }
    
    return callback(span);
  }, options);
}

/**
 * Async version of withBusinessSpan
 */
export async function withBusinessSpanAsync(operationName, businessContext = {}, callback, options = {}) {
  const attributes = {
    'operation.type': 'business',
    'operation.name': operationName,
    ...Object.entries(businessContext).reduce((acc, [key, value]) => {
      acc[`business.${key}`] = String(value);
      return acc;
    }, {})
  };
  
  return withSpanAsync(operationName, attributes, async (span) => {
    // Add HTTP context if request is available
    if (options.req) {
      addHttpContext(span, options.req, options.res);
    }
    
    return await callback(span);
  }, options);
}