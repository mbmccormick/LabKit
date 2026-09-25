export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface MetricsDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface AssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

/** Cloudflare's version metadata binding (set by the platform per deployed version). */
export interface VersionMetadata {
  id: string;
  tag: string;
  timestamp: string;
}

export interface Env {
  /** Exact issuer string, e.g. https://labkit.health (no trailing slash). */
  ISSUER: string;
  /** kid (RFC 7638 thumbprint) of the current signing key. */
  ACTIVE_KID: string;
  /** Which keys/<KEY_ENV>/ directory the JWKS is built from. */
  KEY_ENV: string;
  /** Secret: private JWK (P-256, includes d) for ACTIVE_KID. */
  SIGNING_KEY_JWK?: string;
  TURNSTILE_SITE_KEY: string;
  /** Secret. */
  TURNSTILE_SECRET?: string;
  RATE_LIMITER: RateLimiter;
  METRICS?: MetricsDataset;
  ASSETS: AssetsFetcher;
  CF_VERSION_METADATA?: VersionMetadata;
}
