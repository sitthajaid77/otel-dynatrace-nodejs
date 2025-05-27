// src/config/dynatrace-config.js - Configuration Management (CommonJS)

/**
 * Default configuration for Dynatrace OpenTelemetry
 */
const DEFAULT_CONFIG = {
  // Basic configuration
  serviceName: 'nodejs-service',
  serviceVersion: '1.0.0',
  deploymentEnvironment: 'development',
  enabled: true,
  
  // Dynatrace specific
  dtApiUrl: null,
  dtApiToken: null,
  
  // Performance tuning
  samplingRate: 1.0, // 100% sampling by default
  maxExportBatchSize: 512,
  exportTimeoutMs: 30000,
  scheduledDelayMs: 1000,
  
  // Logging
  logLevel: 'info', // 'debug', 'info', 'warn', 'error', 'silent'
  
  // Custom attributes
  customAttributes: {},
  
  // Instrumentation settings
  instrumentations: {
    http: {
      enabled: true,
      ignoreIncomingPaths: ['/healthz', '/health', '/metrics', '/favicon.ico', '/robots.txt'],
      ignoreOutgoingHosts: ['dynatrace.com', 'prometheus', 'grafana']
    },
    express: {
      enabled: true,
      ignoreLayers: ['cors', 'helmet', 'compression']
    },
    mongoose: {
      enabled: true
    },
    redis: {
      enabled: true
    },
    // Disable noisy instrumentations by default
    dns: { enabled: false },
    net: { enabled: false },
    fs: { enabled: false }
  },
  
  // Advanced settings
  retryConfig: {
    enabled: true,
    initialDelayMillis: 1000,
    maxDelayMillis: 5000,
    maxAttempts: 3
  }
};

/**
 * Environment-specific configuration presets
 */
const ENVIRONMENT_PRESETS = {
  development: {
    samplingRate: 1.0, // 100% sampling for dev
    logLevel: 'debug',
    maxExportBatchSize: 128,
    exportTimeoutMs: 15000
  },
  
  testing: {
    samplingRate: 0.1, // 10% sampling for tests
    logLevel: 'warn',
    maxExportBatchSize: 64,
    exportTimeoutMs: 10000
  },
  
  staging: {
    samplingRate: 0.5, // 50% sampling for staging
    logLevel: 'info',
    maxExportBatchSize: 256,
    exportTimeoutMs: 20000
  },
  
  production: {
    samplingRate: 0.1, // 10% sampling for prod (performance)
    logLevel: 'warn',
    maxExportBatchSize: 1024,
    exportTimeoutMs: 30000,
    // Disable debug instrumentations in production
    instrumentations: {
      dns: { enabled: false },
      net: { enabled: false },
      fs: { enabled: false }
    }
  }
};

/**
 * Service-specific configuration templates
 */
const SERVICE_TEMPLATES = {
  'web-api': {
    instrumentations: {
      http: { enabled: true },
      express: { enabled: true },
      mongoose: { enabled: true },
      redis: { enabled: true }
    },
    customAttributes: {
      'service.type': 'web-api',
      'service.tier': 'api'
    }
  },
  
  'background-worker': {
    instrumentations: {
      http: { enabled: true },
      express: { enabled: false },
      mongoose: { enabled: true },
      redis: { enabled: true }
    },
    customAttributes: {
      'service.type': 'worker',
      'service.tier': 'background'
    }
  },
  
  'microservice': {
    instrumentations: {
      http: { enabled: true },
      express: { enabled: true },
      mongoose: { enabled: true },
      redis: { enabled: false }
    },
    customAttributes: {
      'service.type': 'microservice',
      'service.tier': 'business'
    }
  }
};

/**
 * Dynatrace configuration class
 */
class DynatraceConfig {
  constructor(userConfig = {}) {
    this.config = this._mergeConfigurations(userConfig);
  }
  
  /**
   * Merge user configuration with defaults and presets
   * @param {Object} userConfig - User provided configuration
   * @returns {Object} Merged configuration
   */
  _mergeConfigurations(userConfig) {
    let config = { ...DEFAULT_CONFIG };
    
    // Apply environment preset if specified
    if (userConfig.deploymentEnvironment && ENVIRONMENT_PRESETS[userConfig.deploymentEnvironment]) {
      config = this._deepMerge(config, ENVIRONMENT_PRESETS[userConfig.deploymentEnvironment]);
    }
    
    // Apply service template if specified
    if (userConfig.serviceTemplate && SERVICE_TEMPLATES[userConfig.serviceTemplate]) {
      config = this._deepMerge(config, SERVICE_TEMPLATES[userConfig.serviceTemplate]);
    }
    
    // Apply user configuration
    config = this._deepMerge(config, userConfig);
    
    // Load from environment variables if not provided
    config = this._loadFromEnvironment(config);
    
    return config;
  }
  
  /**
   * Load configuration from environment variables
   * @param {Object} config - Current configuration
   * @returns {Object} Configuration with environment variables
   */
  _loadFromEnvironment(config) {
    const envConfig = { ...config };
    
    // Service information
    if (process.env.SERVICE_NAME) {
      envConfig.serviceName = process.env.SERVICE_NAME;
    }
    
    if (process.env.SERVICE_VERSION) {
      envConfig.serviceVersion = process.env.SERVICE_VERSION;
    }
    
    if (process.env.NODE_ENV) {
      envConfig.deploymentEnvironment = process.env.NODE_ENV;
    }
    
    // Dynatrace configuration
    if (process.env.DT_API_URL) {
      envConfig.dtApiUrl = process.env.DT_API_URL;
    }
    
    if (process.env.DT_API_TOKEN) {
      envConfig.dtApiToken = process.env.DT_API_TOKEN;
    }
    
    // OpenTelemetry settings
    if (process.env.OTEL_ENABLED !== undefined) {
      envConfig.enabled = process.env.OTEL_ENABLED === 'true';
    }
    
    if (process.env.OTEL_SAMPLING_RATE) {
      envConfig.samplingRate = parseFloat(process.env.OTEL_SAMPLING_RATE);
    }
    
    if (process.env.OTEL_LOG_LEVEL) {
      envConfig.logLevel = process.env.OTEL_LOG_LEVEL;
    }
    
    // Custom attributes from environment
    const customAttrs = {};
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('OTEL_ATTR_')) {
        const attrName = key.replace('OTEL_ATTR_', '').toLowerCase();
        customAttrs[attrName] = process.env[key];
      }
    });
    
    if (Object.keys(customAttrs).length > 0) {
      envConfig.customAttributes = { ...envConfig.customAttributes, ...customAttrs };
    }
    
    return envConfig;
  }
  
  /**
   * Deep merge two objects
   * @param {Object} target - Target object
   * @param {Object} source - Source object
   * @returns {Object} Merged object
   */
  _deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
  
  /**
   * Get the complete configuration
   * @returns {Object} Configuration object
   */
  getConfig() {
    return { ...this.config };
  }
  
  /**
   * Get a specific configuration value
   * @param {string} path - Configuration path (e.g., 'instrumentations.http.enabled')
   * @returns {*} Configuration value
   */
  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }
  
  /**
   * Set a configuration value
   * @param {string} path - Configuration path
   * @param {*} value - Value to set
   */
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {};
      return obj[key];
    }, this.config);
    
    target[lastKey] = value;
  }
  
  /**
   * Validate configuration
   * @returns {Object} Validation result with errors
   */
  validate() {
    const errors = [];
    const warnings = [];
    
    // Required fields
    if (!this.config.dtApiUrl) {
      errors.push('dtApiUrl is required');
    }
    
    if (!this.config.dtApiToken) {
      errors.push('dtApiToken is required');
    }
    
    if (!this.config.serviceName) {
      errors.push('serviceName is required');
    }
    
    // URL validation
    if (this.config.dtApiUrl) {
      try {
        new URL(this.config.dtApiUrl);
      } catch (e) {
        errors.push('dtApiUrl must be a valid URL');
      }
    }
    
    // Sampling rate validation
    if (this.config.samplingRate < 0 || this.config.samplingRate > 1) {
      errors.push('samplingRate must be between 0 and 1');
    }
    
    // Performance warnings
    if (this.config.samplingRate === 1.0 && this.config.deploymentEnvironment === 'production') {
      warnings.push('100% sampling rate in production may impact performance');
    }
    
    if (this.config.maxExportBatchSize > 2048) {
      warnings.push('Large batch size may cause memory issues');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * Get configuration summary for logging
   * @returns {Object} Configuration summary
   */
  getSummary() {
    return {
      serviceName: this.config.serviceName,
      serviceVersion: this.config.serviceVersion,
      environment: this.config.deploymentEnvironment,
      enabled: this.config.enabled,
      samplingRate: this.config.samplingRate,
      logLevel: this.config.logLevel,
      apiUrl: this.config.dtApiUrl ? 'configured' : 'missing',
      apiToken: this.config.dtApiToken ? 'configured' : 'missing',
      instrumentations: Object.keys(this.config.instrumentations).filter(
        key => this.config.instrumentations[key].enabled
      )
    };
  }
}

/**
 * Create configuration from environment or user input
 * @param {Object} userConfig - User configuration
 * @returns {DynatraceConfig} Configuration instance
 */
function createConfig(userConfig = {}) {
  return new DynatraceConfig(userConfig);
}

/**
 * Create configuration for specific service types
 * @param {string} serviceType - Service type ('web-api', 'background-worker', 'microservice')
 * @param {Object} userConfig - Additional user configuration
 * @returns {DynatraceConfig} Configuration instance
 */
function createServiceConfig(serviceType, userConfig = {}) {
  return new DynatraceConfig({
    serviceTemplate: serviceType,
    ...userConfig
  });
}

/**
 * Quick configuration for common scenarios
 */
const quickConfigs = {
  /**
   * Development configuration
   */
  development: (serviceName, userConfig = {}) => createConfig({
    serviceName,
    deploymentEnvironment: 'development',
    ...userConfig
  }),
  
  /**
   * Production configuration with performance optimizations
   */
  production: (serviceName, userConfig = {}) => createConfig({
    serviceName,
    deploymentEnvironment: 'production',
    ...userConfig
  }),
  
  /**
   * Testing configuration with minimal overhead
   */
  testing: (serviceName, userConfig = {}) => createConfig({
    serviceName,
    deploymentEnvironment: 'testing',
    ...userConfig
  })
};

// CommonJS exports
module.exports = {
  DynatraceConfig,
  createConfig,
  createServiceConfig,
  quickConfigs
};