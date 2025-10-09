#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(__filename), '..');

const parseArgs = () => {
  const result = {
    env: 'sandbox',
    destination: './service.log',
    sync: true,
    minLength: undefined,
    dryRun: false,
  };

  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.split('=');
    switch (key) {
      case '--env':
        if (value === 'sandbox' || value === 'testnet') {
          result.env = value;
        } else {
          console.warn(`Unknown env "${value}" – falling back to "${result.env}".`);
        }
        break;
      case '--destination':
        if (value) result.destination = value;
        break;
      case '--sync':
        if (value === 'false' || value === '0') {
          result.sync = false;
        } else if (value === 'true' || value === '1') {
          result.sync = true;
        } else {
          console.warn(`Unknown sync flag "${value}" – keeping default (${result.sync}).`);
        }
        break;
      case '--min-length':
      case '--minLength': {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          result.minLength = parsed;
        } else {
          console.warn(`Ignoring invalid minLength "${value}".`);
        }
        break;
      }
      case '--dry-run':
      case '--dryRun':
        result.dryRun = true;
        break;
      default:
        console.warn(`Unrecognised argument: ${raw}`);
    }
  }

  if (result.sync && result.minLength !== undefined) {
    console.warn('minLength is ignored when sync logging is enabled.');
    result.minLength = undefined;
  }

  return result;
};

const rotateLogIfNeeded = async (logName, dryRun) => {
  const fullPath = join(projectRoot, logName);
  try {
    await fs.access(fullPath);
  } catch {
    return;
  }

  const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const rotatedName = `${logName}.${timestamp}.bak`;
  const rotatedPath = join(projectRoot, rotatedName);

  if (dryRun) {
    console.log(`[dry-run] would move ${logName} -> ${rotatedName}`);
    return;
  }

  await fs.rename(fullPath, rotatedPath);
  console.log(`Rotated ${logName} -> ${rotatedName}`);
};

const ensureDestination = async (destination, dryRun) => {
  const resolved = resolve(projectRoot, destination);
  const dir = dirname(resolved);
  if (dryRun) {
    console.log(`[dry-run] would ensure directory ${dir}`);
    return { resolved, dir };
  }

  await fs.mkdir(dir, { recursive: true });
  console.log(`Ensured log directory ${dir}`);
  return { resolved, dir };
};

const main = async () => {
  const { env, destination, sync, minLength, dryRun } = parseArgs();

  console.log(`Preparing benchmark environment for ${env}`);
  const logs = ['service.log', 'worker.log', 'api.log'];
  await Promise.all(logs.map((log) => rotateLogIfNeeded(log, dryRun)));

  const { resolved: resolvedDestination } = await ensureDestination(destination, dryRun);

  const exports = new Map();
  exports.set('LOG_LEVEL', 'warn');
  exports.set('PINO_DESTINATION', resolvedDestination);
  exports.set('PINO_SYNC', sync ? 'true' : 'false');
  if (!sync && minLength !== undefined) {
    exports.set('PINO_MIN_LENGTH', String(minLength));
  }

  const startCommands = [
    `NEAR_ENV=${env} npm run start:${env}`,
    `NEAR_ENV=${env} npm run run:worker:${env}`,
  ];

  console.log('\n# Export these in your shell (eval supported)');
  for (const [key, value] of exports) {
    console.log(`export ${key}="${value}"`);
  }

  if (!dryRun) {
    console.log('\nEnvironment prepared. Next steps:');
  } else {
    console.log('\nDry run complete. When ready, run without --dry-run to rotate logs.');
  }

  console.log('- Start the API and worker in separate terminals:');
  for (const cmd of startCommands) {
    console.log(`  ${cmd}`);
  }

  console.log('- Kick off your chosen Artillery scenario (e.g. smoke or 10-minute benchmark).');
  console.log('- Tail service.log to confirm the absence of "_flushSync took too long" messages.');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
