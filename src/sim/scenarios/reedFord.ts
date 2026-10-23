import { TEAM_ATTACKER, TEAM_DEFENDER } from '../api';
import type { Scenario, SquadSpec } from '../scenario';

/**
 * MVP 시나리오 "갈대 여울"(GDD §3.2, §10, D-009). 병력 편성은 GDD §10.3의 1차 가설
 * (방어 3,600 / 공격 5,960)이고, 기본 배치는 GDD §8.3의 AI 방어 계획과 공격 배치 구역을 따른다.
 * 좌표는 월드 m. +x = 서쪽, +z = 북쪽(D-012). 방어는 북쪽(+Z, facing 0)을, 공격은 남쪽(facing π)을 본다.
 */
const NORTH = 0;
const SOUTH = Math.PI;

/** 방어선: 능선 앞 경사(깃발 북쪽 30~50m, GDD §8.3) */
const FRONT_Z = 472;
/** 궁수: 능선 마루 */
const CREST_Z = 436;

const defender: SquadSpec[] = [
  // 동쪽 다리(x 240) 출구 수비(보병 1·창병 1)
  { type: 'infantry', x: 240, z: 548, facing: NORTH, role: 'eastBridge' },
  { type: 'spearman', x: 240, z: 532, facing: NORTH, role: 'eastBridge' },
  // 능선 앞 경사 전열
  { type: 'infantry', x: 290, z: FRONT_Z, facing: NORTH, role: 'line' },
  { type: 'spearman', x: 350, z: FRONT_Z, facing: NORTH, role: 'line' },
  { type: 'infantry', x: 410, z: FRONT_Z, facing: NORTH, role: 'line' },
  { type: 'infantry', x: 470, z: FRONT_Z, facing: NORTH, role: 'line' },
  { type: 'spearman', x: 530, z: FRONT_Z, facing: NORTH, role: 'line' },
  { type: 'infantry', x: 590, z: FRONT_Z, facing: NORTH, role: 'line' },
  // 능선 마루 궁수
  { type: 'archer', x: 320, z: CREST_Z, facing: NORTH, role: 'crest' },
  { type: 'archer', x: 390, z: CREST_Z, facing: NORTH, role: 'crest' },
  { type: 'archer', x: 460, z: CREST_Z, facing: NORTH, role: 'crest' },
  { type: 'archer', x: 530, z: CREST_Z, facing: NORTH, role: 'crest' },
  // 능선 서쪽 끝(x 660) 뒤 기병 예비대 2, 중앙 예비 1
  { type: 'cavalry', x: 650, z: 400, facing: NORTH, role: 'reserveWest' },
  { type: 'cavalry', x: 650, z: 370, facing: NORTH, role: 'reserveWest' },
  { type: 'cavalry', x: 420, z: 380, facing: NORTH, role: 'reserveCenter' },
  { type: 'cavalry', commander: true, x: 420, z: 405, facing: NORTH, role: 'commander' },
];

/** 공격 배치 구역 x 60~960, z 800~980(GDD §10.2). 앞줄 z 860, 뒷줄 z 900·940. */
const attacker: SquadSpec[] = [
  // 동쪽 집단(동쪽 다리 x 240 방면)
  { type: 'infantry', x: 160, z: 860, facing: SOUTH, role: 'eastGroup' },
  { type: 'infantry', x: 225, z: 860, facing: SOUTH, role: 'eastGroup' },
  { type: 'spearman', x: 290, z: 860, facing: SOUTH, role: 'eastGroup' },
  { type: 'spearman', x: 190, z: 900, facing: SOUTH, role: 'eastGroup' },
  // 중앙 집단(여울 방면)
  { type: 'infantry', x: 400, z: 860, facing: SOUTH, role: 'center' },
  { type: 'infantry', x: 465, z: 860, facing: SOUTH, role: 'center' },
  { type: 'infantry', x: 530, z: 860, facing: SOUTH, role: 'center' },
  { type: 'infantry', x: 595, z: 860, facing: SOUTH, role: 'center' },
  { type: 'spearman', x: 430, z: 900, facing: SOUTH, role: 'center' },
  { type: 'spearman', x: 495, z: 900, facing: SOUTH, role: 'center' },
  { type: 'spearman', x: 560, z: 900, facing: SOUTH, role: 'center' },
  // 궁수(북쪽 둔덕 엄호용)
  { type: 'archer', x: 420, z: 830, facing: SOUTH, role: 'archers' },
  { type: 'archer', x: 490, z: 830, facing: SOUTH, role: 'archers' },
  { type: 'archer', x: 560, z: 830, facing: SOUTH, role: 'archers' },
  { type: 'archer', x: 630, z: 830, facing: SOUTH, role: 'archers' },
  { type: 'archer', x: 260, z: 830, facing: SOUTH, role: 'archers' },
  // 서쪽 집단(서쪽 다리 x 800 방면)
  { type: 'infantry', x: 760, z: 860, facing: SOUTH, role: 'westGroup' },
  { type: 'infantry', x: 825, z: 860, facing: SOUTH, role: 'westGroup' },
  { type: 'spearman', x: 790, z: 900, facing: SOUTH, role: 'westGroup' },
  // 기병
  { type: 'cavalry', x: 700, z: 940, facing: SOUTH, role: 'cavalry' },
  { type: 'cavalry', x: 775, z: 940, facing: SOUTH, role: 'cavalry' },
  { type: 'cavalry', x: 850, z: 940, facing: SOUTH, role: 'cavalry' },
  { type: 'cavalry', x: 700, z: 970, facing: SOUTH, role: 'cavalry' },
  { type: 'cavalry', x: 775, z: 970, facing: SOUTH, role: 'cavalry' },
  { type: 'cavalry', x: 850, z: 970, facing: SOUTH, role: 'cavalry' },
  { type: 'cavalry', commander: true, x: 500, z: 950, facing: SOUTH, role: 'commander' },
];

export const REED_FORD: Scenario = {
  id: 'reed_ford',
  name: '갈대 여울',
  defender: TEAM_DEFENDER,
  attacker: TEAM_ATTACKER,
  rules: {
    timeLimit: 15 * 60,
    overtimeMax: 60,
    breakRatio: 0.25,
    flag: { x: 420, z: 432, radius: 40 },
    captureTime: 60,
    captureRate: 1,
    decayRate: 2,
  },
  zones: [
    { minX: 150, minZ: 150, maxX: 900, maxZ: 560 },
    { minX: 60, minZ: 800, maxX: 960, maxZ: 980 },
  ],
  teams: [defender, attacker],
};
