import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { World } from '../sim/world';
import { RtsCamera } from './rtsCamera';
import { createTerrainMesh } from './terrainMesh';
import { UnitInstances } from './unitInstances';

const SKY_COLOR = 0x9fc4e8;

/**
 * 렌더링 계층의 진입점. 시뮬레이션 상태를 읽기만 하고 절대 바꾸지 않는다.
 */
export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly rtsCamera: RtsCamera;
  readonly units: UnitInstances;

  constructor(
    container: HTMLElement,
    private readonly world: World,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(SKY_COLOR);
    this.scene.fog = new Fog(SKY_COLOR, 400, 1200);
    this.scene.add(new HemisphereLight(0xdfe9ff, 0x4a4030, 1.2));
    const sun = new DirectionalLight(0xfff2dd, 2.0);
    sun.position.set(-0.5, 1, 0.3);
    this.scene.add(sun);

    const { terrain } = world;
    this.camera = new PerspectiveCamera(50, 1, 0.5, 2000);
    this.rtsCamera = new RtsCamera(this.camera, this.renderer.domElement, terrain, (x, z) =>
      terrain.heightAt(x, z),
    );

    this.scene.add(createTerrainMesh(terrain));
    this.units = new UnitInstances(world.units.capacity);
    this.units.syncColors(world.units);
    this.scene.add(this.units.mesh);

    this.resize(container.clientWidth, container.clientHeight);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** alpha: 직전 틱과 다음 틱 사이 보간 비율(0~1). */
  render(frameSeconds: number, alpha: number): void {
    this.rtsCamera.update(frameSeconds);
    this.units.sync(this.world.units, alpha);
    this.renderer.render(this.scene, this.camera);
  }
}
