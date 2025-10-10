#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { connect, keyStores, utils } from 'near-api-js';
import fs from 'fs';

async function main() {
  dotenv.config({ path: '.env.testnet' });

  const networkId = process.env.NEAR_ENV || 'testnet';
  const accountId = 'ft-benchmark.testnet';
  const privateKey = 'ed25519:2WywpuXdKxar1b8XUhJhUC7LujDiT3hvuxbcpMTT3uYRaXGzijR2VNR1xxJkU5nA7ZD3qBxMFnzt86mzPUQKjoxA';
  const nodeUrl = process.env.NODE_URL || 'https://rpc.testnet.fastnear.com';

  console.log('📦 Deploying FT contract to benchmark account...');
  console.log(`   • Account: ${accountId}`);
  console.log(`   • Network: ${networkId}`);
  console.log(`   • RPC: ${nodeUrl}`);

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = utils.KeyPair.fromString(privateKey);
  await keyStore.setKey(networkId, accountId, keyPair);

  const near = await connect({
    networkId,
    nodeUrl,
    deps: { keyStore },
  });

  const account = await near.account(accountId);

  // Check if WASM file exists
  const wasmPath = './fungible_token.wasm';
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM file not found: ${wasmPath}`);
  }

  console.log('📖 Reading WASM file...');
  const wasm = fs.readFileSync(wasmPath);

  console.log('🚀 Deploying contract...');
  await account.deployContract(wasm);
  console.log('✅ Contract deployed successfully!');

  console.log('🔧 Initializing contract...');
  await account.functionCall({
    contractId: accountId,
    methodName: 'new_default_meta',
    args: {
      owner_id: accountId,
      total_supply: '1000000000000000000000000000' // 1B tokens
    },
    gas: '300000000000000'
  });
  console.log('✅ Contract initialized!');

  console.log('💰 Registering storage for owner...');
  await account.functionCall({
    contractId: accountId,
    methodName: 'storage_deposit',
    args: { account_id: accountId },
    gas: '30000000000000',
    attachedDeposit: utils.format.parseNearAmount('0.00125')
  });
  console.log('✅ Storage registered!');

  console.log('💰 Minting initial tokens...');
  await account.functionCall({
    contractId: accountId,
    methodName: 'ft_mint',
    args: {
      account_id: accountId,
      amount: '1000000000000000000000000000', // 1B tokens
    },
    gas: '300000000000000',
    attachedDeposit: '1',
  });
  console.log('✅ Initial tokens minted!');

  console.log('');
  console.log('🎉 FT Contract deployment completed!');
  console.log(`   • Contract Account: ${accountId}`);
  console.log(`   • Total Supply: 1,000,000,000 tokens`);
  console.log(`   • Owner Balance: 1,000,000,000 tokens`);
}

main().catch((error) => {
  console.error('❌ Deployment failed:', error);
  process.exit(1);
});