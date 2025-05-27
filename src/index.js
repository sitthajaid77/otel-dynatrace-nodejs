// src/index.js - Main Library Entry Point (CommonJS Fixed)

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

// Import utilities and helpers
const { createConfig, getConfigSummary } = require('./utils/config.js');
const { DynatraceTracer } = require('./tracer.js');

// Import helpers and middleware - Fixed to CommonJS
const spanHelpers = require('./helpers/span-helpers.js');
const httpTracer = require('./helpers/http-tracer.js');
const databaseTracer = require('./helpers/database-tracer.js');

/**
 * Main OtelDynatrace class
 */
class OtelDynatrace {
  #sdk;
  #tracer;
  #config;
  #initialized = false;

  constructor(configOptions = {}) {
    this.#config = createConfig(configOptions);
    this.#initializeSDK();
  }

  #initializeSDK() {
    // Create resource with service information
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: this.#config.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: this.#config.serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.#config.deploymentEnvironment,
    });

    // Create trace exporter for Dynatrace
    const traceExporter = new OTLPTraceExporter({
      url: `${this.#config.dtApiUrl}/v1/traces`,
      headers: { 
        Authorization: `Api-Token ${this.#config.dtApiToken}`,
        'Content-Type': 'application/x-protobuf'
      },
    });

    // Create batch span processor
    const spanProcessor = new BatchSpanProcessor(traceExporter, {
      maxExportBatchSize: this.#config.maxExportBatchSize,
      exportTimeoutMillis: this.#config.exportTimeoutMs,
    });

    // Initialize NodeSDK
    this.#sdk = new NodeSDK({
      resource,
      spanProcessor,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': { 
            enabled: this.#config.autoInstrumentations.includes('http') 
          },
          '@opentelemetry/instrumentation-express': { 
            enabled: this.#config.autoInstrumentations.includes('express') 
          },
          '@opentelemetry/instrumentation-mongoose': { 
            enabled: this.#config.autoInstrumentations.includes('mongoose') 
          },
          '@opentelemetry/instrumentation-redis': { 
            enabled: this.#config.autoInstrumentations.includes('redis') 
          },
          // Disable noisy instrumentations by default
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
          '@opentelemetry/instrumentation-fs': { enabled: false }
        }),
      ],
    });

    // Create tracer instance
    this.#tracer = new DynatraceTracer(this.#config.serviceName);
  }

  /**
   * Start OpenTelemetry tracing
   */
  start() {
    if (!this.#config.enabled) {
      console.log('OpenTelemetry is disabled');
      return;
    }

    try {
      this.#sdk.start();
      this.#initialized = true;
      
      const summary = getConfigSummary(this.#config);
      console.log('OpenTelemetry initialized for Dynatrace:', summary);
    } catch (error) {
      console.error('Failed to start OpenTelemetry:', error);
      throw error;
    }
  }

  /**
   * Shutdown OpenTelemetry
   */
  async shutdown() {
    if (this.#initialized) {
      await this.#sdk.shutdown();
      this.#initialized = false;
      console.log('OpenTelemetry shutdown');
    }
  }

  /**
   * Get tracer instance
   */
  getTracer() {
    return this.#tracer;
  }

  /**
   * Check if tracing is enabled and initialized
   */
  isEnabled() {
    return this.#config.enabled && this.#initialized;
  }

  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.#config };
  }
}

/**
 * Create and start a Dynatrace tracer
 * @param {Object} configOptions - Configuration options
 * @returns {OtelDynatrace} Tracer instance
 */
function createTracer(configOptions = {}) {
  const tracer = new OtelDynatrace(configOptions);
  tracer.start();
  return tracer;
}

/**
 * Create Express middleware for automatic tracing
 * @param {OtelDynatrace} tracerInstance - Tracer instance
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware function
 */
function createExpressMiddleware(tracerInstance, options = {}) {
  const opts = {
    autoTrace: true,
    addBusinessContext: true,
    addTimingInfo: true,
    captureRequestBody: false,
    captureResponseBody: false,
    ignoreRoutes: ['/health', '/metrics', '/healthz', '/favicon.ico', '/robots.txt'],
    ignoreMethods: [],
    maxBodySize: 1024,
    ...options
  };

  return (req, res, next) => {
    // Skip if tracing is disabled
    if (!tracerInstance.isEnabled()) {
      return next();
    }

    // Skip ignored routes
    if (opts.ignoreRoutes.some(route => {
      if (typeof route === 'string') {
        return req.path === route || req.path.startsWith(route);
      }
      if (route instanceof RegExp) {
        return route.test(req.path);
      }
      return false;
    })) {
      return next();
    }

    // Skip ignored methods
    if (opts.ignoreMethods.includes(req.method.toUpperCase())) {
      return next();
    }

    const startTime = Date.now();
    const tracer = trace.getTracer(tracerInstance.getConfig().serviceName);
    
    // Create span name
    const spanName = req.route?.path 
      ? `${req.method} ${req.route.path}`
      : `${req.method} ${req.path}`;

    // Start active span
    const span = tracer.startSpan(spanName, {
      attributes: {
        'http.method': req.method,
        'http.url': req.originalUrl || req.url,
        'http.route': req.route?.path || req.path,
        'http.scheme': req.protocol,
        'http.host': req.get('host'),
        'component': 'express'
      }
    });

    // Create context and run middleware in it
    context.with(trace.setSpan(context.active(), span), () => {
      try {
        // Add HTTP context
        if (opts.autoTrace) {
          spanHelpers.addHttpContext(span, req, res);
        }

        // Add business context
        if (opts.addBusinessContext) {
          const businessCtx = {
            http_method: req.method,
            http_path: req.path,
            user_agent: req.get('user-agent'),
            content_type: req.get('content-type')
          };

          // Add custom headers as business context
          const requestId = req.get('x-request-id') || req.get('x-tid') || req.get('x-trace-id');
          if (requestId) {
            businessCtx.request_id = requestId;
          }

          const userId = req.get('x-user-id') || req.user?.id;
          if (userId) {
            businessCtx.user_id = userId;
          }

          spanHelpers.addBusinessContext(span, businessCtx);
        }

        // Add timing information
        if (opts.addTimingInfo) {
          span.setAttribute('http.request.start_time', startTime);
        }

        // Capture request body if enabled
        if (opts.captureRequestBody && req.body) {
          const bodyString = JSON.stringify(req.body);
          if (bodyString.length <= opts.maxBodySize) {
            span.setAttribute('http.request.body', bodyString);
          } else {
            span.setAttribute('http.request.body.size', bodyString.length);
            span.setAttribute('http.request.body.truncated', true);
          }
        }

        // Add query parameters
        if (req.query && Object.keys(req.query).length > 0) {
          span.setAttribute('http.request.query_params', JSON.stringify(req.query));
        }

        // Add route parameters
        if (req.params && Object.keys(req.params).length > 0) {
          span.setAttribute('http.request.route_params', JSON.stringify(req.params));
        }

        // Override response methods to capture response data
        const originalJson = res.json;
        const originalSend = res.send;
        const originalEnd = res.end;

        // Override res.json
        res.json = function(data) {
          if (opts.captureResponseBody && data) {
            const responseString = JSON.stringify(data);
            if (responseString.length <= opts.maxBodySize) {
              span.setAttribute('http.response.body', responseString);
            } else {
              span.setAttribute('http.response.body.size', responseString.length);
              span.setAttribute('http.response.body.truncated', true);
            }
          }
          return originalJson.call(this, data);
        };

        // Override res.send
        res.send = function(data) {
          if (opts.captureResponseBody && data && typeof data === 'string') {
            if (data.length <= opts.maxBodySize) {
              span.setAttribute('http.response.body', data);
            } else {
              span.setAttribute('http.response.body.size', data.length);
              span.setAttribute('http.response.body.truncated', true);
            }
          }
          return originalSend.call(this, data);
        };

        // Override res.end to finalize span
        res.end = function(...args) {
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Add response information
          span.setAttribute('http.status_code', res.statusCode);
          span.setAttribute('http.response.status_code', res.statusCode);
          
          if (opts.addTimingInfo) {
            span.setAttribute('http.request.duration_ms', duration);
            span.setAttribute('http.request.end_time', endTime);
          }

          // Add response headers
          const contentType = res.get('content-type');
          if (contentType) {
            span.setAttribute('http.response.content_type', contentType);
          }

          const contentLength = res.get('content-length');
          if (contentLength) {
            span.setAttribute('http.response.content_length', parseInt(contentLength));
          }

          // Set span status based on response
          if (res.statusCode >= 400) {
            span.setAttribute('error', true);
            
            if (res.statusCode >= 500) {
              span.setAttribute('error.type', 'ServerError');
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: `HTTP ${res.statusCode}`
              });
            } else {
              span.setAttribute('error.type', 'ClientError');
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: `HTTP ${res.statusCode}`
              });
            }
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }

          // End span
          span.end();
          
          // Call original end
          return originalEnd.apply(this, args);
        };

        // Continue to next middleware
        next();

      } catch (error) {
        // Handle middleware errors
        spanHelpers.addErrorDetails(span, error, {
          step: 'express_middleware',
          operation: spanName,
          context: {
            method: req.method,
            url: req.originalUrl,
            duration_ms: Date.now() - startTime
          }
        });

        span.end();
        next(error);
      }
    });
  };
}

/**
 * Create error handling middleware
 * @param {OtelDynatrace} tracerInstance - Tracer instance
 * @param {Object} options - Error middleware options
 * @returns {Function} Express error middleware
 */
function createErrorMiddleware(tracerInstance, options = {}) {
  const opts = {
    logErrors: true,
    includeStackTrace: false,
    addErrorToSpan: true,
    captureErrorDetails: true,
    ...options
  };

  return (error, req, res, next) => {
    if (!tracerInstance.isEnabled()) {
      return next(error);
    }

    try {
      // Get active span
      const activeSpan = trace.getActiveSpan();
      
      if (activeSpan && opts.addErrorToSpan) {
        // Add comprehensive error details
        spanHelpers.addErrorDetails(activeSpan, error, {
          step: 'request_error_handler',
          operation: `${req.method} ${req.originalUrl || req.url}`,
          context: {
            url: req.originalUrl || req.url,
            method: req.method,
            user_agent: req.get('user-agent'),
            content_type: req.get('content-type'),
            request_id: req.get('x-request-id') || req.get('x-tid')
          }
        });

        // Add error classification
        if (error.status || error.statusCode) {
          activeSpan.setAttribute('error.http_status', error.status || error.statusCode);
        }

        if (error.name) {
          activeSpan.setAttribute('error.name', error.name);
        }

        // Add additional error context if available
        if (opts.captureErrorDetails) {
          if (error.code) {
            activeSpan.setAttribute('error.code', error.code);
          }
          
          if (error.syscall) {
            activeSpan.setAttribute('error.syscall', error.syscall);
          }
          
          if (error.errno) {
            activeSpan.setAttribute('error.errno', error.errno);
          }
        }
      }

      // Log error if enabled
      if (opts.logErrors) {
        const errorInfo = {
          message: error.message,
          name: error.name,
          code: error.code,
          status: error.status || error.statusCode,
          url: req.originalUrl || req.url,
          method: req.method,
          timestamp: new Date().toISOString()
        };

        if (opts.includeStackTrace) {
          errorInfo.stack = error.stack;
        }

        console.error('Express error handled:', errorInfo);
      }

    } catch (middlewareError) {
      // Don't let tracing errors break the application
      console.error('Error in tracing error middleware:', middlewareError);
    }

    // Always continue to next error handler
    next(error);
  };
}

/**
 * Create middleware for capturing custom business context
 * @param {Function} contextExtractor - Function to extract business context from request
 * @returns {Function} Express middleware
 */
function createBusinessContextMiddleware(contextExtractor) {
  return (req, res, next) => {
    const activeSpan = trace.getActiveSpan();
    
    if (activeSpan && typeof contextExtractor === 'function') {
      try {
        const businessContext = contextExtractor(req, res);
        if (businessContext && typeof businessContext === 'object') {
          spanHelpers.addBusinessContext(activeSpan, businessContext);
        }
      } catch (error) {
        console.warn('Error extracting business context:', error);
      }
    }
    
    next();
  };
}

// Export helper modules
module.exports = {
  OtelDynatrace,
  createTracer,
  createExpressMiddleware,
  createErrorMiddleware,
  createBusinessContextMiddleware,
  spanHelpers,
  httpTracer,
  databaseTracer,
  DynatraceTracer,
  createConfig
};

// Default export for backward compatibility
module.exports.default = OtelDynatrace;