import { helloCommand } from './hello.js';

export function hiCommand(name?: string): void {
  helloCommand(name);
}
