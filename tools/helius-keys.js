// tools/helius-keys.js
// Round-robin Helius API key manager for distributed quota usage.
// Supports 1..N keys. Set keys via setKeys([...]) at startup; helper
// exposes getNextKey() for wallet/enhanced calls and
// buildRpcUrl() to generate per-call RPC URLs with the right key.

import { log } from "../logger.js";

let _keys = [];
let _counter = 0;
let _baseRpc = "https://mainnet.helius-rpc.com";
let _baseEnhanced = "https://api.helius.xyz";

/**
 * Initialize the key pool. Called once at startup.
 * @param {string[]} keyList - list of API keys (any non-empty string is valid)
 */
export function setKeys(keyList) {
  _keys = Array.isArray(keyList) ? keyList.filter(k => k && String(k).trim().length > 0) : [];
  _counter = 0;
  if (_keys.length === 0) {
    log("helius_keys_warn", "Helius key pool is empty — wallet/RPC calls will fail");
  } else {
    log("helius_keys", `Loaded ${_keys.length} Helius API key(s) for round-robin rotation`);
  }
}

/**
 * Get the next key in round-robin order. Advances the counter atomically.
 * @returns {string|null} the next API key, or null if pool is empty
 */
export function getNextKey() {
  if (_keys.length === 0) return null;
  const key = _keys[_counter % _keys.length];
  _counter++;
  return key;
}

/**
 * Returns the number of keys currently loaded.
 */
export function getKeyCount() {
  return _keys.length;
}

/**
 * Build a Solana JSON-RPC URL using the next key in the rotation.
 * @returns {string|null} full RPC URL with api-key query param, or null
 */
export function buildRpcUrl() {
  const key = getNextKey();
  if (!key) return null;
  return `${_baseRpc}/?api-key=${key}`;
}

/**
 * Build an enhanced-API URL (Helius-specific) using the next key.
 * Path is everything after `/v1/`; key is appended as query param.
 * @param {string} path - API path beginning with `v1/...`
 * @returns {string|null}
 */
export function buildEnhancedUrl(path) {
  const key = getNextKey();
  if (!key) return null;
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${_baseEnhanced}/${cleanPath}?api-key=${key}`;
}

/**
 * Fetch with round-robin fallback. Tries each key once before throwing.
 * Useful for code paths that should not throw on a single-key hiccup.
 * @param {(key: string) => string} urlBuilder - returns the URL for a given key
 * @param {RequestInit} [fetchOptions] - extra fetch options (method, body, headers, etc.)
 * @returns {Promise<Response>} the first successful response
 * @throws {Error} if every key fails
 */
export async function callWithFallback(urlBuilder, fetchOptions = {}) {
  if (_keys.length === 0) {
    throw new Error("No Helius API keys configured");
  }
  const errors = [];
  for (let attempt = 0; attempt < _keys.length; attempt++) {
    const key = getNextKey();
    try {
      const url = urlBuilder(key);
      const res = await fetch(url, fetchOptions);
      if (res.ok) return res;
      errors.push(`${key.slice(0, 8)}...→${res.status}`);
    } catch (err) {
      errors.push(`${key.slice(0, 8)}...→${err.message?.slice(0, 40) || "err"}`);
    }
  }
  throw new Error(`All ${_keys.length} Helius key(s) failed: ${errors.join("; ")}`);
}
