// src/ 의 TypeScript 는 확장자 없이 import 한다('./terrain'). Node 의 타입 제거 실행에서도 그대로 읽히도록
// 확장자 없는 상대 경로를 .ts 로 풀어 준다. 사용: node --experimental-transform-types --import ./tools/map/register.mjs <script.ts>
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(specifier + '.ts', context);
    } catch {}
  }
  return next(specifier, context);
}
`),
);
