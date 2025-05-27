# @ais/otel-dynatrace-nodejs

OpenTelemetry Dynatrace instrumentation library for Node.js applications with Express.js support.

## 🚀 Features

- ✅ **Easy Integration** - One-line setup for Express.js applications
- ✅ **Automatic Instrumentation** - HTTP, Express, MongoDB, Redis tracing out-of-the-box
- ✅ **Enhanced Error Tracking** - Rich error context and stack traces in Dynatrace
- ✅ **Business Context** - Add custom business attributes to traces
- ✅ **Performance Optimized** - Configurable sampling rates and batch processing
- ✅ **Environment Aware** - Different configurations for dev/staging/production
- ✅ **TypeScript Ready** - Full TypeScript support (coming soon)

## 📦 Installation

### From GitHub (Recommended for Internal Use)

```bash
npm install git+https://github.com/ais-internal/otel-dynatrace-nodejs.git
```

### From Private npm Registry

```bash
npm install @ais/otel-dynatrace-nodejs --registry=https://your-registry.com
```

### Development Installation

```bash
git clone https://github.com/ais-internal/otel-dynatrace-nodejs.git
cd otel-dynatrace-nodejs
npm install
npm link

# In your project
npm link @ais/otel-dynatrace-nodejs
```

## 🎯 Quick Start

### Basic Setup

```javascript
import { createTracer, createExpressMiddleware } from '@ais/otel-dynatrace-nodejs';
import express from 'express';

const app = express();

// Create tracer
const tracer = createTracer({
  serviceName: 'my-service',
  dtApiUrl: process.env.DT_API_URL,
  dtApiToken: process.env.DT_API_TOKEN,
  deploymentEnvironment: process.env.NODE_ENV
});

// Add middleware
app.use(createExpressMiddleware(tracer));

// Your routes...
app.get('/api/users', (req, res) => {
  // Automatically traced!
  res.json({ users: [] });
});

app.listen(3000);
```

### Environment Variables

```bash
# Required
DT_API_URL=https://your-instance.live.dynatrace.com/api/v2/otlp
DT_API_TOKEN=your-dynatrace-token

# Optional
SERVICE_NAME=my-service
SERVICE_VERSION=1.0.0
NODE_ENV=production
OTEL_ENABLED=true
OTEL_SAMPLING_RATE=0.1
OTEL_LOG_LEVEL=info
```

## 📚 Usage Examples

### Manual Span Creation

```javascript
import { spanHelpers } from '@ais/otel-dynatrace-nodejs';

app.post('/api/process', async (req, res) => {
  return spanHelpers.withBusinessSpanAsync(
    'process-data',
    {
      user_id: req.body.userId,
      operation_type: 'data_processing'
    },
    async (span) => {
      // Your business logic here
      const result = await processData(req.body);
      
      // Add more context
      span.setAttribute('processing.records_count', result.count);
      span.setAttribute('processing.duration_ms', result.duration);
      
      res.json(result);
    },
    { req, res }
  );
});
```

### HTTP Request Tracing

```javascript
import { httpTracer } from '@ais/otel-dynatrace-nodejs';
import axios from 'axios';

// Create traced HTTP client
const tracedHttp = httpTracer.createTracedAxios(axios, {
  clientName: 'external-api-client',
  businessContext: {
    service_type: 'external-integration'
  }
});

// Use it in your routes
app.get('/api/external-data', async (req, res) => {
  const response = await tracedHttp.get('https://api.example.com/data', {
    traceOptions: {
      businessContext: {
        data_source: 'partner-api',
        request_id: req.headers['x-request-id']
      }
    }
  });
  
  res.json(response.data);
});
```

### Database Operation Tracing

```javascript
import { databaseTracer } from '@ais/otel-dynatrace-nodejs';

// Trace MongoDB operations
const TracedUser = databaseTracer.createTracedMongooseModel(UserModel, {
  database: 'myapp',
  collectionName: 'users'
});

app.get('/api/users/:id', async (req, res) => {
  const user = await TracedUser.findById(req.params.id, {
    traceOptions: {
      businessContext: {
        lookup_type: 'user_profile',
        request_source: 'api'
      }
    }
  });
  
  res.json(user);
});
```

### Error Handling

```javascript
import { createErrorMiddleware } from '@ais/otel-dynatrace-nodejs';

// Add error middleware
app.use(createErrorMiddleware(tracer, {
  logErrors: true,
  includeStackTrace: false
}));

// Errors are automatically traced with context
app.get('/api/might-fail', async (req, res) => {
  throw new Error('Something went wrong'); // Automatically traced!
});
```

## ⚙️ Configuration

### Basic Configuration

```javascript
const tracer = createTracer({
  serviceName: 'my-service',
  serviceVersion: '1.0.0',
  dtApiUrl: 'https://your-instance.live.dynatrace.com/api/v2/otlp',
  dtApiToken: 'your-token',
  deploymentEnvironment: 'production'
});
```

### Advanced Configuration

```javascript
const tracer = createTracer({
  serviceName: 'my-service',
  
  // Performance tuning
  samplingRate: 0.1, // 10% sampling for production
  maxExportBatchSize: 512,
  exportTimeoutMs: 30000,
  
  // Custom attributes
  customAttributes: {
    'team': 'backend',
    'component': 'api-gateway'
  },
  
  // Instrumentation control
  instrumentations: {
    http: { enabled: true },
    express: { enabled: true },
    mongoose: { enabled: true },
    redis: { enabled: false }
  }
});
```

### Environment-Specific Configurations

```javascript
import { quickConfigs } from '@ais/otel-dynatrace-nodejs';

// Development (100% sampling, debug logs)
const devTracer = quickConfigs.development('my-service', {
  dtApiUrl: process.env.DT_API_URL,
  dtApiToken: process.env.DT_API_TOKEN
});

// Production (optimized performance)
const prodTracer = quickConfigs.production('my-service', {
  dtApiUrl: process.env.DT_API_URL,
  dtApiToken: process.env.DT_API_TOKEN
});
```

### Service Templates

```javascript
import { createServiceConfig } from '@ais/otel-dynatrace-nodejs';

// Web API configuration
const webApiConfig = createServiceConfig('web-api', {
  serviceName: 'user-api',
  dtApiUrl: process.env.DT_API_URL,
  dtApiToken: process.env.DT_API_TOKEN
});

// Background worker configuration
const workerConfig = createServiceConfig('background-worker', {
  serviceName: 'data-processor',
  dtApiUrl: process.env.DT_API_URL,
  dtApiToken: process.env.DT_API_TOKEN
});
```

## 🔧 API Reference

### Core Classes

#### `DynatraceTracer`

Main tracer class for OpenTelemetry integration.

```javascript
const tracer = new DynatraceTracer(config);
tracer.initialize();
tracer.start();
```

Methods:
- `initialize()` - Initialize OpenTelemetry
- `start()` - Start tracing
- `shutdown()` - Graceful shutdown
- `getTracer()` - Get OpenTelemetry tracer instance
- `isEnabled()` - Check if tracing is enabled

#### `DynatraceConfig`

Configuration management class.

```javascript
const config = new DynatraceConfig(userConfig);
const validation = config.validate();
```

### Helper Functions

#### `spanHelpers`

Utilities for creating and managing spans.

- `withSpan(name, attributes, callback)` - Synchronous span wrapper
- `withSpanAsync(name, attributes, callback)` - Asynchronous span wrapper
- `withBusinessSpan(name, context, callback)` - Business operation wrapper
- `addBusinessContext(span, context)` - Add business attributes
- `addErrorDetails(span, error, options)` - Add error information
- `addHttpContext(span, req, res)` - Add HTTP context

#### `httpTracer`

HTTP request tracing utilities.

- `createTracedAxios(axios, options)` - Create traced axios instance
- `createTracedFetch(fetch, options)` - Create traced fetch function
- `createServiceClient(serviceName, httpClient)` - Service-specific client

#### `databaseTracer`

Database operation tracing utilities.

- `createTracedMongooseModel(model, options)` - Traced Mongoose model
- `createTracedMongoCollection(collection, options)` - Traced MongoDB collection
- `createTracedRedisClient(client, options)` - Traced Redis client

### Middleware

#### `createExpressMiddleware(tracer, options)`

Express.js integration middleware.

Options:
- `autoTrace` (boolean) - Automatic request tracing
- `addBusinessContext` (boolean) - Add business attributes
- `ignoreRoutes` (array) - Routes to ignore

#### `createErrorMiddleware(tracer, options)`

Error handling middleware for Express.js.

Options:
- `logErrors` (boolean) - Log errors to console
- `includeStackTrace` (boolean) - Include full stack trace

## 📊 What You'll See in Dynatrace

### Trace Information
- **Service Name**: Your configured service name
- **Operation Names**: HTTP endpoints, database operations, custom spans
- **Duration**: Accurate timing for all operations
- **Status**: Success/Error status with details

### Business Context
- **Custom Attributes**: All business context you add
- **User Information**: User IDs, transaction IDs
- **Operation Details**: Record counts, processing types, etc.

### Error Information
- **Error Type**: JavaScript error class name
- **Error Message**: Full error message
- **Stack Trace**: Relevant stack trace information
- **Error Context**: Where the error occurred, related data

### HTTP Context
- **Request Method**: GET, POST, etc.
- **Request URL**: Full request path
- **Status Code**: HTTP response status
- **Headers**: Relevant request/response headers
- **User Agent**: Client information

### Database Context
- **Operation Type**: find, insert, update, delete
- **Collection/Table**: Database collection name
- **Query Performance**: Duration and result counts
- **Connection Info**: Database host and connection details

## 🛠️ Development

### Running Examples

```bash
# Clone the repository
git clone https://github.com/ais-internal/otel-dynatrace-nodejs.git
cd otel-dynatrace-nodejs

# Install dependencies
npm install

# Set environment variables
export DT_API_URL="https://your-instance.live.dynatrace.com/api/v2/otlp"
export DT_API_TOKEN="your-dynatrace-token"

# Run example app
npm run example:express
```

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

## 🔒 Security Considerations

- **Token Security**: Never commit Dynatrace tokens to version control
- **Data Sanitization**: The library automatically redacts sensitive headers
- **Query Safety**: Database queries are not logged in full for security
- **Environment Separation**: Use different tokens for different environments

## 📈 Performance Considerations

### Production Settings

```javascript
const tracer = createTracer({
  samplingRate: 0.1, // 10% sampling reduces overhead
  maxExportBatchSize: 1024, // Larger batches for efficiency
  deploymentEnvironment: 'production' // Optimized settings
});
```

### Sampling Recommendations

- **Development**: 100% sampling for complete visibility
- **Staging**: 50% sampling for realistic testing
- **Production**: 10-20% sampling for performance

## 🐛 Troubleshooting

### Common Issues

**1. No traces appearing in Dynatrace**
- Verify `DT_API_URL` and `DT_API_TOKEN` are correct
- Check network connectivity to Dynatrace
- Ensure sampling rate > 0
- Check console logs for initialization errors

**2. High memory usage**
- Reduce `maxExportBatchSize`
- Lower `samplingRate` in production
- Check for memory leaks in custom spans

**3. Performance impact**
- Use lower sampling rates in production
- Disable unnecessary instrumentations
- Monitor export timeout settings

### Debug Mode

```javascript
const tracer = createTracer({
  logLevel: 'debug', // Enable debug logging
  // ... other config
});
```

### Validation

```javascript
const config = new DynatraceConfig(yourConfig);
const { isValid, errors, warnings } = config.validate();

if (!isValid) {
  console.error('Configuration errors:', errors);
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
- Create an issue on GitHub
- Contact the AIS Backend Team
- Check Dynatrace documentation for OpenTelemetry

## 📚 Related Documentation

- [OpenTelemetry JavaScript Documentation](https://opentelemetry.io/docs/instrumentation/js/)
- [Dynatrace OpenTelemetry Documentation](https://docs.dynatrace.com/docs/ingest-from/opentelemetry)
- [Express.js Documentation](https://expressjs.com/)

---