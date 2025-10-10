#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { connect, keyStores, utils } from 'near-api-js';

async function main() {
  dotenv.config({ path: '.env.testnet' });

  const networkId = process.env.NEAR_ENV || 'testnet';
  const masterAccountId = process.env.MASTER_ACCOUNT;
  const masterPrivateKey = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
  const nodeUrl = process.env.NODE_URL || 'https://rpc.testnet.fastnear.com';

  const newAccountId = 'ft-benchmark.testnet';
  const initialBalance = '5'; // 5 NEAR for initial balance

  if (!masterAccountId || !masterPrivateKey) {
    throw new Error('MASTER_ACCOUNT and MASTER_ACCOUNT_PRIVATE_KEY required in .env.testnet');
  }

  console.log('🏗️  Creating dedicated benchmark account...');
  console.log(`   • Master Account: ${masterAccountId}`);
  console.log(`   • New Account: ${newAccountId}`);
  console.log(`   • Initial Balance: ${initialBalance} NEAR`);
  console.log(`   • Network: ${networkId}`);

  const keyStore = new keyStores.InMemoryKeyStore();
  const masterKeyPair = utils.KeyPair.fromString(masterPrivateKey);
  await keyStore.setKey(networkId, masterAccountId, masterKeyPair);

  const near = await connect({
    networkId,
    nodeUrl,
    deps: { keyStore },
  });

  const masterAccount = await near.account(masterAccountId);

  // Generate a new key pair for the new account
  const newKeyPair = utils.KeyPair.fromRandom('ed25519');
  const newPublicKey = newKeyPair.getPublicKey();

  console.log(`   • Generated Public Key: ${newPublicKey.toString()}`);

  // Create the account
  const amountYocto = utils.format.parseNearAmount(initialBalance);

  try {
    const result = await masterAccount.functionCall({
      contractId: 'testnet',
      methodName: 'create_account',
      args: {
        new_account_id: newAccountId,
        new_public_key: newPublicKey.toString(),
      },
      gas: '300000000000000',
      attachedDeposit: amountYocto,
    });

    console.log('✅ Account creation transaction sent!');
    console.log(`   • Transaction Hash: ${result.transaction.hash}`);
    console.log(`   • New Account: ${newAccountId}`);
    console.log(`   • Public Key: ${newPublicKey.toString()}`);
    console.log(`   • Private Key: ${newKeyPair.toString()}`);
    console.log('');
    console.log('⚠️  IMPORTANT: Save this private key securely!');
    console.log('   Add it to your .env.testnet as MASTER_ACCOUNT_PRIVATE_KEY for the new account');

  } catch (error) {
    console.error('❌ Failed to create account:', error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});