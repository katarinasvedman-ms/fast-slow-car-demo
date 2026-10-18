import * as THREE from 'three';
import type { CockpitEvent, CockpitView } from './model.js';

export class RoadScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600);
  private rear = new THREE.PerspectiveCamera(55, 3.5, 0.1, 150);
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private markers = new THREE.Group();
  private traffic = new Map<number, THREE.Group>();
  private contact = new THREE.Group();
  private animal: THREE.Mesh | undefined;
  private animalMaterial: THREE.MeshStandardMaterial | undefined;
  private animalReady = false;
  private animalRevealedAt = 0;
  private animalIdentity: string | null = null;
  private lamps: THREE.SpotLight[] = [];
  private brakeGlow = new THREE.Group();
  private view: CockpitView | undefined;
  private frame = 0;
  private disposed = false;
  private generation = 0;
  private fromLane = 2;
  private fromDistance = 0;
  private shownLane = 2;
  private shownDistance = 0;
  private changedAt = 0;
  private impactAt = -Infinity;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private colors = getComputedStyle(document.documentElement);
  private resizeObserver: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private mirror: HTMLElement,
    private onError: (message: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.rebuild();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.resize();
    this.frame = requestAnimationFrame(this.draw);
  }

  private color(name: string): THREE.Color {
    return new THREE.Color(this.colors.getPropertyValue(`--cp-${name}`).trim());
  }

  private material(name: string, glowing = false): THREE.MeshStandardMaterial {
    const color = this.color(name);
    const material = new THREE.MeshStandardMaterial({
      color, roughness: 0.8, metalness: 0.15,
      ...(glowing ? { emissive: color, emissiveIntensity: 0.7 } : {}),
    });
    this.materials.push(material);
    return material;
  }

  private box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    this.geometries.push(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private release(): void {
    this.generation += 1;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries = [];
    this.materials = [];
    this.textures = [];
  }

  private rebuild(): void {
    this.release();
    this.scene = new THREE.Scene();
    this.scene.background = this.color('night');
    this.scene.fog = new THREE.Fog(this.color('night'), 18, 125);
    this.scene.add(new THREE.HemisphereLight(this.color('horizon'), this.color('night'), 1.7));
    const asphalt = this.material('asphalt');
    const paint = this.material('road-line', true);
    const shoulder = this.material('shoulder');
    const road = this.box(11.2, 0.12, 1700, asphalt);
    road.position.set(0, -0.1, -720);
    this.scene.add(road);
    for (const x of [-5.8, 5.8]) {
      const edge = this.box(0.15, 0.03, 1700, paint);
      edge.position.set(x, 0.01, -720);
      this.scene.add(edge);
      const bank = this.box(25, 0.08, 1700, shoulder);
      bank.position.set(x < 0 ? -18.5 : 18.5, -0.08, -720);
      this.scene.add(bank);
    }
    this.markers = new THREE.Group();
    for (let z = -170; z < 80; z += 12) {
      for (const x of [-1.8, 1.8]) {
        const dash = this.box(0.12, 0.025, 4.5, paint);
        dash.position.set(x, 0.015, z);
        this.markers.add(dash);
      }
      for (const x of [-6.2, 6.2]) {
        const post = this.box(0.12, 0.9, 0.12, shoulder);
        post.position.set(x, 0.45, z);
        const reflector = this.box(0.14, 0.15, 0.15, paint);
        reflector.position.set(x, 0.8, z);
        this.markers.add(post, reflector);
      }
    }
    this.scene.add(this.markers);
    this.traffic.clear();
    const blue = this.material('traffic', true);
    const glass = this.material('night');
    for (let lane = 1; lane <= 3; lane += 1) {
      const car = new THREE.Group();
      car.add(this.box(1.7, 0.7, 3.8, blue));
      const roof = this.box(1.4, 0.6, 1.8, glass);
      roof.position.y = 0.6;
      car.add(roof);
      car.visible = false;
      this.traffic.set(lane, car);
      this.scene.add(car);
    }
    this.contact = new THREE.Group();
    const geometry = new THREE.SphereGeometry(0.65, 16, 10);
    this.geometries.push(geometry);
    const thermal = new THREE.MeshBasicMaterial({ color: this.color('warning'), wireframe: true });
    this.materials.push(thermal);
    this.contact.add(new THREE.Mesh(geometry, thermal));
    this.contact.visible = false;
    this.scene.add(this.contact);
    this.brakeGlow = new THREE.Group();
    const brakeMaterial = new THREE.MeshBasicMaterial({ color: this.color('danger'), transparent: true, opacity: 0.12 });
    this.materials.push(brakeMaterial);
    const glow = this.box(3, 0.015, 5, brakeMaterial);
    glow.position.set(0, 0.02, -3.5);
    this.brakeGlow.add(glow);
    this.brakeGlow.visible = false;
    this.scene.add(this.brakeGlow);
    this.animal = undefined;
    this.animalMaterial = undefined;
    this.animalReady = false;
    this.animalIdentity = null;
    this.lamps = [];
    for (const offset of [-0.65, 0.65]) {
      const lamp = new THREE.SpotLight(this.color('headlight'), 110, 75, 0.48, 0.8, 1);
      lamp.position.set(offset, 0.7, -1);
      lamp.target.position.set(offset, 0, -50);
      this.scene.add(lamp, lamp.target);
      this.lamps.push(lamp);
    }
  }

  update(view: CockpitView, events: CockpitEvent[]): void {
    if (events.some((event) => event.type === 'reset')) {
      this.rebuild();
      this.shownLane = view.lane;
      this.shownDistance = view.travelledM;
      this.impactAt = -Infinity;
    }
    if (events.some((event) => event.type === 'outcome' && event.outcome === 'collision')) {
      this.impactAt = performance.now();
    }
    const movingChanged = !this.view || view.lane !== this.view.lane || view.travelledM !== this.view.travelledM;
    if (movingChanged) {
      this.fromLane = this.shownLane;
      this.fromDistance = this.shownDistance;
      this.changedAt = performance.now();
    }
    this.view = view;
    const { world, scene } = view.snapshot;
    for (const lane of scene.lanes) {
      const car = this.traffic.get(lane.lane);
      if (!car) continue;
      car.visible = lane.vehicleBehindM !== null;
      car.position.set((lane.lane - 2) * 3.6, 0.55, lane.vehicleBehindM ?? 0);
    }
    this.contact.visible = view.identity === null;
    this.brakeGlow.visible = world.braking;
    this.contact.position.set((world.hazardLane - 2) * 3.6, 0.8, -world.distanceM);
    if (view.identity !== null && this.animalIdentity !== view.identity) {
      this.animalIdentity = view.identity;
      const generation = this.generation;
      const animal = view.identity === 'elk' ? 'moose' : 'squirrel';
      const texture = new THREE.TextureLoader().load(`/images/${animal}-cutout.png`, (loaded) => {
        if (this.disposed || generation !== this.generation) loaded.dispose();
        else {
          this.animalReady = true;
          this.animalRevealedAt = performance.now();
        }
      }, undefined, () => {
        if (!this.disposed && generation === this.generation) this.onError('Animal image could not be loaded. Use the 2D view.');
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshStandardMaterial({
        color: this.color('headlight'), map: texture, roughness: 1,
        transparent: true, opacity: 0, alphaTest: 0.02, depthWrite: false,
      });
      const geometry = new THREE.PlaneGeometry(animal === 'moose' ? 2.8 : 0.7, animal === 'moose' ? 3 : 0.7);
      this.textures.push(texture);
      this.materials.push(material);
      this.geometries.push(geometry);
      this.animalMaterial = material;
      this.animal = new THREE.Mesh(geometry, material);
      this.animal.visible = false;
      this.scene.add(this.animal);
    }
    if (this.animal) {
      if (!this.animal.visible && view.identity !== null) this.animalRevealedAt = performance.now();
      this.animal.visible = view.identity !== null;
      this.animal.position.set((world.hazardLane - 2) * 3.6, view.identity === 'elk' ? 1.5 : 0.35, -world.distanceM);
    }
  }

  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  private draw = (now: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.draw);
    const view = this.view;
    if (!view) return;
    const { world, settings } = view.snapshot;
    const progress = this.reduced.matches || world.outcome !== 'running'
      ? 1 : Math.min(1, (now - this.changedAt) / settings.tickMs);
    const eased = progress * progress * (3 - 2 * progress);
    this.shownLane = this.fromLane + (view.lane - this.fromLane) * eased;
    this.shownDistance = this.fromDistance + (view.travelledM - this.fromDistance) * progress;
    const x = (this.shownLane - 2) * 3.6;
    const impact = !this.reduced.matches ? Math.max(0, 1 - (now - this.impactAt) / 500) : 0;
    this.camera.position.set(x + Math.sin(now * 0.09) * impact * 0.1, world.braking ? 1.2 : 1.35, 0);
    this.camera.lookAt(x, -8, -60);
    this.camera.rotation.z = this.reduced.matches ? 0 : (view.lane - this.shownLane) * 0.025;
    this.markers.position.z = this.shownDistance % 12;
    this.brakeGlow.position.x = x;
    this.contact.position.z = -(settings.initialHazardDistanceM - this.shownDistance);
    if (this.animal) this.animal.position.z = this.contact.position.z;
    if (this.animalMaterial) {
      this.animalMaterial.opacity = !this.animalReady ? 0
        : this.reduced.matches ? 1 : Math.min(1, (now - this.animalRevealedAt) / 300);
    }
    this.lamps.forEach((lamp, index) => {
      const offset = index === 0 ? -0.65 : 0.65;
      lamp.position.x = x + offset;
      lamp.target.position.x = x + offset;
    });
    const { width, height } = this.canvas.getBoundingClientRect();
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.render(this.scene, this.camera);
    const mirror = this.mirror.getBoundingClientRect();
    const canvas = this.canvas.getBoundingClientRect();
    this.rear.position.set(x, 1.6, 0);
    this.rear.lookAt(x, 1, 40);
    this.rear.aspect = mirror.width / Math.max(mirror.height, 1);
    this.rear.updateProjectionMatrix();
    const left = mirror.left - canvas.left;
    const bottom = canvas.bottom - mirror.bottom;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(left, bottom, mirror.width, mirror.height);
    this.renderer.setViewport(left, bottom, mirror.width, mirror.height);
    this.renderer.render(this.scene, this.rear);
    this.renderer.setScissorTest(false);
  };

  private contextLost = (event: Event): void => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.onError('3D graphics context lost. Reload the cockpit or use the 2D view.');
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.release();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
