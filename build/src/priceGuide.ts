import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { log } from './log.js';
import { REPO_ROOT } from './paths.js';

const PRICE_GUIDE_ID = '15ObDHwLa7rrd0b54RLJCJEsEIEtUHnEjtqV3kQBUCu4';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function standardizeItemName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

function standardizeItemPrice(price: string): number {
  const trimmed = price.trim();
  if (['', '?', 'n/a', 'n / a', 'tbd', 't.b.d.', 'free', '0'].includes(trimmed.toLowerCase())) return 0;
  const normalized = (trimmed.split('-').at(-1) ?? '').replaceAll('+', '').replaceAll(',', '').trim();
  const match = /^(\d+(?:\.\d+)?)\s*([kmb])?$/i.exec(normalized);
  if (!match) return 0;
  const amount = Number(match[1]);
  const multiplier = match[2]?.toLowerCase() === 'b'
    ? 1_000_000_000
    : match[2]?.toLowerCase() === 'm'
      ? 1_000_000
      : match[2]?.toLowerCase() === 'k'
        ? 1_000
        : 1;
  return Number.isFinite(amount) ? Math.round(amount * multiplier) : 0;
}

async function loadServiceAccount(): Promise<ServiceAccount | null> {
  const configured = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  try {
    const json = configured?.startsWith('{')
      ? configured
      : await readFile(resolve(REPO_ROOT, configured || 'google-service-account.json'), 'utf8');
    const account = JSON.parse(json) as Partial<ServiceAccount>;
    if (!account.client_email || !account.private_key) throw new Error('missing client_email or private_key');
    return account as ServiceAccount;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`price guide unavailable: ${detail}`);
    return null;
  }
}

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: SHEETS_SCOPE,
    aud: account.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key).toString('base64url')}`;
  const response = await fetch(account.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error('Google OAuth response did not contain an access token');
  return body.access_token;
}

async function googleJson<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function fetchPlayerPrices(): Promise<Map<string, number>> {
  const account = await loadServiceAccount();
  if (!account) return new Map();

  try {
    const token = await accessToken(account);
    const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${PRICE_GUIDE_ID}`);
    metadataUrl.searchParams.set('fields', 'sheets.properties(index,title)');
    const metadata = await googleJson<{
      sheets?: Array<{ properties?: { index?: number; title?: string } }>;
    }>(metadataUrl, token);
    const titles = (metadata.sheets ?? [])
      .map((sheet) => sheet.properties)
      .filter((properties): properties is { index: number; title: string } =>
        Number.isFinite(properties?.index) && typeof properties?.title === 'string')
      .sort((a, b) => a.index - b.index)
      .slice(1, -2)
      .map((properties) => properties.title);

    const valuesUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${PRICE_GUIDE_ID}/values:batchGet`);
    for (const title of titles) valuesUrl.searchParams.append('ranges', `'${title.replaceAll("'", "''")}'`);
    const data = await googleJson<{ valueRanges?: Array<{ values?: string[][] }> }>(valuesUrl, token);
    const prices = new Map<string, number>();

    for (const range of data.valueRanges ?? []) {
      const rows = range.values ?? [];
      const headers = rows[0] ?? [];
      const groups: Array<{ name: number; price: number }> = [];
      let name = -1;
      let price = -1;
      for (let index = 0; index < headers.length; index += 1) {
        const header = String(headers[index]).trim();
        if (header.startsWith('Name')) name = index;
        if (header.startsWith('Price')) price = index;
        if (name >= 0 && price >= 0) {
          groups.push({ name, price });
          name = -1;
          price = -1;
        }
      }

      for (const row of rows.slice(1)) {
        for (const group of groups) {
          const itemName = standardizeItemName(String(row[group.name] ?? '').split('(')[0]);
          const itemPrice = standardizeItemPrice(String(row[group.price] ?? ''));
          if (itemName && itemPrice) prices.set(itemName, itemPrice);
        }
      }
    }

    return prices;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn(`price guide unavailable: ${detail}`);
    return new Map();
  }
}
