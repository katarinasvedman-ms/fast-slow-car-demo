import * as THREE from 'three';
import type { CockpitEvent, CockpitView } from './model.js';
import { contactPosition } from './model.js';
import { createMirrorView } from './mirror.js';

export class RoadScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600);
  private mirrorView = createMirrorView();
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private markers = new THREE.Group();
  private roadDashes: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }[] = [];
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
    private sensor: HTMLElement,
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
      color, roughness: name === 'asphalt' ? 0.36 : 0.8, metalness: name === 'asphalt' ? 0.28 : 0.15,
      ...(glowing ? { emissive: color, emissiveIntensity: name === 'headlight' ? 2 : 1 } : {}),
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
    this.scene.fog = new THREE.Fog(this.color('night'), 90, 650);
    this.scene.add(new THREE.HemisphereLight(this.color('horizon'), this.color('night'), 3.2));
    const asphalt = this.material('asphalt');
    const paint = this.material('road-line', true);
    const shoulder = this.material('shoulder');
    const road = this.box(11.2, 0.12, 1700, asphalt);
    road.position.set(0, -0.1, -720);
    this.scene.add(road);
    for (const x of [-5.8, 5.8]) {
      const edge = this.box(0.045, 0.015, 1700, paint);
      edge.position.set(x, 0.01, -720);
      this.scene.add(edge);
      const bank = this.box(25, 0.08, 1700, shoulder);
      bank.position.set(x < 0 ? -18.5 : 18.5, -0.08, -720);
      this.scene.add(bank);
    }
    this.markers = new THREE.Group();
    this.roadDashes = [];
    for (let z = -170; z < 80; z += 12) {
      for (const x of [-1.8, 1.8]) {
        const material = new THREE.MeshBasicMaterial({ color: this.color('road-line'), transparent: true, opacity: 1 });
        this.materials.push(material);
        const dash = this.box(0.055, 0.015, 3.2, material);
        dash.position.set(x, 0.015, z);
        this.markers.add(dash);
        this.roadDashes.push({ mesh: dash, material });
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
      for (const offset of [-0.55, 0.55]) {
        const headlight = this.box(0.3, 0.18, 0.08, this.material('headlight', true));
        headlight.position.set(offset, 0.1, -1.93);
        car.add(headlight);
      }
      car.visible = false;
      this.traffic.set(lane, car);
      this.scene.add(car);
    }
    this.contact = new THREE.Group();
    this.contact.visible = false;
    this.brakeGlow = new THREE.Group();
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const context = glowCanvas.getContext('2d');
    if (!context) throw new Error('Brake glow canvas is unavailable.');
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, this.colors.getPropertyValue('--cp-danger').trim());
    gradient.addColorStop(1, 'transparent');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(glowTexture);
    const brakeMaterial = new THREE.MeshBasicMaterial({ color: this.color('danger'), map: glowTexture, transparent: true, opacity: 0.2, depthWrite: false });
    this.materials.push(brakeMaterial);
    const glowGeometry = new THREE.PlaneGeometry(6, 10);
    this.geometries.push(glowGeometry);
    const glow = new THREE.Mesh(glowGeometry, brakeMaterial);
    glow.rotation.x = -Math.PI / 2;
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
      const lamp = new THREE.SpotLight(this.color('headlight'), 220, 150, 0.48, 0.8, 1);
      lamp.position.set(offset, 0.7, -1);
      lamp.target.position.set(offset, 0, -70);
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
    const position = contactPosition(view);
    this.contact.visible = position !== null;
    this.brakeGlow.visible = world.braking;
    if (position) this.contact.position.set(position.x, 0.7, position.z);
    if (view.identity !== null && this.animalIdentity !== view.identity) {
      if (this.animal && this.animalMaterial) {
        this.scene.remove(this.animal);
        const geometry = this.animal.geometry;
        const material = this.animalMaterial;
        const texture = material.map;
        geometry.dispose();
        material.dispose();
        texture?.dispose();
        this.geometries = this.geometries.filter((item) => item !== geometry);
        this.materials = this.materials.filter((item) => item !== material);
        this.textures = this.textures.filter((item) => item !== texture);
      }
      this.animalIdentity = view.identity;
      this.animalReady = false;
      const generation = this.generation;
      const animal = view.identity === 'elk' ? 'moose' : 'squirrel';
      const texture = new THREE.TextureLoader().load(`/images/${animal}-cutout.png`, (loaded) => {
        if (this.disposed || generation !== this.generation || this.animalMaterial?.map !== loaded) loaded.dispose();
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
      this.animal.visible = view.identity !== null && position !== null;
      if (position) this.animal.position.set(position.x, view.identity === 'elk' ? 1.5 : 0.35, position.z);
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
    this.camera.updateMatrixWorld();
    this.markers.position.z = this.shownDistance % 12;
    for (const { mesh, material } of this.roadDashes) {
      material.opacity = Math.max(0, Math.min(1, (-mesh.position.z - this.markers.position.z - 5) / 12));
    }
    this.brakeGlow.position.x = x;
    const position = contactPosition(view, this.shownDistance);
    if (position) this.contact.position.set(position.x, 0.7, position.z);
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
    const canvas = this.canvas.getBoundingClientRect();
    const projected = new THREE.Vector3(this.contact.position.x, this.contact.position.y, this.contact.position.z).project(this.camera);
    const visible = position !== null && projected.z >= -1 && projected.z <= 1 &&
      Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
    this.sensor.style.visibility = visible ? 'visible' : 'hidden';
    if (visible) {
      const left = (projected.x + 1) * width / 2;
      const top = (1 - projected.y) * height / 2;
      this.sensor.style.left = `${left}px`;
      this.sensor.style.top = `${top}px`;
      const label = this.sensor.querySelector<HTMLElement>('.sensor-label');
      const labelWidth = label?.offsetWidth ?? 400;
      const labelHeight = label?.offsetHeight ?? 100;
      const labelLeft = Math.max(24, Math.min(width - labelWidth - 24, Math.max(width / 2 + 160, left + 48)));
      this.sensor.style.setProperty('--label-x', `${labelLeft - left}px`);
      this.sensor.style.setProperty('--label-y', `${Math.max(12, Math.min(height - labelHeight - 36, height * 0.5)) - top}px`);
      this.sensor.style.setProperty('--contact-size', `${Math.max(22, Math.min(88, 900 / Math.max(1, -position.z)))}px`);
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.render(this.scene, this.camera);
    const mirror = this.mirror.getBoundingClientRect();
    const { camera: rear, target, screen, screenCamera } = this.mirrorView;
    this.mirrorView.setLane(this.shownLane);
    rear.aspect = mirror.width / Math.max(mirror.height, 1);
    rear.updateProjectionMatrix();
    target.setSize(Math.max(1, Math.round(mirror.width * this.renderer.getPixelRatio())),
      Math.max(1, Math.round(mirror.height * this.renderer.getPixelRatio())));
    this.renderer.setRenderTarget(target);
    this.scene.background = this.color('shoulder');
    this.renderer.render(this.scene, rear);
    this.scene.background = this.color('night');
    this.renderer.setRenderTarget(null);
    const left = mirror.left - canvas.left;
    const bottom = canvas.bottom - mirror.bottom;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(left, bottom, mirror.width, mirror.height);
    this.renderer.setViewport(left, bottom, mirror.width, mirror.height);
    this.renderer.render(screen, screenCamera);
    this.renderer.setScissorTest(false);
  };

  private contextLost = (event: Event): void => {
    event.preventDefault();
    cancelAnimationFrame(this.frame);
    this.sensor.style.visibility = 'hidden';
    this.onError('3D graphics context lost. Reload the cockpit or use the 2D view.');
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.release();
    this.mirrorView.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
