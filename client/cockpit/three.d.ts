// The pinned browser build has no bundled types. Declare only the API used here.
declare module 'three' {
  export class Color {
    constructor(value: string | number);
  }
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number; y: number; z: number;
    set(x: number, y: number, z: number): this;
    project(camera: PerspectiveCamera): this;
  }
  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number; y: number;
  }
  export class Object3D {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
    visible: boolean;
    add(...objects: Object3D[]): void;
    remove(...objects: Object3D[]): void;
    lookAt(x: number, y: number, z: number): void;
    updateMatrixWorld(force?: boolean): void;
  }
  export class Scene extends Object3D {
    background: Color;
    fog: Fog;
  }
  export class Group extends Object3D {}
  export class Fog {
    constructor(color: Color, near: number, far: number);
  }
  export class PerspectiveCamera extends Object3D {
    constructor(fov: number, aspect: number, near: number, far: number);
    aspect: number;
    updateProjectionMatrix(): void;
  }
  export class OrthographicCamera extends Object3D {
    constructor(left: number, right: number, top: number, bottom: number, near: number, far: number);
  }
  export class WebGLRenderTarget {
    constructor(width: number, height: number);
    texture: Texture;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
  export class WebGLRenderer {
    constructor(options: { canvas: HTMLCanvasElement; antialias: boolean; powerPreference: string });
    setPixelRatio(ratio: number): void;
    getPixelRatio(): number;
    setRenderTarget(target: WebGLRenderTarget | null): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setViewport(x: number, y: number, width: number, height: number): void;
    setScissor(x: number, y: number, width: number, height: number): void;
    setScissorTest(enabled: boolean): void;
    render(scene: Scene, camera: PerspectiveCamera | OrthographicCamera): void;
    dispose(): void;
    forceContextLoss(): void;
  }
  export class BufferGeometry { dispose(): void; }
  export class BoxGeometry extends BufferGeometry { constructor(width: number, height: number, depth: number); }
  export class PlaneGeometry extends BufferGeometry { constructor(width: number, height: number); }
  export class SphereGeometry extends BufferGeometry { constructor(radius: number, width: number, height: number); }
  export class Material { dispose(): void; }
  export class MeshStandardMaterial extends Material {
    constructor(options: { color: Color; roughness?: number; metalness?: number; emissive?: Color; emissiveIntensity?: number; map?: Texture; transparent?: boolean; opacity?: number; alphaTest?: number; depthWrite?: boolean });
    opacity: number;
    map: Texture | null;
  }
  export class MeshBasicMaterial extends Material {
    constructor(options: { color?: Color; map?: Texture; transparent?: boolean; opacity?: number; wireframe?: boolean; depthWrite?: boolean });
    opacity: number;
  }
  export class Mesh extends Object3D {
    constructor(geometry: BufferGeometry, material: Material);
    geometry: BufferGeometry;
  }
  export class Texture {
    dispose(): void;
    colorSpace: string;
    repeat: Vector2;
    offset: Vector2;
    updateMatrix(): void;
    transformUv(uv: Vector2): Vector2;
  }
  export class CanvasTexture extends Texture { constructor(canvas: HTMLCanvasElement); }
  export class TextureLoader {
    load(url: string, onLoad?: (texture: Texture) => void, onProgress?: undefined, onError?: (error: unknown) => void): Texture;
  }
  export class SpriteMaterial extends Material {
    constructor(options: { map: Texture; transparent: boolean; depthTest: boolean });
    opacity: number;
  }
  export class Sprite extends Object3D { constructor(material: SpriteMaterial); }
  export class HemisphereLight extends Object3D { constructor(sky: Color, ground: Color, intensity: number); }
  export class SpotLight extends Object3D {
    constructor(color: Color, intensity: number, distance: number, angle: number, penumbra: number, decay: number);
    target: Object3D;
  }
  export const SRGBColorSpace: string;
}
