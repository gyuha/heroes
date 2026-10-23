// @types/node 없이 생성 도구가 쓰는 Node API만 선언한다(tools/balance 와 같은 방식).
declare const process: { argv: string[]; exitCode?: number };
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function readFileSync(path: string): Uint8Array;
  export function mkdirSync(path: string, opts: { recursive: boolean }): void;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...p: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
declare module 'node:zlib' {
  export function deflateSync(data: Uint8Array): Uint8Array;
  export function crc32(data: Uint8Array, value?: number): number;
}
declare const console: { log(...a: unknown[]): void };
declare const performance: { now(): number };
interface ImportMeta {
  url: string;
}
declare module 'node:inspector' {
  export class Session {
    connect(): void;
    disconnect(): void;
    post(method: string, params: object, cb: (err: Error | null, res: unknown) => void): void;
  }
}
