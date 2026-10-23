# tools/balance — 밸런스 시뮬레이터

게임 디자이너가 관리한다. `docs/BALANCE.md`의 수치를 실제로 계산해 검증하는 도구다.

## 실행

Node 24 이상이 필요하다(TypeScript 타입 제거 기능으로 `.ts`를 바로 실행한다). 추가 패키지는 필요 없다.

```bash
node tools/balance/run.ts              # 전체 시나리오 실행, 결과를 tools/balance/results.md 에 저장 (약 2분)
node tools/balance/run.ts s1 s3        # 일부만 실행(저장 안 함). f, s1~s7
RUNS=200 node tools/balance/run.ts     # 반복 횟수 변경 (기본: 1:1 교전 100회, 군대 전투 40회)
node tools/balance/trace.ts 2 r a      # 군대 전투 한 판을 60초 간격으로 출력 (편성 0~4, f=평지/r=능선, a=측면 고정)
npx tsc -p tools/balance --noEmit      # 타입 검사
```

수치를 바꾸면 전체를 다시 실행하고 `results.md`와 `docs/BALANCE.md`의 요약 표를 함께 갱신한다.

## 파일

| 파일 | 내용 |
|---|---|
| `config.ts` | 모든 수치의 원본(병종, 전투 상수, 사기, 지형 계수). `docs/BALANCE.md` 표와 같아야 한다 |
| `rules.ts` | GDD 공식의 기준 구현(경사 이동 계수, 고도차 사거리, 명중률, 고저차 근접 배율, LOS). 순수 함수라 `src/sim`으로 옮길 수 있다 |
| `engine.ts` | 부대 단위 전투 시뮬레이터(20Hz 고정 틱) |
| `scenarios.ts` | 검증 시나리오 S1~S7 |
| `run.ts` | 실행기 |
| `trace.ts` | 군대 전투 디버그 출력 |
| `results.md` | 마지막 전체 실행 결과(생성 파일, 직접 고치지 않는다) |

## 실제 게임 코드 진단 (T-015)

`src/sim`을 읽고 실행만 한다(수정하지 않음). 헤드리스 러너는 동시에 2개 프로세스까지만 돌린다(QA 성능 측정 보호).

```bash
R="node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs"
$R tools/balance/diagnose.ts --plan A --games 20 --seed 1 --out /tmp/diag_A.json  # 판별 교전 지표(JSON). --snap = 대형 고정 반사실
node --no-warnings tools/balance/diagnose-report.ts /tmp/diag_*.json           # 계획별 마크다운 표
$R tools/balance/charge-probe.ts --plan A --seed 1                              # 기병 충격 순간 기수-대상 거리
$R tools/balance/cohesion-probe.ts --plan A --seed 1                            # 병사-대형 자리 거리, 교전 중 앞 행-적 거리
$R tools/balance/game-trace.ts --plan B --seed 1 --every 90                     # 공격 부대 역할·경로·명령·위치
```

| 파일 | 내용 |
|---|---|
| `diagnose.ts` | AI 대 AI를 돌리며 1초마다 부대 교전·도하·깃발 거리·궁수 사격·돌격을 기록 |
| `diagnose-report.ts` | 위 JSON을 계획별 표로 집계 |
| `charge-probe.ts`, `cohesion-probe.ts`, `game-trace.ts` | 원인 추적용 탐침(한 판) |

결과와 해석은 `docs/BALANCE.md` §10에 있다.

## 모델과 한계

- 병사마다 HP를 따로 둔다. 피해는 접촉한 변의 앞쪽 병사에게 들어가고, 죽으면 뒤 병사가 앞으로 나온다.
- 대형은 직사각형(열 수 × 행 수)으로 본다. 싸우는 병사 수 = 접촉 폭 ÷ 병사 간격 × 리치가 닿는 열 수. 한 변을 여러 적이 나눠 쓰면 남은 폭만 배분한다.
- 실제 게임은 병사 개인 에이전트가 움직이므로 대형이 흐트러지고 감싸기가 생긴다. 이 시뮬레이터는 대형이 유지된다고 가정하므로 **수치의 상대 비교**용이다. T-007 구현 후 실제 시뮬레이션 코드로 같은 시나리오를 다시 돌려 차이를 확인해야 한다.
- 다루지 않는 것: 지휘관 오라와 전사, 시야(전장의 안개), 오사(아군 오인 사격), 대형 변경(산개·종대), 병사 충돌, 경로 탐색. 해당 규칙의 수치는 GDD에 있지만 아직 시뮬레이션으로 검증하지 않았다.
- 군대 전투(S6)의 결과는 시나리오의 단순 AI 스크립트에 크게 좌우된다. "같은 AI 계획에서 공격 측이 병력이 얼마나 더 있어야 이기는가"로 읽는다.
