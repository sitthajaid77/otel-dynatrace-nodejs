// src/index.js - Fixed OTLP Endpoint Configuration

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

    // ✅ FIXED: Correct OTLP endpoint URL construction
    const otlpTraceUrl = `${this.#config.dtApiUrl}/v1/traces`;
    
    // Create trace exporter for Dynatrace
    const traceExporter = new OTLPTraceExporter({
      url: otlpTraceUrl,
      headers: { 
        Authorization: `Api-Token ${this.#config.dtApiToken}`,
        // ✅ REMOVED: Let the library handle Content-Type automatically
      },
    });

    // 🔧 DEBUG LOGGING: Enhanced debugging
    console.log(`🔧 ODN Debug Configuration:`);
    console.log(`- Service: ${this.#config.serviceName}`);
    console.log(`- Environment: ${this.#config.deploymentEnvironment}`);
    console.log(`- OTLP URL: ${otlpTraceUrl}`);
    console.log(`- Token: ${this.#config.dtApiToken ? this.#config.dtApiToken.substring(0, 15) + '...' : 'MISSING'}`);
    console.log(`- Sampling Rate: ${this.#config.samplingRate}`);
    console.log(`- Enabled: ${this.#config.enabled}`);

    // Override export method to add detailed logging
    const originalExport = traceExporter.export.bind(traceExporter);
    traceExporter.export = (spans, resultCallback) => {
      console.log(`📤 ODN: Attempting to export ${spans.length} spans to Dynatrace`);
      console.log(`📤 ODN: Export URL: ${otlpTraceUrl}`);
      
      // Log span details for debugging
      spans.forEach((span, index) => {
        console.log(`📤 ODN: Span ${index + 1}: ${span.name} (${span.spanContext().spanId})`);
      });
      
      return originalExport(spans, (result) => {
        if (result.code === 0) {
          console.log(`✅ ODN: Successfully exported ${spans.length} spans to Dynatrace`);
        } else {
          console.error(`❌ ODN: Failed to export spans to Dynatrace:`, {
            code: result.code,
            error: result.error,
            url: otlpTraceUrl
          });
        }
        resultCallback(result);
      });
    };

    // Create batch span processor with appropriate settings
    const spanProcessor = new BatchSpanProcessor(traceExporter, {
      maxExportBatchSize: this.#config.maxExportBatchSize,
      exportTimeoutMillis: this.#config.exportTimeoutMs,
      scheduledDelayMillis: 1000, // Export every 1 second for faster feedback
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
      console.log('✅ OpenTelemetry initialized for Dynatrace:', summary);
      
      // ✅ ENHANCED: Create multiple test spans for better validation
      setTimeout(() => {
        this.#createTestSpans();
      }, 2000);
      
    } catch (error) {
      console.error('❌ Failed to start OpenTelemetry:', error);
      throw error;
    }
  }

  /**
   * Create test spans for validation
   */
  #createTestSpans() {
    try {
      const testTracer = trace.getTracer('odn-test');
      
      // Test span 1: Basic test
      const span1 = testTracer.startSpan('odn-test-basic');
      span1.setAttribute('test.source', 'odn-library');
      span1.setAttribute('test.timestamp', Date.now());
      span1.setAttribute('test.type', 'basic');
      span1.end();
      
      // Test span 2: Business operation simulation
      const span2 = testTracer.startSpan('odn-test-business-operation');
      span2.setAttribute('business.operation', 'test-process');
      span2.setAttribute('business.user_id', 'test-user-123');
      span2.setAttribute('test.source', 'odn-library');
      span2.setAttribute('test.type', 'business');
      span2.end();
      
      // Test span 3: HTTP operation simulation
      const span3 = testTracer.startSpan('odn-test-http-request');
      span3.setAttribute('http.method', 'GET');
      span3.setAttribute('http.url', '/test/endpoint');
      span3.setAttribute('http.status_code', 200);
      span3.setAttribute('test.source', 'odn-library');
      span3.setAttribute('test.type', 'http');
      span3.end();
      
      console.log('🧪 ODN: Created 3 test spans for validation');
      
      // Force flush after creating test spans
      setTimeout(async () => {
        try {
          await this.#sdk.shutdown();
          await this.start(); // Restart to continue normal operation
          console.log('🧪 ODN: Test spans flushed, SDK restarted');
        } catch (flushError) {
          console.error('❌ ODN: Error flushing test spans:', flushError);
        }
      }, 3000);
      
    } catch (error) {
      console.error('❌ ODN: Error creating test spans:', error);
    }
  }

  /**
   * Shutdown OpenTelemetry
   */
  async shutdown() {
    if (this.#initialized) {
      try {
        await this.#sdk.shutdown();
        this.#initialized = false;
        console.log('✅ OpenTelemetry shutdown completed');
      } catch (error) {
        console.error('❌ Error during OpenTelemetry shutdown:', error);
      }
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

// Rest of the code remains the same...
// [Include all other functions: createTracer, createExpressMiddleware, etc.]

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

module.exports.default = OtelDynatrace;