import { connect, keyStores, utils } from 'near-api-js';

const requiredEnv = [
  'NEAR_NODE_URL',
  'NEAR_CONTRACT_ACCOUNT_ID',
  'NEAR_SIGNER_ACCOUNT_ID',
  'NEAR_SIGNER_ACCOUNT_PRIVATE_KEY',
  'RECEIVER_ACCOUNT_ID',
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const {
  NEAR_NODE_URL,
  NEAR_CONTRACT_ACCOUNT_ID,
  NEAR_SIGNER_ACCOUNT_ID,
  NEAR_SIGNER_ACCOUNT_PRIVATE_KEY,
  RECEIVER_ACCOUNT_ID,
  MINIMUM_BALANCE = '1000000',
} = process.env;

async function main() {
  const keyStore = new keyStores.InMemoryKeyStore();
  let keyPair;
  try {
    keyPair = utils.KeyPair.fromString(NEAR_SIGNER_ACCOUNT_PRIVATE_KEY);
  } catch {
    keyPair = utils.KeyPair.fromString(NEAR_SIGNER_ACCOUNT_PRIVATE_KEY.replace(/^ed25519:/, ''));
  }
  await keyStore.setKey('sandbox', NEAR_SIGNER_ACCOUNT_ID, keyPair);

  const near = await connect({
    networkId: 'sandbox',
    nodeUrl: NEAR_NODE_URL,
    deps: { keyStore },
  });

  const account = await near.account(NEAR_SIGNER_ACCOUNT_ID);
  const balance = await account.viewFunction({
    contractId: NEAR_CONTRACT_ACCOUNT_ID,
    methodName: 'ft_balance_of',
    args: { account_id: RECEIVER_ACCOUNT_ID },
  });

  const balanceBig = BigInt(balance);
  const minimum = BigInt(MINIMUM_BALANCE);

  console.log(`Receiver balance for ${RECEIVER_ACCOUNT_ID}: ${balance}`);
  if (balanceBig < minimum) {
    throw new Error(`Receiver balance (${balanceBig}) below expected minimum (${minimum})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
