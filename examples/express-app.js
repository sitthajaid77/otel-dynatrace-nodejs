// examples/express-app.js - Complete Working Example (CommonJS)

const express = require('express');
const axios = require('axios');
const { 
  createTracer, 
  createExpressMiddleware, 
  createErrorMiddleware,
  spanHelpers,
  httpTracer,
  databaseTracer 
} = require('../src/index.js');

// Initialize Express app
const app = express();
app.use(express.json());

// Create Dynatrace tracer
const tracer = createTracer({
  serviceName: 'otel-dynatrace-example',
  serviceVersion: '1.0.0',
  deploymentEnvironment: process.env.NODE_ENV || 'development',
  dtApiUrl: process.env.DT_API_URL || 'https://your-dynatrace-instance.live.dynatrace.com/api/v2/otlp',
  dtApiToken: process.env.DT_API_TOKEN || 'your-dynatrace-token',
  
  // Custom configuration
  samplingRate: 1.0, // 100% for demo
  logLevel: 'debug',
  customAttributes: {
    'example.type': 'demo-application',
    'example.framework': 'express'
  }
});

// Add OpenTelemetry middleware
app.use(createExpressMiddleware(tracer, {
  autoTrace: true,
  addBusinessContext: true,
  ignoreRoutes: ['/health', '/metrics']
}));

// Add error handling middleware
app.use(createErrorMiddleware(tracer, {
  logErrors: true,
  includeStackTrace: false
}));

// Create traced HTTP client
const tracedHttp = httpTracer.createTracedAxios(axios, {
  clientName: 'example-http-client',
  businessContext: {
    service_type: 'external-api-client'
  }
});

// Simulate database (in real app, use MongoDB/Mongoose)
const mockDatabase = {
  users: [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
  ],
  
  async findUser(id) {
    // Simulate database delay
    await new Promise(resolve => setTimeout(resolve, 50));
    return this.users.find(user => user.id === parseInt(id));
  },
  
  async createUser(userData) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const newUser = { id: Date.now(), ...userData };
    this.users.push(newUser);
    return newUser;
  }
};

// Routes

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * Simple traced operation
 */
app.get('/hello', async (req, res) => {
  // Use span helpers for manual tracing
  return spanHelpers.withBusinessSpanAsync(
    'greet-user',
    { 
      operation_type: 'greeting',
      user_name: req.query.name || 'World'
    },
    async (span) => {
      const name = req.query.name || 'World';
      
      // Add more context to span
      span.setAttribute('greeting.personalized', !!req.query.name);
      span.setAttribute('greeting.language', 'en');
      
      // Simulate some processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const message = `Hello, ${name}!`;
      
      // Add result to span
      span.setAttribute('greeting.message_length', message.length);
      
      res.json({ 
        message,
        timestamp: new Date().toISOString(),
        personalized: !!req.query.name
      });
    },
    { req, res }
  );
});

/**
 * Database operation example
 */
app.get('/users/:id', async (req, res) => {
  return spanHelpers.withBusinessSpanAsync(
    'get-user',
    {
      user_id: req.params.id,
      operation_type: 'user_lookup'
    },
    async (span) => {
      try {
        // Simulate traced database operation
        const user = await databaseTracer.traceDatabaseOperation(
          'findUser',
          () => mockDatabase.findUser(req.params.id),
          {
            system: 'mock-db',
            database: 'example',
            collection: 'users',
            query: { id: req.params.id }
          },
          {
            businessContext: {
              lookup_type: 'user_by_id'
            }
          }
        );
        
        if (!user) {
          span.setAttribute('user.found', false);
          return res.status(404).json({ 
            error: 'User not found',
            user_id: req.params.id
          });
        }
        
        span.setAttribute('user.found', true);
        span.setAttribute('user.name', user.name);
        
        res.json(user);
      } catch (error) {
        // Error handling is automatic with spanHelpers
        throw error;
      }
    },
    { req, res }
  );
});

/**
 * Create user with database operation
 */
app.post('/users', async (req, res) => {
  return spanHelpers.withBusinessSpanAsync(
    'create-user',
    {
      operation_type: 'user_creation',
      has_email: !!req.body.email
    },
    async (span) => {
      // Validate input
      if (!req.body.name || !req.body.email) {
        span.setAttribute('validation.failed', true);
        span.setAttribute('validation.missing_fields', 
          [!req.body.name && 'name', !req.body.email && 'email'].filter(Boolean).join(',')
        );
        
        return res.status(400).json({
          error: 'Name and email are required',
          missing: {
            name: !req.body.name,
            email: !req.body.email
          }
        });
      }
      
      span.setAttribute('validation.passed', true);
      
      // Create user with traced database operation
      const newUser = await databaseTracer.traceDatabaseOperation(
        'createUser',
        () => mockDatabase.createUser({
          name: req.body.name,
          email: req.body.email
        }),
        {
          system: 'mock-db',
          database: 'example',
          collection: 'users'
        },
        {
          businessContext: {
            creation_type: 'api_endpoint'
          }
        }
      );
      
      span.setAttribute('user.created_id', newUser.id);
      span.setAttribute('user.email_domain', req.body.email.split('@')[1]);
      
      res.status(201).json(newUser);
    },
    { req, res }
  );
});

/**
 * External API call example
 */
app.get('/external-data', async (req, res) => {
  return spanHelpers.withBusinessSpanAsync(
    'fetch-external-data',
    {
      operation_type: 'external_api_call',
      data_type: req.query.type || 'default'
    },
    async (span) => {
      try {
        // Make traced HTTP request to external API
        const response = await tracedHttp.get('https://jsonplaceholder.typicode.com/posts/1', {
          timeout: 5000,
          traceOptions: {
            businessContext: {
              api_provider: 'jsonplaceholder',
              data_purpose: 'demo'
            }
          }
        });
        
        span.setAttribute('external_api.response_size', JSON.stringify(response.data).length);
        span.setAttribute('external_api.post_id', response.data.id);
        
        res.json({
          data: response.data,
          metadata: {
            source: 'jsonplaceholder.typicode.com',
            retrieved_at: new Date().toISOString()
          }
        });
      } catch (error) {
        // Add specific context for external API errors
        span.setAttribute('external_api.failed', true);
        if (error.code) {
          span.setAttribute('external_api.error_code', error.code);
        }
        throw error;
      }
    },
    { req, res }
  );
});

/**
 * Error simulation endpoint
 */
app.get('/error', async (req, res) => {
  return spanHelpers.withBusinessSpanAsync(
    'simulate-error',
    {
      operation_type: 'error_simulation',
      error_type: req.query.type || 'generic'
    },
    async (span) => {
      const errorType = req.query.type || 'generic';
      
      span.setAttribute('error_simulation.type', errorType);
      
      // Simulate different types of errors
      switch (errorType) {
        case 'validation':
          throw new Error('Validation failed: Invalid input data');
          
        case 'network':
          const networkError = new Error('Network timeout');
          networkError.code = 'ECONNABORTED';
          throw networkError;
          
        case 'database':
          const dbError = new Error('Database connection failed');
          dbError.code = 11000;
          dbError.codeName = 'DuplicateKey';
          throw dbError;
          
        default:
          throw new Error('Something went wrong');
      }
    },
    { req, res }
  );
});

/**
 * Complex operation with multiple spans
 */
app.post('/complex-operation', async (req, res) => {
  return spanHelpers.withBusinessSpanAsync(
    'complex-operation',
    {
      operation_type: 'multi_step_process',
      steps_count: 3
    },
    async (parentSpan) => {
      const results = {};
      
      // Step 1: Data validation
      await spanHelpers.withSpanAsync(
        'validate-input',
        { step: 1, validation_type: 'input' },
        async (span) => {
          await new Promise(resolve => setTimeout(resolve, 50));
          span.setAttribute('validation.fields_count', Object.keys(req.body).length);
          results.validation = 'passed';
        }
      );
      
      // Step 2: External API call
      await spanHelpers.withSpanAsync(
        'fetch-reference-data',
        { step: 2, data_source: 'external' },
        async (span) => {
          const response = await tracedHttp.get('https://httpbin.org/delay/1');
          span.setAttribute('reference_data.loaded', true);
          results.reference_data = response.status === 200;
        }
      );
      
      // Step 3: Database operation
      await spanHelpers.withSpanAsync(
        'save-result',
        { step: 3, operation: 'create' },
        async (span) => {
          await new Promise(resolve => setTimeout(resolve, 100));
          span.setAttribute('save_operation.simulated', true);
          results.saved = true;
        }
      );
      
      parentSpan.setAttribute('complex_operation.completed_steps', 3);
      parentSpan.setAttribute('complex_operation.success', true);
      
      res.json({
        success: true,
        results,
        completed_at: new Date().toISOString()
      });
    },
    { req, res }
  );
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Example app running on port ${PORT}`);
  console.log(`📊 Dynatrace tracing: ${tracer.isEnabled() ? 'ENABLED' : 'DISABLED'}`);
  console.log('\n📋 Available endpoints:');
  console.log('  GET  /health              - Health check');
  console.log('  GET  /hello?name=John     - Simple traced operation');
  console.log('  GET  /users/1             - Database operation example');
  console.log('  POST /users               - Create user (send {name, email})');
  console.log('  GET  /external-data       - External API call');
  console.log('  GET  /error?type=network  - Error simulation');
  console.log('  POST /complex-operation   - Multi-step traced operation');
  console.log('\nExample curl commands:');
  console.log(`  curl http://localhost:${PORT}/hello?name=World`);
  console.log(`  curl http://localhost:${PORT}/users/1`);
  console.log(`  curl -X POST http://localhost:${PORT}/users -H "Content-Type: application/json" -d '{"name":"Alice","email":"alice@example.com"}'`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await tracer.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await tracer.shutdown();
  process.exit(0);
});

module.exports = app;