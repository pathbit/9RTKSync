// Classify parsed CLI options before dispatch. Planning may use private staging.
import { types } from 'node:util';

const keys = new Set([
  'command', 'positionals', 'toolArgs', 'target', 'language', 'clients',
  'yes', 'json', 'dryRun', 'force', 'check', 'help', 'version', 'intent', 'integrations', 'purpose', 'markdown', 'local', 'select',
]);
const required = ['command', 'positionals', 'toolArgs', 'target', 'language',
  'clients', 'yes', 'json', 'dryRun', 'force', 'check'];

export function validRecoveryResolution(positionals) {
  const [action, generation, id] = positionals;
  return positionals.length === 3 && action === 'resolve' && typeof generation === 'string' && /^[1-9]\d{0,11}$/.test(generation)
    && typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
}

export function validPluginRequest(positionals) {
  const [action, id] = positionals;
  return action === 'list' && positionals.length === 1
    || ['info', 'install', 'check'].includes(action) && positionals.length === 2 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function stringArray(value) {
  if (types.isProxy(value) || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype || value.length > 10000) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const item = descriptors[index];
    if (!item || !Object.hasOwn(item, 'value') || typeof item.value !== 'string') return false;
  }
  return true;
}

export function classifyRecoveryEffects(options) {
  if (!options || typeof options !== 'object' || types.isProxy(options)
    || Object.getPrototypeOf(options) !== Object.prototype) return 'unsupported';
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.has(key))
    || required.some(key => !Object.hasOwn(descriptors, key))
    || Object.values(descriptors).some(item => !Object.hasOwn(item, 'value'))) return 'unsupported';
  const get = key => Object.hasOwn(descriptors, key) ? descriptors[key].value : undefined;
  const positionals = get('positionals'), toolArgs = get('toolArgs'), clients = get('clients');
  if (![positionals, toolArgs].every(stringArray)
    || clients !== undefined && !stringArray(clients)
    || !['yes', 'json', 'dryRun', 'force', 'check'].every(key => typeof get(key) === 'boolean')
    || !['help', 'version', 'integrations', 'markdown', 'local', 'select'].every(key => get(key) === undefined || typeof get(key) === 'boolean')
    || ![null, 'pt', 'en', 'es'].includes(get('language'))
    || !(get('target') === null || typeof get('target') === 'string')
    || !(get('intent') === undefined || ['product', 'run', 'document'].includes(get('intent')))
    || !(get('purpose') === undefined || ['agents', 'product', 'run', 'document'].includes(get('purpose')))) return 'unsupported';

  const command = get('command');
  if (command === 'recovery') {
    if (clients !== undefined || get('intent') !== undefined || get('integrations') !== undefined
      || get('purpose') !== undefined || get('markdown') !== undefined || get('local') !== undefined || get('select') !== undefined || toolArgs.length
      || get('check') || get('dryRun') || get('force') || get('yes')) return 'unsupported';
    if (!positionals.length) return 'query';
    return validRecoveryResolution(positionals) ? 'resolution' : 'unsupported';
  }
  const pluginRequest = command === 'plugins' && validPluginRequest(positionals);
  const clientDelta = command === 'agents' && positionals.length === 2
    && ['add', 'remove'].includes(positionals[0]) && clients?.length > 0
    && clients.every(id => /^[a-z][a-z0-9-]*$/.test(id) && !['all', 'none'].includes(id));
  const known = ['init', 'update', 'sync', 'lang', 'agents', 'doctor', 'next', 'document', 'tools', 'plugins', 'help', 'version'];
  if (!known.includes(command)
    || !pluginRequest && !clientDelta && (positionals.length > 1 || positionals.length && !['init', 'lang', 'agents'].includes(command))
    || command === 'plugins' && (!pluginRequest || get('force') || get('yes'))
    || command === 'init' && get('target') !== null && positionals.length
    || command === 'agents' && positionals.length && clients === undefined
    || toolArgs.length && !['tools', 'help', 'version'].includes(command)
    || clients !== undefined && !['init', 'update', 'sync', 'lang', 'agents', 'help', 'version'].includes(command)
    || get('intent') !== undefined && !['next', 'help', 'version'].includes(command)
    || get('integrations') !== undefined && !['next', 'help', 'version'].includes(command)
    || get('purpose') !== undefined && !['init', 'help', 'version'].includes(command)
    || get('local') !== undefined && !['init', 'help', 'version'].includes(command)
    || get('select') !== undefined && !['help', 'version'].includes(command)
      && (command !== 'agents' || clients !== undefined || get('json') || get('yes') || get('dryRun') || get('force'))
    || get('markdown') !== undefined && (get('json') || !['document', 'help', 'version'].includes(command))
    || command === 'document' && (get('force') || get('yes'))
    || get('check') && command !== 'sync'
    || get('dryRun') && (!['init', 'update', 'sync', 'lang', 'agents'].includes(command)
      || command === 'agents' && clients === undefined)) return 'unsupported';
  if (command === 'tools') return 'opaque';
  if (command === 'plugins') return ['list', 'info'].includes(positionals[0]) ? 'query' : 'opaque';
  if (['help', 'version', 'doctor', 'next', 'document'].includes(command)) return 'query';
  if (command === 'agents' && clients === undefined && !get('select')) return 'query';
  if (command === 'lang' && positionals.length === 0 && get('language') === null
    && clients === undefined) return 'query';
  if (get('dryRun') || command === 'sync' && get('check')) return 'planning';
  return 'mutation';
}
