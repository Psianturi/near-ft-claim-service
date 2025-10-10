/**
 * Simple FT Transfer Service using @eclipseeer/near-api-ts
 * 
 * Basic implementation for sending FT tokens in sandbox/testnet environments.
 */

import {
  createClient,
  createMemoryKeyService,
  createMemorySigner,
  functionCall,
  teraGas,
  mainnet,
  testnet,
} from '@eclipseeer/near-api-ts';

type NearClient = ReturnType<typeof createClient>;
type NearSigner = Awaited<ReturnType<typeof createMemorySigner>>;
type NearNetwork = Parameters<typeof createClient>[0]['network'];
type RpcConfig = NearNetwork['rpcs']['regular'][number];
type MemoryKeyServiceInput = Parameters<typeof createMemoryKeyService>[0];
type PrivateKeyString = Extract<MemoryKeyServiceInput, { keySource: { privateKey: unknown } }>['keySource']['privateKey'];
type FunctionCallParamsAny = Parameters<typeof functionCall>[0];
type CallContractReadParams = Parameters<NearClient['callContractReadFunction']>[0];

const createFunctionCallParams = <Args extends Record<string, unknown>>(params: {
  functionName: string;
  fnArgsJson: Args;
  gasLimit: FunctionCallParamsAny['gasLimit'];
  attachedDeposit?: FunctionCallParamsAny['attachedDeposit'];
}): FunctionCallParamsAny => {
  const { functionName, fnArgsJson, gasLimit, attachedDeposit } = params;
  const base: Record<string, unknown> = {
    functionName,
    fnName: functionName,
    fnArgsJson,
    functionArgs: fnArgsJson,
    gasLimit,
  };

  if (attachedDeposit) {
    base.attachedDeposit = attachedDeposit;
  }

  return base as FunctionCallParamsAny;
};

const createReadFunctionParams = <Args extends Record<string, unknown> | undefined>(params: {
  contractAccountId: string;
  functionName: string;
  functionArgs?: Args;
  options?: unknown;
}): CallContractReadParams => {
  const { contractAccountId, functionName, functionArgs, options } = params;

  const base: Record<string, unknown> = {
    contractAccountId,
    functionName,
    methodName: functionName,
  };

  if (functionArgs !== undefined) {
    base.functionArgs = functionArgs;
    base.fnArgsJson = functionArgs;
  }

  if (options !== undefined) {
    base.options = options;
  }

  return base as CallContractReadParams;
};

export interface SimpleFTConfig {
  networkId: 'sandbox' | 'testnet' | 'mainnet';
  nodeUrl?: string;
  contractId: string;
  signerAccountId: string;
  signerPrivateKey: string;
}

export class SimpleFTService {
  private client: NearClient | null = null;
  private signer: NearSigner | null = null;
  private readonly config: SimpleFTConfig;
  private readonly decoder = new TextDecoder();

  constructor(config: SimpleFTConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
  const network = this.resolveNetwork();
  const client = createClient({ network });
  this.client = client;

    // Create key service - try different key formats
    const privateKey = (this.config.signerPrivateKey.startsWith('ed25519:')
      ? this.config.signerPrivateKey
      : `ed25519:${this.config.signerPrivateKey}`) as PrivateKeyString;

    try {
      const keyService = await createMemoryKeyService({
        keySource: { privateKey },
      });

      this.signer = await createMemorySigner({
        signerAccountId: this.config.signerAccountId,
        client,
        keyService,
      });
    } catch (error: any) {
      throw new Error(`Failed to initialize NEAR service: ${error.message}`);
    }
  }

  async sendFT(receiverId: string, amount: string, memo?: string): Promise<any> {
    const signer = this.requireSigner();

    console.log(`🚀 Sending ${amount} FT tokens to ${receiverId}...`);

    try {
      // Try to register storage first
      await this.registerStorage(receiverId);

      // Send FT transfer
      const result = await signer.executeTransaction({
        action: functionCall(
          createFunctionCallParams({
            functionName: 'ft_transfer',
            fnArgsJson: {
              receiver_id: receiverId,
              amount,
              memo: memo || null,
            },
            gasLimit: teraGas('30'),
            attachedDeposit: { yoctoNear: '1' },
          }),
        ),
        receiverAccountId: this.config.contractId,
      });

      console.log(`✅ FT transfer completed successfully`);
      return result;

    } catch (error: any) {
      console.error(`❌ FT transfer failed: ${error.message}`);
      throw error;
    }
  }

  async registerStorage(accountId: string): Promise<void> {
    try {
      console.log(`📝 Registering storage for ${accountId}...`);
      
      const signer = this.requireSigner();

      await signer.executeTransaction({
        action: functionCall(
          createFunctionCallParams({
            functionName: 'storage_deposit',
            fnArgsJson: {
              account_id: accountId,
              registration_only: true,
            },
            gasLimit: teraGas('30'),
            attachedDeposit: { yoctoNear: '1250000000000000000000' },
          }),
        ),
        receiverAccountId: this.config.contractId,
      });

      console.log(`✅ Storage registered for ${accountId}`);
    } catch (error: any) {
      const errorMsg = String(error.message || error);
      if (errorMsg.includes('already registered')) {
        console.log(`✅ Storage was already registered for ${accountId}`);
        return;
      }
      // Don't throw for storage registration failures - continue with transfer
      console.log(`⚠️ Storage registration failed (continuing): ${errorMsg}`);
    }
  }

  async getBalance(accountId?: string): Promise<string> {
    const target = accountId || this.config.signerAccountId;
    const client = this.requireClient();

    try {
      const response = await client.callContractReadFunction(
        createReadFunctionParams({
          contractAccountId: this.config.contractId,
          functionName: 'ft_balance_of',
          functionArgs: { account_id: target },
          options: {
            deserializeResult: ({ rawResult }: { rawResult: number[] }) =>
              this.parseJsonResult(rawResult),
          },
        }),
      );

      const result = response?.result;
      if (typeof result === 'string') {
        return result;
      }

      if (result == null) {
        return '0';
      }

      return String(result);
    } catch (error: any) {
      throw new Error(`Failed to get balance for ${target}: ${error.message}`);
    }
  }

  private resolveNetwork(): NearNetwork {
    if (this.config.networkId === 'mainnet') {
      return this.customizeNetwork(mainnet);
    }

    if (this.config.networkId === 'testnet') {
      return this.customizeNetwork(testnet);
    }

    const rpcUrl = this.config.nodeUrl || 'http://127.0.0.1:3030';
    const rpc: RpcConfig = { url: rpcUrl };
    return {
      rpcs: {
        regular: [rpc],
        archival: [rpc],
      },
    };
  }

  private customizeNetwork(source: NearNetwork): NearNetwork {
    const cloned = this.cloneNetwork(source);
    const customUrl = this.config.nodeUrl;

    if (!customUrl) {
      return cloned;
    }

    const primary: RpcConfig = { url: customUrl };
    const seen = new Set<string>([primary.url]);

    const regular: RpcConfig[] = [primary];
    for (const rpc of cloned.rpcs.regular) {
      if (seen.has(rpc.url)) continue;
      seen.add(rpc.url);
      regular.push(rpc);
    }

    const archival = cloned.rpcs.archival.length
      ? cloned.rpcs.archival
      : [primary];

    return {
      rpcs: {
        regular,
        archival,
      },
    };
  }

  private cloneNetwork(source: NearNetwork): NearNetwork {
    return {
      rpcs: {
        regular: source.rpcs.regular.map((rpc) => this.cloneRpc(rpc)),
        archival: source.rpcs.archival.map((rpc) => this.cloneRpc(rpc)),
      },
    };
  }

  private cloneRpc(rpc: RpcConfig): RpcConfig {
    return rpc.headers
      ? { url: rpc.url, headers: { ...rpc.headers } }
      : { url: rpc.url };
  }

  private requireSigner(): NearSigner {
    if (!this.signer) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    return this.signer;
  }

  private requireClient(): NearClient {
    if (!this.client) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    return this.client;
  }

  private parseJsonResult(rawResult: number[]): unknown {
    if (!rawResult || rawResult.length === 0) {
      return '0';
    }

    try {
      const text = this.decoder.decode(Uint8Array.from(rawResult));
      return JSON.parse(text);
    } catch {
      return '0';
    }
  }
}

// Environment-based factory
export function createFTServiceFromEnv(): SimpleFTService {
  const networkId = process.env.NEAR_NETWORK_ID as 'sandbox' | 'testnet' | 'mainnet';
  const nodeUrl = process.env.NEAR_NODE_URL || process.env.NEAR_RPC_URL;
  const contractId = process.env.FT_CONTRACT_ID || process.env.NEAR_CONTRACT_ACCOUNT_ID;
  const signerAccountId = process.env.NEAR_SIGNER_ACCOUNT_ID;
  const signerPrivateKey = process.env.NEAR_SIGNER_ACCOUNT_PRIVATE_KEY;

  if (!networkId || !contractId || !signerAccountId || !signerPrivateKey) {
    throw new Error('Missing required environment variables: NEAR_NETWORK_ID, FT_CONTRACT_ID, NEAR_SIGNER_ACCOUNT_ID, NEAR_SIGNER_ACCOUNT_PRIVATE_KEY');
  }

  return new SimpleFTService({
    networkId,
    nodeUrl,
    contractId,
    signerAccountId,
    signerPrivateKey,
  });
}

// Utility functions
export function parseTokenAmount(amount: string, decimals: number): string {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return whole + paddedFraction;
}

export function formatTokenAmount(rawAmount: string, decimals: number): string {
  const padded = rawAmount.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}