import { config } from './config.js';
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';
import { providers } from 'near-api-js';

const log = createLogger({ module: 'near' });

const normalizeKey = (pk: string): string => {
  let s = (pk || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (!s.startsWith('ed25519:') && !s.startsWith('secp256k1:')) {
    s = `ed25519:${s}`;
  }
  const idx = s.indexOf(':');
  if (idx === -1) return s;
  const curve = s.slice(0, idx);
  let body = s.slice(idx + 1).replace(/\s+/g, '');
  return `${curve}:${body}`;
};

// Singleton pattern for NEAR connection management
class NearConnectionManager {
  private static instance: NearConnectionManager;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // @eclipseeer/near-api-ts properties (unified for all environments)
  private eclipseeerClient: any = null;
  private eclipseeerKeyService: any = null;
  private eclipseeerSigner: any = null;
  private eclipseeerSignerPool: Array<{
    signer: any;
    publicKey: string;
  }> = [];
  private eclipseeerSignerActive: number[] = [];
  private eclipseeerSignerCursor = 0;
  private eclipseeerMaxPerKey = 1;
  private legacyProvider: providers.JsonRpcProvider | null = null;

  private constructor() {}

  // Try to read validator_key.json produced by near-sandbox and return the secret key for the desired masterAccountId
  private getSandboxKey(masterAccountId: string): string | null {
    try {
      const home = process.env.HOME || '';
      const nearHome = process.env.NEAR_HOME || (home ? path.join(home, '.near') : '');
      const candidates = [
        nearHome ? path.join(nearHome, 'validator_key.json') : '',
        nearHome ? path.join(nearHome, 'data', 'validator_key.json') : '',
        nearHome ? path.join(nearHome, 'node', 'validator_key.json') : '',
        nearHome ? path.join(nearHome, 'node0', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'data', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'node', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'node0', 'validator_key.json') : '',
        home ? path.join(home, '.near', 'sandbox', 'validator_key.json') : '',
      ].filter(Boolean) as string[];

      log.debug({ candidates }, 'Searching sandbox validator keys');

      for (const p of candidates) {
        if (p && fs.existsSync(p)) {
          try {
            const raw = fs.readFileSync(p, 'utf-8');
            const data = JSON.parse(raw);
            const key = data.secret_key || data.private_key || null;
            const accountId = data.account_id || null;
            if (key && accountId === masterAccountId) {
              log.info({ path: p, accountId }, 'Found matching sandbox validator key');
              return key as string;
            } else if (key) {
              log.warn({ path: p, expected: masterAccountId, found: accountId }, 'Validator key account mismatch');
            }
          } catch (e: any) {
            log.warn({ path: p, error: e?.message || e }, 'Failed to read sandbox validator key');
          }
        }
      }
      log.warn({ masterAccountId }, 'No matching sandbox validator key found');
      return null;
    } catch (e: any) {
      log.warn({ error: e?.message || e }, 'Error while searching sandbox validator keys');
      return null;
    }
  }

  static getInstance(): NearConnectionManager {
    if (!NearConnectionManager.instance) {
      NearConnectionManager.instance = new NearConnectionManager();
    }
    return NearConnectionManager.instance;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      log.debug('NEAR connection already initialized, skipping');
      return;
    }

    if (this.initPromise) {
      log.debug('NEAR initialization in progress, waiting');
      return this.initPromise;
    }

    this.initPromise = this._initInternal();
    return this.initPromise;
  }

  private async _initInternal(): Promise<void> {
    // Allow a quick mock mode for local smoke tests where an actual RPC is not available.
    if ((process.env.SKIP_NEAR_INIT || '').toLowerCase() === 'true') {
      log.warn('SKIP_NEAR_INIT=true, using mock NEAR client for local smoke tests');
      // Provide a minimal mock client and signer
      this.eclipseeerClient = {
        callContractReadFunction: async () => null,
        sendSignedTransaction: async () => ({ transaction: { hash: 'mock-tx-hash' }, finalExecutionStatus: 'submitted' }),
        getAccountKeys: async () => ({ accountKeys: [] }),
      } as any;
      this.eclipseeerSigner = {
        signTransaction: async (opts: any) => ({ mock: true, ...opts }),
      } as any;
      this.eclipseeerSignerPool = [{ signer: this.eclipseeerSigner, publicKey: 'ed25519:MOCK' }];
      this.eclipseeerSignerActive = [0];
      this.eclipseeerSignerCursor = 0;
      this.eclipseeerMaxPerKey = 1;
      this.initialized = true;
      return;
    }
    try {
      log.info('Starting NEAR connection initialization');

      // Use @eclipseeer/near-api-ts for all environments for consistency and performance
      if (config.networkId === 'sandbox' || config.networkId === 'testnet' || config.networkId === 'mainnet') {
        await this.initEclipseeerNearApiTs();
      } else {
        throw new Error(`Unsupported networkId: ${config.networkId}. Supported: sandbox, testnet, mainnet`);
      }

      this.initialized = true;
      log.info('NEAR connection initialization completed successfully');
    } catch (error) {
      log.error({ err: error }, 'NEAR connection initialization failed');
      this.initPromise = null;
      throw error;
    }
  }

  // Unified initialization using @eclipseeer/near-api-ts for all environments
  private async initEclipseeerNearApiTs(): Promise<void> {
    // Short-circuit to a mock NEAR client for smoke tests/local dev when requested
    const skip = (process.env.SKIP_NEAR_INIT || process.env.MOCK_NEAR || '').toLowerCase() === 'true';
    if (skip) {
      log.warn('SKIP_NEAR_INIT=true detected — initializing mock NEAR client for local smoke tests');
      // Minimal mock client/signers expected by the rest of the code
      this.eclipseeerClient = {
        callContractReadFunction: async (opts: any) => {
          // storage_balance_of or storage_balance_bounds => return null/empty
          return null;
        },
        sendSignedTransaction: async ({ signedTransaction }: any) => {
          const txHash = 'mock-' + Date.now().toString(36);
          return { transaction: { hash: txHash }, finalExecutionStatus: 'submitted' };
        },
        // best-effort getTransaction for reconciler
        getTransaction: async (args: any) => {
          return { status: 'SuccessValue', args };
        },
      } as any;

      // minimal signer implementation
      this.eclipseeerSigner = {
        signTransaction: async (opts: any) => {
          return { mock: true, ...opts };
        },
      } as any;

      // create a single-entry signer pool so acquireSigner works
      this.eclipseeerSignerPool = [{ signer: this.eclipseeerSigner, publicKey: 'ed25519:MOCK' }];
      this.eclipseeerSignerActive = [0];
      this.eclipseeerMaxPerKey = 1;
      log.info({ networkId: config.networkId }, 'Mock eclipseeer client initialized');
      return;
    }
    const {
      createClient,
      createMemoryKeyService,
      createMemorySigner,
      testnet,
      mainnet,
    } = await import('@eclipseeer/near-api-ts');

    const rpcUrlsEnv = process.env.RPC_URLS;

    const baseHeaders: Record<string, string> = {};
    const fastnearKey = process.env.FASTNEAR_API_KEY;
    const rpcHeadersEnv = process.env.RPC_HEADERS;

    if (rpcHeadersEnv) {
      try {
        const extra = JSON.parse(rpcHeadersEnv);
        if (extra && typeof extra === 'object') {
          Object.assign(baseHeaders, extra as Record<string, string>);
        }
      } catch {
        log.warn('Invalid RPC_HEADERS JSON, ignoring');
      }
    }

    const buildRpcEntry = (url: string) => {
      const headers: Record<string, string> = { ...baseHeaders };
      if (fastnearKey && url.includes('fastnear.com')) {
        headers['Authorization'] = `Bearer ${fastnearKey}`;
        headers['x-api-key'] = fastnearKey;
      }
      return Object.keys(headers).length > 0 ? { url, headers } : { url };
    };

    const probeRpcEntries = async (entries: Array<{ url: string; headers?: Record<string, string> }>) => {
      const working: typeof entries = [];
      for (const entry of entries) {
        const headers = {
          'Content-Type': 'application/json',
          ...(entry.headers ?? {}),
        };
        try {
          // Try multiple health check methods for better compatibility
          let response: Response;
          let payload: any;

          // First try: status method (more reliable for FastNEAR)
          try {
            response = await fetch(entry.url, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'health-check',
                method: 'status',
                params: [],
              }),
            });

            if (response.ok) {
              payload = await response.json();
              if (!payload?.error) {
                working.push(entry);
                continue; // Success, move to next entry
              }
            }
          } catch {
            // Ignore and try next method
          }

          // Second try: block method with optimistic finality
          try {
            response = await fetch(entry.url, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'health-check',
                method: 'block',
                params: { finality: 'optimistic' },
              }),
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            payload = await response.json();
            if (payload?.error) {
              throw new Error(payload.error?.message || 'RPC error during probe');
            }

            working.push(entry);
          } catch (error: any) {
            // Third try: simple gas_price method
            try {
              response = await fetch(entry.url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 'health-check',
                  method: 'gas_price',
                  params: [null],
                }),
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              payload = await response.json();
              if (payload?.error) {
                throw new Error(payload.error?.message || 'RPC error during probe');
              }

              working.push(entry);
            } catch (finalError: any) {
              log.warn({
                url: entry.url,
                error: finalError?.message || finalError,
              }, 'Skipping RPC URL that failed all health probe methods');
            }
          }
        } catch (error: any) {
          log.warn({
            url: entry.url,
            error: error?.message || error,
          }, 'Skipping RPC URL that failed health probe');
        }
      }

      if (working.length === 0) {
        log.warn('No RPC URLs passed health probe, falling back to mock mode');
        // Don't throw error, let it fall back to mock mode
        return [];
      }

      return working;
    };

    let network: any;

    if (rpcUrlsEnv) {
      const urls = rpcUrlsEnv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        throw new Error('RPC_URLS provided but no valid URLs found');
      }
      const entries = urls.map((url) => buildRpcEntry(url));
      const healthyEntries = await probeRpcEntries(entries);
      network = {
        rpcs: {
          regular: healthyEntries,
          archival: healthyEntries,
        },
      };
    } else if (config.nodeUrl) {
      const entry = buildRpcEntry(config.nodeUrl);
      const healthyEntries = await probeRpcEntries([entry]);
      network = {
        rpcs: {
          regular: healthyEntries,
          archival: healthyEntries,
        },
      };
    } else if (config.networkId === 'testnet') {
      network = testnet;
    } else if (config.networkId === 'mainnet') {
      network = mainnet;
    } else {
      throw new Error(`Unsupported networkId: ${config.networkId}. Only testnet and mainnet are supported with @eclipseeer/near-api-ts.`);
    }

    this.eclipseeerClient = createClient({ network });

    if (config.networkId === 'sandbox' && config.nodeUrl) {
      try {
        this.legacyProvider = new providers.JsonRpcProvider({ url: config.nodeUrl });
        log.debug({ nodeUrl: config.nodeUrl }, 'Initialized legacy RPC provider for sandbox fallback');
      } catch (error: any) {
        log.warn({ err: error }, 'Failed to initialize legacy RPC provider for sandbox fallback');
        this.legacyProvider = null;
      }
    }

    log.debug({
      hasMasterAccountPrivateKey: !!process.env.MASTER_ACCOUNT_PRIVATE_KEY,
      hasMasterAccountPrivateKeys: !!process.env.MASTER_ACCOUNT_PRIVATE_KEYS,
    }, 'Environment variables check');

    const parseKeyEntries = (): Array<{ accountId: string; privateKey: string }> => {
      const result: Array<{ accountId: string; privateKey: string }> = [];
      const raw = process.env.MASTER_ACCOUNT_PRIVATE_KEYS?.trim();

      if (raw && raw.length > 0) {
        let normalizedRaw = raw;
        if (
          (normalizedRaw.startsWith('"') && normalizedRaw.endsWith('"')) ||
          (normalizedRaw.startsWith("'") && normalizedRaw.endsWith("'"))
        ) {
          normalizedRaw = normalizedRaw.slice(1, -1).trim();
        }

        if (normalizedRaw.startsWith('[')) {
          try {
            const parsed = JSON.parse(normalizedRaw);
            if (Array.isArray(parsed)) {
              for (const entry of parsed) {
                if (typeof entry === 'string') {
                  const trimmed = entry.trim();
                  if (trimmed) {
                    result.push({ accountId: config.masterAccount, privateKey: trimmed });
                  }
                } else if (entry && typeof entry === 'object') {
                  const privateKey = (entry.private_key || entry.privateKey || entry.key || entry.secretKey || '').toString().trim();
                  const accountId = (entry.account_id || entry.accountId || entry.account || config.masterAccount || '').toString().trim();
                  if (!privateKey) {
                    log.warn({ entry }, 'Skipping key entry without private_key');
                    continue;
                  }
                  result.push({
                    accountId: accountId || config.masterAccount,
                    privateKey,
                  });
                } else {
                  log.warn({ entry }, 'Unrecognized key entry format (expected string or object)');
                }
              }
            } else {
              log.warn('MASTER_ACCOUNT_PRIVATE_KEYS JSON did not parse to an array; falling back to comma parsing');
            }
          } catch (error: any) {
            log.warn({ error: error?.message || error }, 'Failed to parse MASTER_ACCOUNT_PRIVATE_KEYS as JSON; falling back to comma parsing');
          }
        }

        if (result.length === 0) {
          const pieces = normalizedRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const piece of pieces) {
            result.push({ accountId: config.masterAccount, privateKey: piece });
          }
        }
      }

      return result;
    };

    let keyEntries = parseKeyEntries();

    if (keyEntries.length === 0) {
      const single = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
      if (!single || single.trim().length === 0) {
        log.error({
          envKeys: Object.keys(process.env).filter((key) => key.includes('MASTER') || key.includes('PRIVATE')),
        }, 'Missing master account private key environment variables');
        throw new Error(
          'MASTER_ACCOUNT_PRIVATE_KEY or MASTER_ACCOUNT_PRIVATE_KEYS environment variable is required'
        );
      }
      keyEntries = [{ accountId: config.masterAccount, privateKey: single.trim() }];
      log.info('Using MASTER_ACCOUNT_PRIVATE_KEY');
    } else {
      log.info({ keyCount: keyEntries.length }, 'Using MASTER_ACCOUNT_PRIVATE_KEYS');
    }

    const { utils } = await import('near-api-js');

    const resolvedKeyEntries = keyEntries.map(({ accountId, privateKey }) => {
      const normalized = normalizeKey(privateKey);
      const keyPair = utils.KeyPair.fromString(normalized as any);
      return {
        accountId: (accountId && accountId.trim()) || config.masterAccount,
        privateKey: normalized,
        publicKey: keyPair.getPublicKey().toString(),
        keyPair,
      };
    });

    let onChainPublicKeys: Set<string> | null = null;
    try {
      const { accountKeys } = await this.eclipseeerClient.getAccountKeys({
        accountId: config.masterAccount,
      });
      if (Array.isArray(accountKeys)) {
        onChainPublicKeys = new Set(accountKeys.map((key: any) => key.publicKey));
      }
    } catch (error: any) {
      log.warn({ error: error?.message || error }, 'Failed to fetch on-chain keys for master account');
    }

    let filteredKeyEntries = resolvedKeyEntries;

    if (onChainPublicKeys && onChainPublicKeys.size > 0) {
      const missing = filteredKeyEntries.filter((entry) => !onChainPublicKeys!.has(entry.publicKey));
      if (missing.length > 0) {
        log.warn({
          missingPublicKeys: missing.map((entry) => entry.publicKey),
        }, 'Ignoring master keys not registered on-chain');
      }

      const usable = filteredKeyEntries.filter((entry) => onChainPublicKeys!.has(entry.publicKey));
      if (usable.length === 0) {
        log.error({
          desiredPublicKeys: filteredKeyEntries.map((entry) => entry.publicKey),
          onChainPublicKeys: Array.from(onChainPublicKeys.values()),
        }, 'No matching master account keys found on-chain');
        throw new Error('Master account has no matching public keys registered on-chain. Please register at least one key before starting the service.');
      }
      filteredKeyEntries = usable;
    }

    const privateKeys = filteredKeyEntries.map((entry) => entry.privateKey);

    log.debug({
      entries: filteredKeyEntries.map(({ accountId, publicKey }) => ({ accountId, publicKey })),
    }, 'Parsed master account keys');

    const keySources = filteredKeyEntries.map(({ privateKey }) => ({
      privateKey,
    }));

    this.eclipseeerKeyService = await createMemoryKeyService({
      keySources,
    } as any);

    let signingKeys: string[] = [];
    try {
      const keyPairs = (this.eclipseeerKeyService as any).getKeyPairs
        ? (this.eclipseeerKeyService as any).getKeyPairs()
        : {};
      signingKeys = Object.keys(keyPairs);
    } catch {
      signingKeys = [];
    }

    this.eclipseeerSigner = await createMemorySigner({
      signerAccountId: config.masterAccount,
      client: this.eclipseeerClient,
      keyService: this.eclipseeerKeyService,
      ...(signingKeys.length > 0 ? { keyPool: { signingKeys } } : {}),
    } as any);

    this.eclipseeerSignerPool = [];
    this.eclipseeerSignerActive = [];
    this.eclipseeerSignerCursor = 0;
    // Use unified MAX_IN_FLIGHT_PER_KEY for all environments
    const maxPerKeyEnv = config.networkId === 'sandbox'
      ? process.env.SANDBOX_MAX_IN_FLIGHT_PER_KEY
      : process.env.TESTNET_MAX_IN_FLIGHT_PER_KEY;
    
    this.eclipseeerMaxPerKey = Math.max(
      1,
      parseInt(
        maxPerKeyEnv ||
          process.env.MAX_IN_FLIGHT_PER_KEY ||
          '8',
        10,
      ),
    );

    for (const { accountId, privateKey, publicKey } of filteredKeyEntries) {
      const keyService = await createMemoryKeyService({
        keySource: {
          privateKey,
        },
      } as any);
      const signer = await createMemorySigner({
        signerAccountId: accountId,
        client: this.eclipseeerClient,
        keyService,
      } as any);
      this.eclipseeerSignerPool.push({
        signer,
        publicKey,
      });
      this.eclipseeerSignerActive.push(0);
    }

    const derivedHeaderCount = Object.keys(baseHeaders).length + (fastnearKey ? 2 : 0);

    log.info({
      networkId: config.networkId,
      keyCount: privateKeys.length,
      rpcUrlCount: rpcUrlsEnv ? rpcUrlsEnv.split(',').length : 1,
      headerCount: derivedHeaderCount,
      maxPerKey: this.eclipseeerMaxPerKey,
    }, '@eclipseeer/near-api-ts connection ready for all environments');
  }

  getNear(): any {
    if (!this.initialized) {
      throw new Error('NEAR connection not initialized. Call init() first.');
    }

    if (!this.eclipseeerSigner) {
      throw new Error('Signer not initialized');
    }
    
    const clientProxy = {
      ...this.eclipseeerClient,
      sendSignedTransaction: (args: any) => this.sendSignedTransactionWithFallback(args),
    };

    return {
      signer: this.eclipseeerSigner,
      client: clientProxy,
      acquireSigner: () => this.acquireSigner(),
    };
  }

  private async sendSignedTransactionWithFallback(args: any): Promise<any> {
    try {
      return await this.eclipseeerClient.sendSignedTransaction(args);
    } catch (error: any) {
      if (this.shouldFallbackToLegacy(error)) {
        log.warn({ err: error }, 'Falling back to legacy broadcast_tx_commit due to client parse error');
        return await this.sendViaLegacyProvider(args?.signedTransaction);
      }
      throw error;
    }
  }

  private shouldFallbackToLegacy(error: any): boolean {
    if (!this.legacyProvider) {
      return false;
    }

    if (config.networkId !== 'sandbox') {
      return false;
    }

    const name = error?.name || error?.constructor?.name;
    if (name === '$ZodError') {
      return true;
    }

    const message = String(error?.message || '').toLowerCase();
    return message.includes('invalid input') && message.includes('receipts');
  }

  private async sendViaLegacyProvider(signedTransaction: any): Promise<any> {
    if (!this.legacyProvider) {
      throw new Error('Legacy provider not initialized');
    }

    const resolveBytes = (tx: any): Uint8Array | null => {
      if (!tx) return null;
      if (typeof tx.encode === 'function') {
        return tx.encode();
      }
      if (typeof tx.serialize === 'function') {
        return tx.serialize();
      }
      if (tx.signedTransaction && typeof tx.signedTransaction.encode === 'function') {
        return tx.signedTransaction.encode();
      }
      if (tx.signedTransaction && typeof tx.signedTransaction.serialize === 'function') {
        return tx.signedTransaction.serialize();
      }
      if (tx.signedTxBytes instanceof Uint8Array) {
        return tx.signedTxBytes;
      }
      if (tx.serializedTx instanceof Uint8Array) {
        return tx.serializedTx;
      }
      if (tx instanceof Uint8Array) {
        return tx;
      }
      if (Array.isArray(tx)) {
        return Uint8Array.from(tx);
      }
      return null;
    };

    const bytes = resolveBytes(signedTransaction);
    if (!bytes) {
      try {
        const dumpPath = path.join(process.cwd(), 'tmp', `failed-signed-transaction-${Date.now()}.json`);
  await fs.promises.mkdir(path.dirname(dumpPath), { recursive: true });
  await fs.promises.writeFile(dumpPath, JSON.stringify(signedTransaction, null, 2));
        log.warn({ dumpPath, keys: signedTransaction ? Object.keys(signedTransaction) : null }, 'Dumped unsigned legacy fallback payload');
      } catch (dumpError) {
        log.warn({ err: dumpError }, 'Failed to dump legacy fallback payload');
      }
      log.error({ keys: signedTransaction ? Object.keys(signedTransaction) : null }, 'Unable to resolve signed transaction bytes for legacy fallback');
      throw new Error('Signed transaction missing serialisable payload for legacy fallback');
    }

    const base64Tx = Buffer.from(bytes).toString('base64');
    const result: any = await this.legacyProvider.sendJsonRpc('broadcast_tx_commit', [base64Tx]);

    const normalized = {
      ...result,
      finalExecutionStatus: result?.status,
      transactionOutcome: result?.transaction_outcome,
      receiptsOutcome: result?.receipts_outcome,
    };

    return normalized;
  }

  private async acquireSigner(): Promise<{
    signer: any;
    publicKey: string;
    index: number;
    poolSize: number;
    release: () => void;
  }> {
    if (this.eclipseeerSignerPool.length === 0) {
      throw new Error('Signer pool not initialized');
    }

    const poolSize = this.eclipseeerSignerPool.length;

    while (true) {
      for (let i = 0; i < poolSize; i++) {
        const index = (this.eclipseeerSignerCursor + i) % poolSize;
        const active = this.eclipseeerSignerActive[index] ?? 0;
        if (active < this.eclipseeerMaxPerKey) {
          this.eclipseeerSignerCursor = (index + 1) % poolSize;
          this.eclipseeerSignerActive[index] = active + 1;
          const slot = this.eclipseeerSignerPool[index];
          return {
            signer: slot.signer,
            publicKey: slot.publicKey,
            index,
            poolSize,
            release: () => this.releaseSigner(index),
          };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private releaseSigner(index: number): void {
    if (this.eclipseeerSignerPool.length === 0) {
      return;
    }

    const active = this.eclipseeerSignerActive[index] ?? 0;
    const nextActive = Math.max(0, active - 1);
    this.eclipseeerSignerActive[index] = nextActive;
  }

  async cleanup(): Promise<void> {
    // no-op for near-api-js RPC connections
  }
}

// Export singleton instance functions
const connectionManager = NearConnectionManager.getInstance();

export const initNear = () => connectionManager.init();
export const getNear = () => connectionManager.getNear();

// Cleanup function for graceful shutdown
export const cleanupNear = () => connectionManager.cleanup();