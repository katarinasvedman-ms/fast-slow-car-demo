import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function azureCredential(apiKey?: string): {
  token: () => Promise<string>;
  headers: () => Promise<Record<string, string>>;
} {
  let cached: { value: string; expires: number } | undefined;
  let pending: Promise<string> | undefined;
  const token = async (): Promise<string> => {
    if (apiKey) return apiKey;
    if (cached && cached.expires - Date.now() > 120_000) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      let output: string;
      try {
        const command = 'az account get-access-token --resource https://cognitiveservices.azure.com --output json --only-show-errors';
        const result = process.platform === 'win32'
          ? await execute(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { timeout: 15_000, windowsHide: true })
          : await execute('az', ['account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com', '--output', 'json', '--only-show-errors'], { timeout: 15_000 });
        output = result.stdout;
      } catch {
        throw new Error('Azure CLI token acquisition failed. Run az login and verify access to the Foundry resource.');
      }
      let value: unknown;
      try {
        value = JSON.parse(output);
      } catch {
        throw new Error('Azure CLI returned invalid token JSON.');
      }
      if (
        !value || typeof value !== 'object' || !('accessToken' in value) ||
        typeof value.accessToken !== 'string' || !('expires_on' in value) ||
        typeof value.expires_on !== 'number'
      ) {
        throw new Error('Azure CLI returned an invalid access-token response.');
      }
      cached = { value: value.accessToken, expires: value.expires_on * 1000 };
      return cached.value;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
  return {
    token,
    headers: async () => apiKey ? { 'api-key': apiKey } : { Authorization: `Bearer ${await token()}` },
  };
}
