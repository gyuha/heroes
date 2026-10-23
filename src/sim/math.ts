export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 각도를 [-π, π) 로 접는다. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * 객체의 숫자 필드를 V8의 실수(Double) 표현으로 미리 바꿔 둔다(값은 그대로).
 *
 * V8은 처음 정수로 저장된 필드를 정수(Smi) 표현으로 두었다가, 나중에 처음으로 소수가 들어오면 그 필드 표현을
 * 넓히며 객체의 숨은 클래스(map)를 바꾼다. 그 map을 가정하고 최적화된 함수는 모두 버려진다. 부대의 타이머·속도
 * 필드는 전투 중 서로 다른 때(첫 이동, 첫 손실, 첫 이탈…) 처음 소수를 받으므로, 그대로 두면 전투 내내 최적화
 * 코드가 주기적으로 버려지고 그동안 실수가 힙 객체로 만들어져 가비지가 생긴다(ARCHITECTURE §11.6-11).
 * 생성할 때 한 번 소수를 저장했다가 되돌리면 첫 객체에서 표현이 정해지고, 이후 모든 객체가 같은 map을 쓴다.
 */
export function primeDoubleFields<T extends object>(
  obj: T,
  keys: readonly (keyof T & string)[],
): void {
  const o = obj as unknown as Record<string, number>;
  for (const k of keys) {
    const v = o[k];
    o[k] = DOUBLE_PRIMER;
    o[k] = v;
  }
}
const DOUBLE_PRIMER = 0.5;

/**
 * 2차원 벡터 길이. Math.hypot 대신 쓴다: V8은 Math.hypot을 인라인하지 않아 호출마다 인자·반환값을 힙 객체로
 * 감싸고(가비지), Math.sqrt는 IEEE 754가 정확한 반올림을 보장해 브라우저 간 결정론에도 유리하다(D-016).
 */
export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}
