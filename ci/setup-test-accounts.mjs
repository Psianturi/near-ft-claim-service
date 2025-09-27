/**
 * Setup test accounts for CI integration testing
 *
 * Required env:
 *   - NEAR_CONTRACT_ACCOUNT_ID (FT contract account)
 *   - NEAR_SIGNER_ACCOUNT_ID (master account)
 *   - NEAR_SIGNER_ACCOUNT_PRIVATE_KEY (master account private key)
 *   - NEAR_NETWORK_CONNECTION (sandbox)
 */
import { connect, keyStores, utils } from 'near-api-js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function patchBorshSchemas() {
  try {
    const nearTransactions = require('near-api-js/lib/transaction.js');
    const nearCrypto = require('near-api-js/lib/utils/key_pair.js');

    const accountsSchemaModule = require('@near-js/accounts/node_modules/@near-js/transactions/lib/schema.js');
    const accountsActionsModule = require('@near-js/accounts/node_modules/@near-js/transactions/lib/actions.js');
    const accountsSignatureModule = require('@near-js/accounts/node_modules/@near-js/transactions/lib/signature.js');
    const accountsCryptoModule = require('@near-js/accounts/node_modules/@near-js/crypto/lib/public_key.js');
    const providersSchemaModule = require('@near-js/providers/node_modules/@near-js/transactions/lib/schema.js');
    const providersActionsModule = require('@near-js/providers/node_modules/@near-js/transactions/lib/actions.js');
    const providersSignatureModule = require('@near-js/providers/node_modules/@near-js/transactions/lib/signature.js');
    const providersCryptoModule = require('@near-js/providers/node_modules/@near-js/crypto/lib/public_key.js');

    const modulesToPatch = [
      { name: '@near-js/accounts', schemaModule: accountsSchemaModule, actionsModule: accountsActionsModule, signatureModule: accountsSignatureModule, cryptoModule: accountsCryptoModule },
      { name: '@near-js/providers', schemaModule: providersSchemaModule, actionsModule: providersActionsModule, signatureModule: providersSignatureModule, cryptoModule: providersCryptoModule },
    ];

    const classKeys = [
      'SignedTransaction',
      'Transaction',
      'AccessKey',
      'AccessKeyPermission',
      'FunctionCallPermission',
      'FullAccessPermission',
      'FunctionCall',
      'Transfer',
      'Stake',
      'AddKey',
      'DeleteKey',
      'DeleteAccount',
      'CreateAccount',
      'DeployContract',
      'SignedDelegate',
      'DelegateAction',
      'Signature',
      'Action',
      'PublicKey',
    ];

    const schemaSources = [
      { label: 'near-api-js', transactions: nearTransactions, actions: nearTransactions, signature: nearTransactions, crypto: nearCrypto },
      { label: '@near-js/accounts', transactions: accountsSchemaModule, actions: accountsActionsModule, signature: accountsSignatureModule, crypto: accountsCryptoModule },
      { label: '@near-js/providers', transactions: providersSchemaModule, actions: providersActionsModule, signature: providersSignatureModule, crypto: providersCryptoModule },
    ];

    const getClass = (container, key) => container?.[key];

    for (const { name, schemaModule, actionsModule, signatureModule, cryptoModule } of modulesToPatch) {
      const { SCHEMA } = schemaModule || {};
      if (!SCHEMA || typeof SCHEMA.has !== 'function' || typeof SCHEMA.get !== 'function' || typeof SCHEMA.set !== 'function') {
        continue;
      }

      for (const key of classKeys) {
        const canonicalClass =
          getClass(schemaModule, key) ||
          getClass(actionsModule, key) ||
          getClass(signatureModule, key) ||
          getClass(cryptoModule, key);
        if (!canonicalClass || !SCHEMA.has(canonicalClass)) {
          continue;
        }

        for (const source of schemaSources) {
          const candidate =
            getClass(source.transactions, key) ||
            getClass(source.actions, key) ||
            getClass(source.signature, key) ||
            getClass(source.crypto, key);
          if (!candidate || candidate === canonicalClass || SCHEMA.has(candidate)) {
            continue;
          }
          SCHEMA.set(candidate, SCHEMA.get(canonicalClass));
          console.log(`🩹 Patched ${name} schema for ${key} via ${source.label}`);
        }
      }

      const canonicalPublicKey = cryptoModule?.PublicKey;
      if (canonicalPublicKey && SCHEMA.has(canonicalPublicKey)) {
        for (const source of schemaSources) {
          const candidatePk = source.crypto?.PublicKey;
          if (!candidatePk || candidatePk === canonicalPublicKey || SCHEMA.has(candidatePk)) {
            continue;
          }
          SCHEMA.set(candidatePk, SCHEMA.get(canonicalPublicKey));
          console.log(`🩹 Patched ${name} schema for PublicKey via ${source.label}`);
        }
      }
    }
  } catch (error) {
    console.log('⚠️ Failed to patch borsh schemas:', error?.message || error);
  }
}

async function main() {
  console.log('👥 Setting up test accounts for CI...');

  patchBorshSchemas();
  console.log('👥 Setting up test accounts for CI...');

  // Load environment variables
  const contractAccountId = process.env.NEAR_CONTRACT_ACCOUNT_ID || 'ft.test.near';
  const signerAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID || 'test.near';
  const signerPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY;
  const networkConnection = process.env.NEAR_NETWORK_CONNECTION || 'sandbox';
  const nodeUrl = process.env.NEAR_NODE_URL || 'http://127.0.0.1:3030';

  if (!contractAccountId || !signerAccountId || !signerPrivateKey) {
    throw new Error('Missing required environment variables');
  }

  console.log(`📦 Contract: ${contractAccountId}`);
  console.log(`🔑 Signer: ${signerAccountId}`);

  const keyStore = new keyStores.InMemoryKeyStore();
  let keyPair;
  try {
    keyPair = utils.KeyPair.fromString(signerPrivateKey);
  } catch (error) {
    console.log('Failed to parse key with prefix, trying without prefix...');
    const keyWithoutPrefix = signerPrivateKey.replace(/^ed25519:/, '');
    keyPair = utils.KeyPair.fromString(keyWithoutPrefix);
  }
  await keyStore.setKey(networkConnection, signerAccountId, keyPair);

  // Connect to NEAR
  const near = await connect({
    networkId: networkConnection,
    nodeUrl,
    deps: { keyStore },
  });

  // Get master account
  const masterAccount = await near.account(signerAccountId);

  // Create or reuse test user account
  console.log('Creating test user account...');
  const userAccountId = `user.${signerAccountId}`;
  let userAccount;
  try {
    userAccount = await near.account(userAccountId);
    console.log('✅ User account already exists:', userAccountId);
  } catch (_) {
    const userKeyPair = utils.KeyPair.fromRandom('ed25519');
    await keyStore.setKey(networkConnection, userAccountId, userKeyPair);
    await masterAccount.createAccount(
      userAccountId,
      userKeyPair.getPublicKey(),
      utils.format.parseNearAmount('5')
    );
    userAccount = await near.account(userAccountId);
    console.log('✅ Created user account:', userAccount.accountId);
  }

  // Register storage for user account
  console.log('Registering storage for user account...');
  try {
    await masterAccount.functionCall({
      contractId: contractAccountId,
      methodName: 'storage_deposit',
      args: { account_id: userAccount.accountId, registration_only: true },
      gas: '30000000000000',
      attachedDeposit: utils.format.parseNearAmount('0.00125')
    });
    console.log('✅ Storage registered for user account');
  } catch (error) {
    const message = error?.message || String(error);
    if (message.includes('already registered')) {
      console.log('⚠️ Storage already registered, continuing...');
    } else {
      console.log('⚠️ Storage registration may have failed:', message);
    }
  }

  // Output the user account ID for GitHub Actions
  console.log('USER_ACCOUNT_ID=' + userAccount.accountId);
}

main().catch((err) => {
  console.error('❌ Test account setup failed:', err);
  process.exit(1);
});