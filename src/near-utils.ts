// src/near-utils.ts
import { Buffer } from 'buffer';

export async function rpcViewFunction(nodeUrl: string, contractId: string, methodName: string, args: any = {}) {
  const body = {
    jsonrpc: "2.0",
    id: "dontcare",
    method: "query",
    params: {
      request_type: "call_function",
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      finality: "optimistic",
    },
  };

  const res = await fetch(nodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const j = await res.json();
  if (j.error) {
    throw new Error(JSON.stringify(j.error));
  }
  // result.result is array of bytes
  const raw = Buffer.from(j.result.result).toString();
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

/**
 * Try multiple provider/account APIs before falling back to raw RPC.
 * Compatible with:
 * - near-api-js Account.viewFunction()
 * - near-workspaces account.view()
 * - Raw RPC fallback
 */
export async function safeView(account: any | undefined, nodeUrl: string, contractId: string, methodName: string, args: any = {}) {
  try {
    if (account) {
      // near-api-js Account.viewFunction method
      if (typeof account.viewFunction === 'function') {
        return await account.viewFunction({ contractId, methodName, args });
      }
      // near-workspaces account.view method
      if (typeof account.view === 'function') {
        return await account.view(contractId, methodName, args);
      }
      // Fallback for other account types
      if (typeof account.viewCall === 'function') {
        return await account.viewCall(contractId, methodName, args);
      }
    }
    // Final fallback to raw RPC query
    return await rpcViewFunction(nodeUrl, contractId, methodName, args);
  } catch (e) {
    // bubble up; caller will handle retry/error
    throw e;
  }
}