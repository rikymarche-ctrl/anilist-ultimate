import { vi } from 'vitest';
export const localStorage = { get: vi.fn<(_key: string) => Promise<unknown>>(), set: vi.fn<(_key: string, _value: unknown) => Promise<boolean>>(async () => true) };
export const storage = { get: vi.fn<(_key: string) => Promise<unknown>>(async () => true), set: vi.fn<(_key: string, _value: unknown) => Promise<boolean>>(async () => true) };
