import { connect, keyStores, utils } from 'near-api-js';
import fs from 'fs';

async function deployContract() {
    const contractAccountId = process.env.NEAR_CONTRACT_ACCOUNT_ID;
    const signerAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID;
    const signerPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY;
    const nodeUrl = process.env.NEAR_NODE_URL;

    console.log(`Deploying to: ${contractAccountId}`);
    console.log(`Using signer: ${signerAccountId}`);

    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = utils.KeyPair.fromString(signerPrivateKey);
    await keyStore.setKey('sandbox', signerAccountId, keyPair);

    const near = await connect({
        networkId: 'sandbox',
        nodeUrl,
        keyStore,
    });

    const account = await near.account(signerAccountId);
    const wasm = fs.readFileSync('fungible_token.wasm');

    // Deploy contract
    await account.deployContract(wasm);
    console.log('✅ Contract deployed');

    // Initialize contract
    await account.functionCall({
        contractId: contractAccountId,
        methodName: 'new_default_meta',
        args: {
            owner_id: signerAccountId,
            total_supply: '1000000000000000000000000000' // 1B tokens
        },
        gas: '300000000000000'
    });
    console.log('✅ Contract initialized');

    // Register storage for master account
    await account.functionCall({
        contractId: contractAccountId,
        methodName: 'storage_deposit',
        args: { account_id: signerAccountId },
        gas: '30000000000000',
        attachedDeposit: utils.format.parseNearAmount('0.00125')
    });
    console.log('✅ Storage registered');
}

deployContract().catch(console.error);
