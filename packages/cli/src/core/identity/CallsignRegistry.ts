import * as fs from 'fs';
import * as path from 'path';

const CALLSIGNS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];

export class CallsignRegistry {
  private mapping: Map<string, string> = new Map();
  private reverse: Map<string, string> = new Map();
  private storagePath: string;

  constructor(storagePath = './.eamilos/session.json') {
    this.storagePath = storagePath;
    this.load();
  }

  async assign(rankedAgentIds: string[]): Promise<void> {
    this.mapping.clear();
    this.reverse.clear();

    for (let i = 0; i < rankedAgentIds.length && i < CALLSIGNS.length; i++) {
      const sign = CALLSIGNS[i]!;
      const id = rankedAgentIds[i]!;
      this.mapping.set(sign, id);
      this.reverse.set(id, sign);
    }
    await this.persist();
  }

  resolve(callsign: string): string | undefined {
    return this.mapping.get(callsign);
  }

  callsignFor(agentId: string): string | undefined {
    return this.reverse.get(agentId);
  }

  getAllMappings(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.mapping.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        if (data.callsigns) {
          for (const [sign, id] of Object.entries(data.callsigns as Record<string, string>)) {
            this.mapping.set(sign, id);
            this.reverse.set(id, sign);
          }
        }
      }
    } catch {}
  }

  private async persist(): Promise<void> {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const callsigns = this.getAllMappings();
      fs.writeFileSync(this.storagePath, JSON.stringify({ timestamp: Date.now(), callsigns }, null, 2));
    } catch {}
  }
}
