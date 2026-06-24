import { describe, it, expect, vi } from 'vitest';
import { helloCommand } from './hello.js';

describe('helloCommand', () => {
  it('should greet with the provided name', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    helloCommand('Alice');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Hello, Alice!'));
    spy.mockRestore();
  });

  it('should greet a default user when no name is given', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    helloCommand();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Hello, EamilOS user!'));
    spy.mockRestore();
  });

  it('should include system info in output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    helloCommand('test');
    const calls = spy.mock.calls.flatMap(c => c.map(String)).join(' ');
    expect(calls).toMatch(/Node\.js/);
    expect(calls).toMatch(/Platform:/);
    expect(calls).toMatch(/EamilOS v/);
    spy.mockRestore();
  });
});
