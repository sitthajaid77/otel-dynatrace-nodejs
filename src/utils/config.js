// src/utils/config.js - Configuration Management Utilities

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  serviceName: 'nodejs-service',
  serviceVersion: '1.0.0',
  deploymentEnvironment: 'development',
  enabled: true,
  
  // Dynatrace settings
  dtApiUrl: null,
  dtApiToken: null,
  
  // Performance settings
  samplingRate: 1.0,
  maxExportBatchSize: 512,
  exportTimeoutMs: 30000,
  
  // Auto instrumentations
  autoInstrumentations: ['http', 'express'],
  
  // Logging
  logLevel: 'info'
};

/**
 * Environment-specific presets
 */
const ENVIRONMENT_PRESETS = {
  development: {
    samplingRate: 1.0,
    logLevel: 'debug',
    maxExportBatchSize: 128
  },
  production: {
    samplingRate: 0.1,
    logLevel: 'warn',
    maxExportBatchSize: 1024
  },
  staging: {
    samplingRate: 0.5,
    logLevel: 'info',
    maxExportBatchSize: 256
  }
};

/**
 * Load configuration from environment variables
 * @param {Object} baseConfig - Base configuration
 * @returns {Object} Configuration with environment variables applied
 */
function loadFromEnvironment(baseConfig) {
  const config = { ...baseConfig };
  
  // Service info
  if (process.env.SERVICE_NAME) {
    config.serviceName = process.env.SERVICE_NAME;
  }
  
  if (process.env.SERVICE_VERSION) {
    config.serviceVersion = process.env.SERVICE_VERSION;
  }
  
  if (process.env.NODE_ENV) {
    config.deploymentEnvironment = process.env.NODE_ENV;
  }
  
  // Dynatrace settings
  if (process.env.DT_API_URL) {
    config.dtApiUrl = process.env.DT_API_URL;
  }
  
  if (process.env.DT_API_TOKEN) {
    config.dtApiToken = process.env.DT_API_TOKEN;
  }
  
  // OpenTelemetry settings
  if (process.env.OTEL_ENABLED !== undefined) {
    config.enabled = process.env.OTEL_ENABLED === 'true';
  }
  
  if (process.env.OTEL_SAMPLING_RATE) {
    config.samplingRate = parseFloat(process.env.OTEL_SAMPLING_RATE);
  }
  
  if (process.env.OTEL_LOG_LEVEL) {
    config.logLevel = process.env.OTEL_LOG_LEVEL;
  }
  
  return config;
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Validate configuration
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result
 */
function validateConfig(config) {
  const errors = [];
  const warnings = [];
  
  // Required fields
  if (!config.dtApiUrl) {
    errors.push('dtApiUrl is required');
  }
  
  if (!config.dtApiToken) {
    errors.push('dtApiToken is required');
  }
  
  if (!config.serviceName) {
    errors.push('serviceName is required');
  }
  
  // URL validation
  if (config.dtApiUrl) {
    try {
      new URL(config.dtApiUrl);
    } catch (e) {
      errors.push('dtApiUrl must be a valid URL');
    }
  }
  
  // Sampling rate validation
  if (config.samplingRate < 0 || config.samplingRate > 1) {
    errors.push('samplingRate must be between 0 and 1');
  }
  
  // Performance warnings
  if (config.samplingRate === 1.0 && config.deploymentEnvironment === 'production') {
    warnings.push('100% sampling rate in production may impact performance');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get merged configuration with defaults, environment presets, and user config
 * @param {Object} userConfig - User provided configuration
 * @returns {Object} Final configuration
 */
export function getConfig(userConfig = {}) {
  let config = { ...DEFAULT_CONFIG };
  
  // Apply environment preset if available
  const environment = userConfig.deploymentEnvironment || process.env.NODE_ENV || 'development';
  if (ENVIRONMENT_PRESETS[environment]) {
    config = deepMerge(config, ENVIRONMENT_PRESETS[environment]);
  }
  
  // Apply user configuration
  config = deepMerge(config, userConfig);
  
  // Load from environment variables
  config = loadFromEnvironment(config);
  
  // Set environment for reference
  config.deploymentEnvironment = environment;
  
  return config;
}

/**
 * Create and validate configuration
 * @param {Object} userConfig - User configuration
 * @returns {Object} Validated configuration
 */
export function createConfig(userConfig = {}) {
  const config = getConfig(userConfig);
  const validation = validateConfig(config);
  
  if (!validation.isValid) {
    throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
  }
  
  if (validation.warnings.length > 0) {
    console.warn('Configuration warnings:', validation.warnings);
  }
  
  return config;
}

/**
 * Get configuration summary for logging
 * @param {Object} config - Configuration object
 * @returns {Object} Configuration summary
 */
export function getConfigSummary(config) {
  return {
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    environment: config.deploymentEnvironment,
    enabled: config.enabled,
    samplingRate: config.samplingRate,
    logLevel: config.logLevel,
    dtApiUrl: config.dtApiUrl ? 'configured' : 'missing',
    dtApiToken: config.dtApiToken ? 'configured' : 'missing'
  };
}