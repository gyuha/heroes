import {
  Color,
  DataTexture,
  FloatType,
  MeshLambertMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  Vector4,
  type Side,
  type Texture,
} from 'three';
import { BAKE_FPS, CLIP_COUNT, CLIP_ENTRY_SIZE } from './clipTable';

/** 팀 색(ART_STYLE_GUIDE): 0 = 청람, 1 = 황토. sRGB 16진수 → Color 가 선형 작업 공간 값으로 바꿔 둔다. */
export const TEAM_COLOR_HEX = [0x247da8, 0xe4a33b] as const;
const TEAM_COUNT = TEAM_COLOR_HEX.length;

/** 모든 병종 머티리얼이 같은 객체를 공유하는 uniform. */
export interface SharedSoldierUniforms {
  uTeamColors: { value: Color[] };
}

export function createSharedUniforms(): SharedSoldierUniforms {
  return {
    uTeamColors: { value: TEAM_COLOR_HEX.map((hex) => new Color(hex)) },
  };
}

/** 굽기 결과를 RGBA32F 텍스처로 만든다. texelFetch 로만 읽으므로 필터·밉맵 없음. */
export function createBoneTexture(data: Float32Array, width: number, height: number): DataTexture {
  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

// 정점 셰이더 전역 선언. aAnim = (클립 번호, 클립 시간(초), 팀). 클립 시간은 CPU 가 정한다(clipSelect.ts). skinIndex·skinWeight 는
// SkinnedMesh 가 아니라서 three.js 가 선언하지 않으므로 여기서 선언한다.
const VERTEX_PARS = /* glsl */ `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 aAnim;
uniform highp sampler2D uBoneTex;
uniform vec4 uClips[${CLIP_COUNT}];
uniform vec3 uTeamColors[${TEAM_COUNT}];
varying vec3 vTeamColor;

mat4 soldierBone( int bone, int row ) {
	int x = bone * 4;
	return mat4(
		texelFetch( uBoneTex, ivec2( x, row ), 0 ),
		texelFetch( uBoneTex, ivec2( x + 1, row ), 0 ),
		texelFetch( uBoneTex, ivec2( x + 2, row ), 0 ),
		texelFetch( uBoneTex, ivec2( x + 3, row ), 0 ) );
}

// 인접 두 프레임의 행렬을 선형으로 섞는다(30fps 사이 보간).
mat4 soldierBoneLerp( float bone, int row0, int row1, float t ) {
	int b = int( bone + 0.5 );
	mat4 m0 = soldierBone( b, row0 );
	if ( row1 == row0 || t <= 0.0 ) return m0;
	return m0 * ( 1.0 - t ) + soldierBone( b, row1 ) * t;
}
`;

// 재생 위치 계산(clipTable.ts 의 sampleClip 과 같은 식) + 본 4개 스키닝 행렬.
// 가중치 0 인 본은 건너뛴다(현재 리소스는 정점당 본 1개라 텍스처 읽기가 1/4 로 준다).
const VERTEX_SKIN = /* glsl */ `
	vec4 sClip = uClips[ clamp( int( aAnim.x + 0.5 ), 0, ${CLIP_COUNT - 1} ) ];
	float sLocal = aAnim.y;
	sLocal = sClip.w > 0.5 ? mod( sLocal, sClip.z ) : clamp( sLocal, 0.0, sClip.z );
	float sPos = min( sLocal * ${BAKE_FPS.toFixed(1)}, sClip.y - 1.0 );
	float sF0 = floor( sPos );
	float sBlend = sPos - sF0;
	int sRow0 = int( sClip.x + sF0 + 0.5 );
	int sRow1 = int( sClip.x + min( sF0 + 1.0, sClip.y - 1.0 ) + 0.5 );
	mat4 skinMat = skinWeight.x * soldierBoneLerp( skinIndex.x, sRow0, sRow1, sBlend );
	if ( skinWeight.y > 0.0 ) skinMat += skinWeight.y * soldierBoneLerp( skinIndex.y, sRow0, sRow1, sBlend );
	if ( skinWeight.z > 0.0 ) skinMat += skinWeight.z * soldierBoneLerp( skinIndex.z, sRow0, sRow1, sBlend );
	if ( skinWeight.w > 0.0 ) skinMat += skinWeight.w * soldierBoneLerp( skinIndex.w, sRow0, sRow1, sBlend );
	vTeamColor = uTeamColors[ clamp( int( aAnim.z + 0.5 ), 0, ${TEAM_COUNT - 1} ) ];
`;

// 팀 색: 선형 공간에서 base.rgb * mix(1, 팀색, base.a). 알파는 마스크일 뿐 투명도가 아니다.
// 텍스처가 없는 임시 캡슐은 전체를 팀 색으로 칠한다.
const FRAGMENT_MAP = /* glsl */ `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	diffuseColor.rgb *= sampledDiffuseColor.rgb * mix( vec3( 1.0 ), vTeamColor, sampledDiffuseColor.a );
#else
	diffuseColor.rgb *= vTeamColor;
#endif
`;

export interface SoldierMaterialOptions {
  map: Texture | null;
  side: Side;
  boneTexture: DataTexture;
  /** clipTable.entries (CLIP_COUNT × [시작 줄, 프레임 수, 길이, 반복]) */
  clipEntries: Float32Array;
  shared: SharedSoldierUniforms;
}

/**
 * 인스턴스 스키닝 Lambert 머티리얼. 일반 InstancedMesh 에 쓰고, 스키닝은 이 셰이더가 직접 한다
 * (three.js 코어에는 인스턴스 스키닝 메시가 없다, ARCHITECTURE §5.2).
 */
export function createSoldierMaterial(opts: SoldierMaterialOptions): MeshLambertMaterial {
  const { map } = opts;
  if (map) {
    // 알파를 미리 곱하면 알파 0(원래 색) 영역의 RGB 가 0 이 된다.
    map.premultiplyAlpha = false;
    map.colorSpace = SRGBColorSpace;
    map.needsUpdate = true;
  }
  const material = new MeshLambertMaterial({
    map,
    side: opts.side,
    transparent: false,
    alphaTest: 0,
  });
  const clips: Vector4[] = [];
  for (let c = 0; c < CLIP_COUNT; c++) {
    clips.push(new Vector4().fromArray(opts.clipEntries, c * CLIP_ENTRY_SIZE));
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBoneTex = { value: opts.boneTexture };
    shader.uniforms.uClips = { value: clips };
    shader.uniforms.uTeamColors = opts.shared.uTeamColors;
    shader.vertexShader = shader.vertexShader
      .replace('#include <skinning_pars_vertex>', VERTEX_PARS)
      .replace('#include <skinbase_vertex>', VERTEX_SKIN)
      .replace(
        '#include <skinnormal_vertex>',
        'objectNormal = ( skinMat * vec4( objectNormal, 0.0 ) ).xyz;',
      )
      .replace(
        '#include <skinning_vertex>',
        'transformed = ( skinMat * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTeamColor;')
      .replace('#include <map_fragment>', FRAGMENT_MAP);
  };
  // 네 병종이 같은 GLSL 을 쓰므로 프로그램을 공유한다(uniform 값은 머티리얼마다 따로).
  material.customProgramCacheKey = () => 'soldier-instanced-skinning-v1';
  return material;
}
