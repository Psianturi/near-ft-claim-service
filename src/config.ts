// Load dotenv synchronously at the top of this module
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = createLogger({ module: 'config' });

// Determine which env file to load
const isSandbox = process.env.NEAR_ENV === 'sandbox';
const envFile = isSandbox ? '.env' : '.env.testnet';
const envPath = join(__dirname, '..', envFile);

log.info({ envFile }, 'Loading configuration');
dotenv.config({ path: envPath });

let config = {
  networkId: 'testnet',
  nodeUrl: process.env.NODE_URL || 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://wallet.testnet.near.org',
  masterAccount: process.env.MASTER_ACCOUNT || 'posm.testnet',
  ftContract: process.env.FT_CONTRACT || 'posm.testnet',
  helperUrl: 'https://helper.testnet.near.org',
  explorerUrl: 'https://explorer.testnet.near.org',
  port: parseInt(process.env.PORT || '3000', 10),
};

// Override sandbox
if (isSandbox) {
  log.debug({
    nearEnv: process.env.NEAR_ENV,
    nodeUrlEnv: process.env.NODE_URL,
    rpcUrlsEnv: process.env.RPC_URLS,
    ftContractEnv: process.env.FT_CONTRACT,
    masterAccountEnv: process.env.MASTER_ACCOUNT,
  }, 'Sandbox configuration environment variables');
  const oldConfig = { ...config };
  config = {
    ...config,
    networkId: 'sandbox',
    // Prioritaskan NODE_URL, lalu RPC_URLS, lalu default sandbox
    nodeUrl: process.env.NODE_URL || (process.env.RPC_URLS ? process.env.RPC_URLS.split(',')[0].trim() : '') || 'http://localhost:3030',
    masterAccount: process.env.MASTER_ACCOUNT || 'test.near',
    ftContract: process.env.FT_CONTRACT || 'ft.test.near',
    walletUrl: 'http://localhost:4000/wallet',
    helperUrl: 'http://localhost:3000',
    explorerUrl: 'http://localhost:9001/explorer',
  };
  log.debug({
    nodeUrl: config.nodeUrl,
    ftContract: config.ftContract,
    masterAccount: config.masterAccount,
    changed: JSON.stringify(oldConfig) !== JSON.stringify(config),
  }, 'Final sandbox configuration');
}

export { config };