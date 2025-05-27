// src/helpers/database-tracer.js - Database Operation Tracing (CommonJS)

const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { addErrorDetails, addDatabaseContext } = require('./span-helpers.js');

/**
 * Trace database operations with automatic span creation and error handling
 * @param {string} operation - Database operation name
 * @param {Function} dbFunction - Database function to execute
 * @param {Object} context - Database operation context
 * @param {Object} traceOptions - Tracing options
 * @returns {Promise} Database operation result
 */
async function traceDatabaseOperation(operation, dbFunction, context = {}, traceOptions = {}) {
  const tracer = trace.getActiveTracer() || trace.getTracer('database-tracer');
  const spanName = traceOptions.spanName || `DB ${operation}`;
  
  return tracer.startActiveSpan(spanName, {
    attributes: {
      'db.operation': operation,
      'db.system': context.system || 'unknown',
      'component': 'database'
    }
  }, async (span) => {
    const startTime = Date.now();
    
    try {
      // Add database context to span
      addDatabaseContext(span, {
        type: operation,
        database: context.database,
        collection: context.collection || context.table,
        ...context
      });
      
      // Add query information (safely)
      if (context.query) {
        // Only log query structure for security
        span.setAttribute('db.statement.type', typeof context.query);
        
        // Add query operation if it's a string query
        if (typeof context.query === 'string') {
          const queryType = context.query.trim().split(' ')[0].toUpperCase();
          span.setAttribute('db.statement.operation', queryType);
        }
        
        // Add query parameters count if available
        if (context.parameters) {
          span.setAttribute('db.statement.parameters_count', 
            Array.isArray(context.parameters) ? context.parameters.length : Object.keys(context.parameters).length
          );
        }
      }
      
      // Add connection information
      if (context.host) {
        span.setAttribute('db.connection_string', `${context.host}:${context.port || 'default'}`);
      }
      
      if (context.user) {
        span.setAttribute('db.user', context.user);
      }
      
      // Execute database operation
      span.setAttribute('db.operation.start_time', startTime);
      const result = await dbFunction();
      const duration = Date.now() - startTime;
      
      // Add operation results
      span.setAttribute('db.operation.duration_ms', duration);
      span.setAttribute('db.operation.success', true);
      
      // Add result information (safely)
      if (result) {
        // For array results (find operations)
        if (Array.isArray(result)) {
          span.setAttribute('db.result.count', result.length);
          span.setAttribute('db.result.type', 'array');
        }
        // For objects with count information
        else if (typeof result === 'object') {
          if (result.insertedCount !== undefined) {
            span.setAttribute('db.result.inserted_count', result.insertedCount);
          }
          if (result.modifiedCount !== undefined) {
            span.setAttribute('db.result.modified_count', result.modifiedCount);
          }
          if (result.deletedCount !== undefined) {
            span.setAttribute('db.result.deleted_count', result.deletedCount);
          }
          if (result.matchedCount !== undefined) {
            span.setAttribute('db.result.matched_count', result.matchedCount);
          }
          if (result.acknowledged !== undefined) {
            span.setAttribute('db.result.acknowledged', result.acknowledged);
          }
        }
      }
      
      // Add business context if provided
      if (traceOptions.businessContext) {
        Object.entries(traceOptions.businessContext).forEach(([key, value]) => {
          span.setAttribute(`business.${key}`, String(value));
        });
      }
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      addErrorDetails(span, error, {
        step: 'database_operation',
        operation: operation,
        context: {
          database: context.database,
          collection: context.collection || context.table,
          operation,
          duration_ms: duration,
          system: context.system
        }
      });
      
      // Add database-specific error information
      if (error.code) {
        span.setAttribute('db.error.code', error.code);
      }
      
      if (error.codeName) {
        span.setAttribute('db.error.code_name', error.codeName);
      }
      
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Create traced MongoDB operations
 * @param {Object} mongoCollection - MongoDB collection instance
 * @param {Object} options - Tracing options
 * @returns {Object} Traced MongoDB collection wrapper
 */
function createTracedMongoCollection(mongoCollection, options = {}) {
  const { database = 'unknown', collectionName } = options;
  
  const createContext = (operation, query = null, extraContext = {}) => ({
    system: 'mongodb',
    database,
    collection: collectionName || mongoCollection.collectionName,
    query,
    ...extraContext
  });
  
  return {
    // Find operations
    find: (query, options = {}) => 
      traceDatabaseOperation(
        'find',
        () => mongoCollection.find(query, options).toArray(),
        createContext('find', query),
        options.traceOptions || {}
      ),
    
    findOne: (query, options = {}) => 
      traceDatabaseOperation(
        'findOne',
        () => mongoCollection.findOne(query, options),
        createContext('findOne', query),
        options.traceOptions || {}
      ),
    
    // Insert operations
    insertOne: (document, options = {}) => 
      traceDatabaseOperation(
        'insertOne',
        () => mongoCollection.insertOne(document, options),
        createContext('insertOne', null, { document_keys: Object.keys(document || {}) }),
        options.traceOptions || {}
      ),
    
    insertMany: (documents, options = {}) => 
      traceDatabaseOperation(
        'insertMany',
        () => mongoCollection.insertMany(documents, options),
        createContext('insertMany', null, { documents_count: documents.length }),
        options.traceOptions || {}
      ),
    
    // Update operations
    updateOne: (filter, update, options = {}) => 
      traceDatabaseOperation(
        'updateOne',
        () => mongoCollection.updateOne(filter, update, options),
        createContext('updateOne', filter),
        options.traceOptions || {}
      ),
    
    updateMany: (filter, update, options = {}) => 
      traceDatabaseOperation(
        'updateMany',
        () => mongoCollection.updateMany(filter, update, options),
        createContext('updateMany', filter),
        options.traceOptions || {}
      ),
    
    findOneAndUpdate: (filter, update, options = {}) => 
      traceDatabaseOperation(
        'findOneAndUpdate',
        () => mongoCollection.findOneAndUpdate(filter, update, options),
        createContext('findOneAndUpdate', filter),
        options.traceOptions || {}
      ),
    
    // Delete operations
    deleteOne: (filter, options = {}) => 
      traceDatabaseOperation(
        'deleteOne',
        () => mongoCollection.deleteOne(filter, options),
        createContext('deleteOne', filter),
        options.traceOptions || {}
      ),
    
    deleteMany: (filter, options = {}) => 
      traceDatabaseOperation(
        'deleteMany',
        () => mongoCollection.deleteMany(filter, options),
        createContext('deleteMany', filter),
        options.traceOptions || {}
      ),
    
    // Aggregation
    aggregate: (pipeline, options = {}) => 
      traceDatabaseOperation(
        'aggregate',
        () => mongoCollection.aggregate(pipeline, options).toArray(),
        createContext('aggregate', null, { pipeline_stages: pipeline.length }),
        options.traceOptions || {}
      ),
    
    // Count operations
    countDocuments: (query = {}, options = {}) => 
      traceDatabaseOperation(
        'countDocuments',
        () => mongoCollection.countDocuments(query, options),
        createContext('countDocuments', query),
        options.traceOptions || {}
      ),
    
    // Index operations
    createIndex: (keys, options = {}) => 
      traceDatabaseOperation(
        'createIndex',
        () => mongoCollection.createIndex(keys, options),
        createContext('createIndex', null, { index_keys: Object.keys(keys || {}) }),
        options.traceOptions || {}
      )
  };
}

/**
 * Create traced Mongoose model wrapper
 * @param {Object} mongooseModel - Mongoose model
 * @param {Object} options - Tracing options
 * @returns {Object} Traced Mongoose model wrapper
 */
function createTracedMongooseModel(mongooseModel, options = {}) {
  const modelName = mongooseModel.modelName || 'unknown';
  
  const createContext = (operation, query = null, extraContext = {}) => ({
    system: 'mongoose',
    database: mongooseModel.db?.name || 'unknown',
    collection: mongooseModel.collection?.name || modelName.toLowerCase(),
    model: modelName,
    query,
    ...extraContext
  });
  
  return {
    // Find operations
    find: (query, options = {}) => 
      traceDatabaseOperation(
        'find',
        () => mongooseModel.find(query, null, options),
        createContext('find', query),
        options.traceOptions || {}
      ),
    
    findOne: (query, options = {}) => 
      traceDatabaseOperation(
        'findOne',
        () => mongooseModel.findOne(query, null, options),
        createContext('findOne', query),
        options.traceOptions || {}
      ),
    
    findById: (id, options = {}) => 
      traceDatabaseOperation(
        'findById',
        () => mongooseModel.findById(id, null, options),
        createContext('findById', { _id: id }),
        options.traceOptions || {}
      ),
    
    // Create operations
    create: (docs, options = {}) => 
      traceDatabaseOperation(
        'create',
        () => mongooseModel.create(docs, options),
        createContext('create', null, { 
          documents_count: Array.isArray(docs) ? docs.length : 1 
        }),
        options.traceOptions || {}
      ),
    
    // Update operations
    updateOne: (filter, update, options = {}) => 
      traceDatabaseOperation(
        'updateOne',
        () => mongooseModel.updateOne(filter, update, options),
        createContext('updateOne', filter),
        options.traceOptions || {}
      ),
    
    updateMany: (filter, update, options = {}) => 
      traceDatabaseOperation(
        'updateMany',
        () => mongooseModel.updateMany(filter, update, options),
        createContext('updateMany', filter),
        options.traceOptions || {}
      ),
    
    findOneAndUpdate: (filter, update, options = {}) => 
      traceDatabaseOperation(
        'findOneAndUpdate',
        () => mongooseModel.findOneAndUpdate(filter, update, options),
        createContext('findOneAndUpdate', filter),
        options.traceOptions || {}
      ),
    
    // Delete operations
    deleteOne: (filter, options = {}) => 
      traceDatabaseOperation(
        'deleteOne',
        () => mongooseModel.deleteOne(filter, options),
        createContext('deleteOne', filter),
        options.traceOptions || {}
      ),
    
    deleteMany: (filter, options = {}) => 
      traceDatabaseOperation(
        'deleteMany',
        () => mongooseModel.deleteMany(filter, options),
        createContext('deleteMany', filter),
        options.traceOptions || {}
      ),
    
    // Aggregation
    aggregate: (pipeline, options = {}) => 
      traceDatabaseOperation(
        'aggregate',
        () => mongooseModel.aggregate(pipeline, options),
        createContext('aggregate', null, { pipeline_stages: pipeline.length }),
        options.traceOptions || {}
      ),
    
    // Count operations
    countDocuments: (query = {}, options = {}) => 
      traceDatabaseOperation(
        'countDocuments',
        () => mongooseModel.countDocuments(query, options),
        createContext('countDocuments', query),
        options.traceOptions || {}
      )
  };
}

/**
 * Create traced Redis client wrapper
 * @param {Object} redisClient - Redis client instance
 * @param {Object} options - Tracing options
 * @returns {Object} Traced Redis client wrapper
 */
function createTracedRedisClient(redisClient, options = {}) {
  const { host = 'unknown', port = 'unknown' } = options;
  
  const createContext = (operation, key = null, extraContext = {}) => ({
    system: 'redis',
    host,
    port,
    operation,
    key,
    ...extraContext
  });
  
  return {
    get: (key, options = {}) => 
      traceDatabaseOperation(
        'get',
        () => redisClient.get(key),
        createContext('get', key),
        options.traceOptions || {}
      ),
    
    set: (key, value, options = {}) => 
      traceDatabaseOperation(
        'set',
        () => redisClient.set(key, value),
        createContext('set', key, { value_type: typeof value }),
        options.traceOptions || {}
      ),
    
    del: (key, options = {}) => 
      traceDatabaseOperation(
        'del',
        () => redisClient.del(key),
        createContext('del', key),
        options.traceOptions || {}
      ),
    
    exists: (key, options = {}) => 
      traceDatabaseOperation(
        'exists',
        () => redisClient.exists(key),
        createContext('exists', key),
        options.traceOptions || {}
      ),
    
    expire: (key, seconds, options = {}) => 
      traceDatabaseOperation(
        'expire',
        () => redisClient.expire(key, seconds),
        createContext('expire', key, { ttl_seconds: seconds }),
        options.traceOptions || {}
      )
  };
}

// CommonJS exports
module.exports = {
  traceDatabaseOperation,
  createTracedMongoCollection,
  createTracedMongooseModel,
  createTracedRedisClient
};