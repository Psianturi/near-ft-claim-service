import { connect, keyStores, utils } from 'near-api-js';

async function mintTokens() {
    const contractAccountId = process.env.NEAR_CONTRACT_ACCOUNT_ID;
    const signerAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID;
    const signerPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY;
    const nodeUrl = process.env.NEAR_NODE_URL;
    const amount = process.env.FT_TOP_UP_AMOUNT || '2000000000000000000000000000'; // 2B tokens

    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = utils.KeyPair.fromString(signerPrivateKey);
    await keyStore.setKey('sandbox', signerAccountId, keyPair);

    const near = await connect({
        networkId: 'sandbox',
        nodeUrl,
        keyStore,
    });

    const account = await near.account(signerAccountId);
    try {
        await account.functionCall({
            contractId: contractAccountId,
            methodName: 'ft_mint',
            args: {
                account_id: signerAccountId,
                amount,
            },
            gas: '300000000000000',
        });
        console.log(`✅ Minted ${amount} tokens to ${signerAccountId}`);
    } catch (error) {
        console.error('Failed to mint tokens', error);
        process.exitCode = 1;
    }
}

mintTokens();
