// Public IPv4 detector: tries each provider endpoint in order until one
// returns a valid IP. Each endpoint has a short timeout. The detector throws
// when every provider fails so the scheduler can surface the failure rather
// than propagating a stale IP.

import axios from 'axios';
import config from '../config';

export interface IpDetectionError extends Error {
  attempts: string[];
}

export class IPDetector {
  private readonly providers: string[];
  private readonly timeoutMs: number;

  constructor(
    providers: string[] = config.ipProviders,
    timeoutMs: number = config.ipRequestTimeoutMs,
  ) {
    this.providers = providers;
    this.timeoutMs = timeoutMs;
  }

  async detect(): Promise<string> {
    const errors: string[] = [];
    for (const url of this.providers) {
      try {
        const res = await axios.get<string>(url, {
          timeout: this.timeoutMs,
          responseType: 'text',
          headers: { 'User-Agent': 'proxy-ddns-updater-backend/1.0' },
          validateStatus: (s) => s >= 200 && s < 300,
          transformResponse: [(d) => (typeof d === 'string' ? d.trim() : d)],
        });
        const ip = this.extractIp(res.data);
        if (ip && this.isValidIpv4(ip)) return ip;
        errors.push(`${url}: invalid payload`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'network error';
        errors.push(`${url}: ${message}`);
        continue;
      }
    }
    const e = new Error('All IP providers failed') as IpDetectionError;
    e.attempts = errors;
    throw e;
  }

  private extractIp(payload: string | unknown): string | null {
    if (!payload) return null;
    if (typeof payload !== 'string') return null;
    const jsonMatch = /"ip"\s*:\s*"([0-9.]+)"/i.exec(payload);
    if (jsonMatch) return jsonMatch[1] ?? null;
    const first = payload.split(/\s|,/)[0];
    return first ?? null;
  }

  private isValidIpv4(s: string): boolean {
    const parts = s.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      if (!/^\d+$/.test(p)) return false;
      const n = Number(p);
      return n >= 0 && n <= 255;
    });
  }
}

export default IPDetector;
