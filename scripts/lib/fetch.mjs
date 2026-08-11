import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Fetch INI text with optional offline cache.
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.cachePath
 * @param {boolean} opts.offline
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ text: string, sha256: string, fromCache: boolean }>}
 */
export async function fetchIni({ url, cachePath, offline = false, timeoutMs = 30000 }) {
  if (offline) {
    if (!fs.existsSync(cachePath)) {
      throw new Error(`offline mode but cache missing: ${cachePath}`);
    }
    const text = fs.readFileSync(cachePath, 'utf8');
    return { text, sha256: sha256(text), fromCache: true };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'acl4ssr-override/1.0' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const text = await res.text();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, text, 'utf8');
    return { text, sha256: sha256(text), fromCache: false };
  } catch (err) {
    if (fs.existsSync(cachePath)) {
      const text = fs.readFileSync(cachePath, 'utf8');
      console.warn(`[fetch] ${url} failed (${err.message}), using cache`);
      return { text, sha256: sha256(text), fromCache: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
