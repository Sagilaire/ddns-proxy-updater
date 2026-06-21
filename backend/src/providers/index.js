'use strict';

/**
 * Provider registry. Adding a new provider is a 2-step process:
 *   1. Create a class extending BaseProvider (or NicUpdateProvider) in this
 *      directory.
 *   2. Register it in _PROVIDERS below.
 *
 * The schema exported by each provider has the shape:
 *   { label, help, domainFields: [...], recordFields: [...] }
 * Both arrays are arrays of plain field descriptors used to render the UI
 * form (key, label, type, required, help?, default?).
 */

const BaseProvider = require('./BaseProvider');
const NamecheapProvider = require('./NamecheapProvider');
const CloudflareProvider = require('./CloudflareProvider');
const DuckDnsProvider = require('./DuckDnsProvider');
const NoIpProvider = require('./NoIpProvider');
const DynuProvider = require('./DynuProvider');
const DeSecProvider = require('./DeSecProvider');

const _PROVIDERS = Object.freeze({
  [NamecheapProvider.getName()]: NamecheapProvider,
  [CloudflareProvider.getName()]: CloudflareProvider,
  [DuckDnsProvider.getName()]: DuckDnsProvider,
  [NoIpProvider.getName()]: NoIpProvider,
  [DynuProvider.getName()]: DynuProvider,
  [DeSecProvider.getName()]: DeSecProvider,
});

/** Public listing — for the UI to render provider-pickers and field forms. */
function listProviders() {
  return Object.values(_PROVIDERS).map((Provider) => {
    const schema = Provider.getSchema();
    return {
      name: Provider.getName(),
      label: schema.label || Provider.getName(),
      help: schema.help || '',
      domainFields: schema.domainFields || [],
      recordFields: schema.recordFields || [],
    };
  });
}

function getProviderClass(name) {
  return _PROVIDERS[name] || null;
}

/**
 * @returns {BaseProvider | null}
 * Flatten domain + record for the provider's update() method.
 *   merged = { ...domainSettings, ...recordOverrides }
 * Anything in recordOverrides takes precedence (e.g. Cloudflare "proxied").
 */
function createProvider(name, domainSettings, recordOverrides) {
  const Provider = _PROVIDERS[name];
  if (!Provider) return null;
  return new Provider({ ...(domainSettings || {}), ...(recordOverrides || {}) });
}

module.exports = {
  BaseProvider,
  listProviders,
  getProviderClass,
  createProvider,
};
