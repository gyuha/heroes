// @types/node 없이 run.ts 가 쓰는 Node API만 선언한다(의존성 추가 없이 타입 검사).
declare const process: { env: Record<string, string | undefined>; argv: string[] };
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, enc: 'utf8'): string;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...p: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
declare const console: { log(...a: unknown[]): void };
declare const performance: { now(): number };
interface ImportMeta {
  url: string;
}
