# tools/map — 맵 생성 도구 (T-006, 게임플레이 프로그래머 A)

맵 배치는 코드가 원본이다(`src/sim/map/reedFord.ts`, GDD §10). 이 폴더는 그 결과를 파일로 쓰고 비용을 잰다.
Node 24 이상, 추가 패키지 없음. `src/`는 확장자 없이 import 하므로 `register.mjs`가 `.ts`로 풀어 준다.

```bash
# 맵 파일 재생성 → public/maps/reed_ford/{map.json,height.u16,types.u8}, tools/map/reed_ford_preview.png
node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/map/generate.ts
# 경로·시야·로드 비용 측정
node --experimental-transform-types --no-warnings --import ./tools/map/register.mjs tools/map/bench.ts
# 타입 검사
npx tsc -p tools/map --noEmit
```

- 형식: `docs/ARCHITECTURE.md` §11.1 (첫 행 = 북쪽). 공개 API: `docs/INTERFACES.md` §1.
- 3D 미리보기: `pnpm dev` 후 `/tools/map/preview.html?view=tactical|deploy|battle|battleNorth|ridge|mound|forest|cliff` (게임 빌드에 포함되지 않음). `&light=game` = 지금 게임 조명.
- `reed_ford_preview.png`: 위에서 본 종류 맵 + 음영(북쪽 위, 서쪽 왼쪽: D-012의 +x = 서쪽이라 x를 뒤집어 그린다). 통과 불가 칸은 붉게 섞인다.
- `screenshots/`: T-006 보고용 3D 화면(`before_*` = 고저 가독성 작업 전, `after_*` = 후. 텍스처는 sRGB 재저장본).

생성기를 고쳤으면 위 생성 명령을 다시 돌리고 `pnpm test`(배치 테스트 `src/sim/map/reedFord.test.ts`)를 확인한다.
