'use strict';

/**
 * Provider registry. Adding a new provider is a 2-step process:
 *   1. Create a class extending BaseProvider in this directory.
 *   2. Register it in _PROVIDERS below.
 */

const BaseProvider = require('./BaseProvider');
const NamecheapProvider = require('./NamecheapProvider');

const _PROVIDERS = Object.freeze({
  [NamecheapProvider.getName()]: NamecheapProvider,
});

/** @returns {Array<{name:string,label:string,fields:Array}>} */
function listProviders() {
  return Object.values(_PROVIDERS).map((Provider) => ({
    name: Provider.getName(),
    label: Provider.getName().replace(/^./, (c) => c.toUpperCase()),
    fields: Provider.getSchema(),
  }));
}

function getProviderClass(name) {
  return _PROVIDERS[name] || null;
}

/** @returns {BaseProvider | null} */
function createProvider(name, hostConfig) {
  const Provider = _PROVIDERS[name];
  if (!Provider) return null;
  return new Provider(hostConfig);
}

module.exports = {
  BaseProvider,
  listProviders,
  getProviderClass,
  createProvider,
};
