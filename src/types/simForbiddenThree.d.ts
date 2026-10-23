// tsconfig.sim.json 이 src/sim 의 'three' import 를 이 파일로 돌린다.
// 아무것도 내보내지 않으므로 sim 에서 three 의 어떤 이름을 써도 타입 오류가 난다.
declare const SIM_MUST_NOT_IMPORT_THREE: unique symbol;
export default SIM_MUST_NOT_IMPORT_THREE;
