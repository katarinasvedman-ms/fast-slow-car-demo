/// <reference path="./three.d.ts" />
import * as THREE from 'three';

export function createMirrorView() {
  const camera = new THREE.PerspectiveCamera(25, 3.5, 0.1, 150);
  const target = new THREE.WebGLRenderTarget(1, 1);
  // Reflect the rear-camera image, not the world or its face winding.
  target.texture.repeat.x = -1;
  target.texture.offset.x = 1;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({ map: target.texture });
  const screen = new THREE.Scene();
  screen.add(new THREE.Mesh(geometry, material));
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    camera, target, screen, screenCamera,
    setLane(lane: number): void {
      const x = (lane - 2) * 3.6;
      camera.position.set(x, 1.6, 0);
      camera.lookAt(x, 1, 40);
      camera.updateMatrixWorld();
    },
    dispose(): void {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
