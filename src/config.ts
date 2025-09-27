// Load dotenv synchronously at the top of this module
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine which env file to load
const isSandbox = process.env.NEAR_ENV === 'sandbox';
const envFile = isSandbox ? '.env' : '.env.testnet';
const envPath = join(__dirname, '..', envFile);

console.log(`🔧 Loading config from: ${envFile}`);
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
  console.log('🔧 Sandbox config debug:');
  console.log('   - process.env.NEAR_ENV:', process.env.NEAR_ENV);
  console.log('   - process.env.NODE_URL:', process.env.NODE_URL);
  console.log('   - process.env.RPC_URLS:', process.env.RPC_URLS);
  console.log('   - process.env.FT_CONTRACT:', process.env.FT_CONTRACT);
  console.log('   - process.env.MASTER_ACCOUNT:', process.env.MASTER_ACCOUNT);
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
  console.log('   - Final nodeUrl:', config.nodeUrl);
  console.log('   - Final ftContract:', config.ftContract);
  console.log('   - Final masterAccount:', config.masterAccount);
  console.log('   - Config changed:', JSON.stringify(oldConfig) !== JSON.stringify(config));
}

export { config };