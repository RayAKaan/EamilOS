import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookEvent {
  readonly id: string;
  readonly source: string;
  readonly timestamp: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly verified: boolean;
}

export type WebhookHandler = (event: WebhookEvent) => Promise<void> | void;

export interface WebhookRoute {
  readonly id: string;
  readonly secret?: string;
  readonly signatureHeader?: string;
  readonly handler: WebhookHandler;
}

export class WebhookRuntime {
  private readonly routes = new Map<string, WebhookRoute>();

  register(route: WebhookRoute): () => void {
    if (this.routes.has(route.id)) throw new Error(`Webhook route already registered: ${route.id}`);
    this.routes.set(route.id, route);
    return () => this.routes.delete(route.id);
  }

  async dispatch(routeId: string, event: Omit<WebhookEvent, 'verified'>): Promise<void> {
    const route = this.routes.get(routeId);
    if (!route) throw new Error(`Unknown webhook route: ${routeId}`);
    const signature = route.signatureHeader ? this.header(event.headers, route.signatureHeader) : undefined;
    if (route.secret) {
      if (!signature) throw new Error('Webhook signature missing');
      if (!this.verify(route.secret, event.body, signature)) throw new Error('Webhook signature invalid');
    }
    await route.handler({ ...event, verified: Boolean(route.secret) });
  }

  list(): string[] {
    return [...this.routes.keys()].sort();
  }

  private verify(secret: string, body: string, signature: string): boolean {
    const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private header(headers: Record<string, string>, name: string): string | undefined {
    const target = name.toLowerCase();
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
    return entry?.[1];
  }
}
