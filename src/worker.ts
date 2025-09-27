import transferQueue from './queue.js';
import { getNear } from './near.js';
import { config } from './config.js';
import pRetry from 'p-retry';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { functionCall, teraGas, yoctoNear } from '@eclipseeer/near-api-ts';

const rateLimiter = new RateLimiterMemory({
  points: 100, // 100 points
  duration: 1, // per second
});

transferQueue.on('job', async (job: any) => {
  const { receiverId, amount, memo } = job;
  const nearInterface = getNear();

  // Handle hybrid approach: different interfaces for different libraries
  let signer: any;
  let client: any;
  let account: any;

  if (nearInterface.signer) {
    // Using @eclipseeer/near-api-ts (testnet/mainnet)
    signer = nearInterface.signer;
    client = nearInterface.client;
  } else if (nearInterface.account) {
    // Using near-api-js (sandbox)
    account = nearInterface.account;
    client = nearInterface.near; // For view calls
  } else {
    throw new Error('Invalid NEAR interface returned from getNear()');
  }

  const transfer = async () => {
    // Helper to decode view-call results (raw bytes -> JSON)
    const decodeJson = ({ rawResult }: { rawResult: number[] }) => {
      try {
        const text = new TextDecoder().decode(Uint8Array.from(rawResult));
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    // 1) Cek apakah receiver sudah terdaftar di FT (NEP-145), with retries
    let storage: any;
    if (signer) {
      // Using @eclipseeer/near-api-ts
      storage = await client.callContractReadFunction({
        contractAccountId: config.ftContract,
        fnName: 'storage_balance_of',
        fnArgsJson: { account_id: receiverId },
        response: { resultTransformer: decodeJson },
      });
    } else {
      // Using near-api-js (sandbox)
      storage = await account.viewFunction(config.ftContract, 'storage_balance_of', { account_id: receiverId });
    }

    const storageJson: any = storage ?? {};
    const registeredAmountStr = String(
      storageJson.total ?? storageJson.available ?? '0'
    );
    const isRegistered =
      storageJson != null &&
      (() => {
        try {
          return BigInt(registeredAmountStr) > 0n;
        } catch {
          return false;
        }
      })();

    // 2) Susun actions: storage_deposit (jika perlu) + ft_transfer
    const actions: any[] = [];

    // Env flag to skip view-calls and always send storage_deposit (reduces read RPC pressure)
    const skipStorageCheck =
      (process.env.SKIP_STORAGE_CHECK || '').toLowerCase() === 'true';

    if (skipStorageCheck) {
      const min = String(
        process.env.STORAGE_MIN_DEPOSIT || '1250000000000000000000'
      ); // ~0.00125 NEAR
      actions.push(
        functionCall({
          fnName: 'storage_deposit',
          fnArgsJson: { account_id: receiverId, registration_only: true },
          gasLimit: teraGas('30'),
          attachedDeposit: { yoctoNear: min },
        })
      );
    } else if (!isRegistered) {
      // Ambil minimal deposit
      let bounds: any;
      if (signer) {
        // Using @eclipseeer/near-api-ts
        bounds = await client.callContractReadFunction({
          contractAccountId: config.ftContract,
          fnName: 'storage_balance_bounds',
          response: { resultTransformer: decodeJson },
        });
      } else {
        // Using near-api-js (sandbox)
        bounds = await account.viewFunction(config.ftContract, 'storage_balance_bounds', {});
      }
      const b: any = bounds ?? {};
      const min = String(
        b.min ?? b?.min?.yocto ?? '1250000000000000000000'
      ); // fallback heuristik ~0.00125 NEAR
      actions.push(
        functionCall({
          fnName: 'storage_deposit',
          fnArgsJson: { account_id: receiverId, registration_only: true },
          gasLimit: teraGas('30'),
          attachedDeposit: { yoctoNear: min },
        })
      );
    }

    actions.push(
      functionCall({
        fnName: 'ft_transfer',
        fnArgsJson: {
          receiver_id: receiverId,
          amount: String(amount), // amount dalam string, sesuai standar FT
          memo: memo || '',
        },
        gasLimit: teraGas('30'), // 30 Tgas
        attachedDeposit: { yoctoNear: '1' }, // 1 yoctoNEAR
      })
    );

    // 3) Execute transaction based on which library is being used
    let result: any;

    if (account) {
      // Using near-api-js (sandbox) - use account.functionCall
      const actionsForNearApiJs = actions.map((action: any) => ({
        contractId: config.ftContract,
        methodName: action.params.fnName,
        args: action.params.fnArgsJson,
        gas: action.params.gasLimit?.gas || 30000000000000n,
        deposit: action.params.attachedDeposit?.yoctoNear ? BigInt(action.params.attachedDeposit.yoctoNear) : 1n,
      }));

      // Execute all actions in sequence
      for (const action of actionsForNearApiJs) {
        result = await account.functionCall(action);
      }
    } else {
      // Using @eclipseeer/near-api-ts (testnet/mainnet) - use signer
      const tx = await signer.signTransaction({
        receiverAccountId: config.ftContract,
        actions,
      });
      const WAIT_UNTIL =
        (process.env.WAIT_UNTIL as
          | 'None'
          | 'Included'
          | 'ExecutedOptimistic'
          | 'IncludedFinal'
          | 'Executed'
          | 'Final') || 'Included';

      result = await client.sendSignedTransaction({
        signedTransaction: tx,
        waitUntil: WAIT_UNTIL,
      });
    }

    console.log(`✅ Transfer successful to ${receiverId}`);
    return result;
  };

  try {
    await rateLimiter.consume(config.masterAccount);
    await pRetry(transfer, {
      retries: 5,
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 10000,
      randomize: true,
    });
  } catch (error) {
    console.error(`❌ Transfer failed to ${receiverId}:`, error);
    throw error;
  }
});

transferQueue.on('error', (err: any) => {
  console.error(`Queue error: ${err.message}`);
});