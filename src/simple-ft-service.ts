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
  yoctoNear,
  teraGas,
  mainnet,
  testnet,
} from '@eclipseeer/near-api-ts';

export interface SimpleFTConfig {
  networkId: 'sandbox' | 'testnet' | 'mainnet';
  nodeUrl?: string;
  contractId: string;
  signerAccountId: string;
  signerPrivateKey: string;
}

export class SimpleFTService {
  private client: any;
  private signer: any;
  private config: SimpleFTConfig;

  constructor(config: SimpleFTConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Create network configuration
    let network: any;
    if (this.config.networkId === 'testnet') {
      network = testnet;
    } else if (this.config.networkId === 'mainnet') {
      network = mainnet;
    } else {
      // Sandbox - custom network
      network = {
        networkId: 'sandbox',
        nodeUrl: this.config.nodeUrl || 'http://127.0.0.1:3030',
        walletUrl: 'http://127.0.0.1:4000/wallet',
        helperUrl: 'http://127.0.0.1:3000',
        explorerUrl: 'http://127.0.0.1:8080',
      };
    }

    this.client = createClient({ network });

    // Create key service - try different key formats
    const privateKey = this.config.signerPrivateKey.startsWith('ed25519:') 
      ? this.config.signerPrivateKey 
      : `ed25519:${this.config.signerPrivateKey}`;

    try {
      const keyService = await createMemoryKeyService({
        keySource: { privateKey: privateKey as any },
      });

      this.signer = await createMemorySigner({
        signerAccountId: this.config.signerAccountId,
        client: this.client,
        keyService,
      });
    } catch (error: any) {
      throw new Error(`Failed to initialize NEAR service: ${error.message}`);
    }
  }

  async sendFT(receiverId: string, amount: string, memo?: string): Promise<any> {
    if (!this.signer) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    console.log(`🚀 Sending ${amount} FT tokens to ${receiverId}...`);

    try {
      // Try to register storage first
      await this.registerStorage(receiverId);

      // Send FT transfer
      const result = await this.signer.executeTransaction({
        action: functionCall({
          fnName: 'ft_transfer',
          fnArgsJson: {
            receiver_id: receiverId,
            amount,
            memo: memo || null,
          },
          gasLimit: teraGas('30'),
          attachedDeposit: { yoctoNear: '1' },
        }),
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
      
      await this.signer.executeTransaction({
        action: functionCall({
          fnName: 'storage_deposit',
          fnArgsJson: {
            account_id: accountId,
            registration_only: true,
          },
          gasLimit: teraGas('30'),
          attachedDeposit: { yoctoNear: '1250000000000000000000' },
        }),
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
    
    try {
      const balance = await this.client.view({
        accountId: this.config.contractId,
        methodName: 'ft_balance_of',
        args: { account_id: target },
      });
      return balance;
    } catch (error: any) {
      throw new Error(`Failed to get balance for ${target}: ${error.message}`);
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