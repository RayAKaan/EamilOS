export interface WebPolicy {
  readonly allowedHosts?: readonly string[];
  readonly maxResponseBytes?: number;
  readonly timeoutMs?: number;
  readonly allowHttp?: boolean;
}

export interface WebRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface WebResponse {
  readonly url: string;
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly truncated: boolean;
}

export class WebRuntime {
  constructor(private readonly defaultPolicy: WebPolicy = {}) {}

  async request(request: WebRequest, policy: WebPolicy = this.defaultPolicy, signal?: AbortSignal): Promise<WebResponse> {
    const parsed = new URL(request.url);
    if (!policy.allowHttp && parsed.protocol !== 'https:') throw new Error('Web policy allows HTTPS only');
    if (policy.allowedHosts?.length && !policy.allowedHosts.includes(parsed.hostname)) {
      throw new Error(`Web policy denies host: ${parsed.hostname}`);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort('web request timeout'), policy.timeoutMs ?? 30_000);
    try {
      const response = await fetch(request.url, {
        method: request.method ?? 'GET',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        redirect: 'manual',
      });
      const max = policy.maxResponseBytes ?? 2_000_000;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const truncated = bytes.byteLength > max;
      const body = new TextDecoder().decode(truncated ? bytes.slice(0, max) : bytes);
      return {
        url: response.url,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        truncated,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
