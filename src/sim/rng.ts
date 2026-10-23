/**
 * 시드 고정 난수 생성기(mulberry32). 시뮬레이션은 Math.random 대신 이것만 쓴다.
 * 같은 시드면 같은 결과가 나와 테스트와 리플레이가 가능하다.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) 균등 분포. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 균등 분포. */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}
