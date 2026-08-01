import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const GRAVITY = 9.8;
const AIR_DAMPING = 0.998;
const GROUND_Y = 0;
const MAX_ARM_LENGTH = 1.5;
const HAND_RADIUS = 0.06;
const HEAD_RADIUS = 0.15;
const VELOCITY_HISTORY_SIZE = 8;
const VELOCITY_LIMIT = 0.03;
const JUMP_MULTIPLIER = 1.1;
const MAX_JUMP_SPEED = 14;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd1ff);
scene.fog = new THREE.Fog(0x9fd1ff, 20, 90);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 1.1);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
sunLight.position.set(10, 20, 8);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -30;
sunLight.shadow.camera.right = 30;
sunLight.shadow.camera.top = 30;
sunLight.shadow.camera.bottom = -30;
scene.add(sunLight);

const rig = new THREE.Group();
rig.position.set(0, GROUND_Y, 5);
rig.add(camera);
scene.add(rig);

const collidables = [];

const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3d, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
collidables.push(ground);

function addBlock(x, y, z, sx, sy, sz, color) {
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  );
  block.position.set(x, y, z);
  block.castShadow = true;
  block.receiveShadow = true;
  scene.add(block);
  collidables.push(block);
  return block;
}

addBlock(0, 1, -6, 4, 2, 4, 0x8a6d3f);
addBlock(6, 3, -10, 3, 0.4, 3, 0xb08968);
addBlock(-6, 5, -14, 3, 0.4, 3, 0xb08968);
addBlock(0, 7, -18, 3, 0.4, 3, 0xb08968);
addBlock(0, 10, -24, 6, 0.5, 6, 0x8a6d3f);

const barMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.3 });
for (let i = 0; i < 6; i++) {
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2, 12), barMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(-8 + i * 2, 4 + Math.sin(i) * 0.6, -1);
  bar.castShadow = true;
  scene.add(bar);
  collidables.push(bar);
}

const controllerModelFactory = new XRControllerModelFactory();

function buildController(index) {
  const controller = renderer.xr.getController(index);
  rig.add(controller);

  const grip = renderer.xr.getControllerGrip(index);
  grip.add(controllerModelFactory.createControllerModel(grip));
  rig.add(grip);

  const handMarker = new THREE.Mesh(
    new THREE.SphereGeometry(HAND_RADIUS, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000 })
  );
  controller.add(handMarker);
  controller.userData.marker = handMarker;

  return controller;
}

const controller1 = buildController(0);
const controller2 = buildController(1);

function setHandColor(controller, touching) {
  controller.userData.marker.material.color.set(touching ? 0x4dff88 : 0x222222);
  controller.userData.marker.material.emissive.set(touching ? 0x1c6b3a : 0x000000);
}

const handStates = [
  { lastPos: new THREE.Vector3(), touching: false },
  { lastPos: new THREE.Vector3(), touching: false }
];

let handsInitialized = false;

const raycaster = new THREE.Raycaster();
const freeVelocity = new THREE.Vector3();
const velocityHistory = new Array(VELOCITY_HISTORY_SIZE).fill(0).map(() => new THREE.Vector3());
let velocityIndex = 0;

const clock = new THREE.Clock();

function clampToArmLength(headPos, rawPos) {
  const offset = rawPos.clone().sub(headPos);
  const dist = offset.length();
  if (dist <= MAX_ARM_LENGTH) return rawPos.clone();
  return headPos.clone().add(offset.normalize().multiplyScalar(MAX_ARM_LENGTH));
}

function probeTouching(fromPos, toPos) {
  const travel = toPos.clone().sub(fromPos);
  const travelLength = travel.length();
  if (travelLength < 1e-5) return null;
  raycaster.set(fromPos, travel.normalize());
  raycaster.far = travelLength + HAND_RADIUS;
  const hits = raycaster.intersectObjects(collidables, false);
  if (hits.length > 0 && hits[0].distance <= travelLength + HAND_RADIUS) return hits[0];
  return null;
}

function updateLocomotion(dt) {
  if (dt <= 0) return;

  const headPos = new THREE.Vector3();
  camera.getWorldPosition(headPos);

  const controllers = [controller1, controller2];
  const rawPositions = controllers.map(() => new THREE.Vector3());
  controllers.forEach((c, i) => c.getWorldPosition(rawPositions[i]));
  const targetPositions = rawPositions.map((p) => clampToArmLength(headPos, p));

  if (!handsInitialized) {
    handStates[0].lastPos.copy(targetPositions[0]);
    handStates[1].lastPos.copy(targetPositions[1]);
    handsInitialized = true;
  }

  const gravityAssist = new THREE.Vector3(0, -2 * GRAVITY * dt * dt, 0);
  const results = [];

  controllers.forEach((controller, i) => {
    const state = handStates[i];
    const probeTarget = targetPositions[i].clone().add(gravityAssist);
    const hit = probeTouching(state.lastPos, probeTarget);
    const touching = hit ? true : state.touching && targetPositions[i].distanceTo(state.lastPos) < 1e-5;
    const delta = touching ? state.lastPos.clone().sub(targetPositions[i]) : new THREE.Vector3();
    results.push({ touching, delta });
  });

  const bothTouching = results[0].touching && results[1].touching;
  const bodyMovement = new THREE.Vector3();
  if (bothTouching) {
    bodyMovement.addVectors(results[0].delta, results[1].delta).multiplyScalar(0.5);
  } else {
    bodyMovement.add(results[0].delta).add(results[1].delta);
  }

  if (bodyMovement.lengthSq() > 1e-8) {
    const dir = bodyMovement.clone().normalize();
    raycaster.set(headPos, dir);
    raycaster.far = bodyMovement.length() + HEAD_RADIUS;
    const headHits = raycaster.intersectObjects(collidables, false);
    if (headHits.length > 0 && headHits[0].distance < bodyMovement.length() + HEAD_RADIUS) {
      const safeDist = Math.max(0, headHits[0].distance - HEAD_RADIUS);
      bodyMovement.copy(dir).multiplyScalar(safeDist);
    }
  }

  rig.position.add(bodyMovement);

  controllers.forEach((controller, i) => {
    const state = handStates[i];
    const worldPos = new THREE.Vector3();
    controller.getWorldPosition(worldPos);
    state.lastPos.copy(worldPos);
    state.touching = results[i].touching;
    setHandColor(controller, results[i].touching);
  });

  velocityHistory[velocityIndex].copy(bodyMovement).divideScalar(dt);
  velocityIndex = (velocityIndex + 1) % VELOCITY_HISTORY_SIZE;
  const avgVelocity = new THREE.Vector3();
  velocityHistory.forEach((v) => avgVelocity.add(v));
  avgVelocity.divideScalar(VELOCITY_HISTORY_SIZE);

  const anyTouching = results[0].touching || results[1].touching;

  if (anyTouching) {
    if (avgVelocity.length() > VELOCITY_LIMIT) {
      const speed = Math.min(avgVelocity.length() * JUMP_MULTIPLIER, MAX_JUMP_SPEED);
      freeVelocity.copy(avgVelocity).normalize().multiplyScalar(speed);
    } else {
      freeVelocity.set(0, 0, 0);
    }
  } else {
    freeVelocity.y -= GRAVITY * dt;
    rig.position.addScaledVector(freeVelocity, dt);
    freeVelocity.multiplyScalar(AIR_DAMPING);
  }

  if (rig.position.y < GROUND_Y) {
    rig.position.y = GROUND_Y;
    freeVelocity.set(0, 0, 0);
  }
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateLocomotion(dt);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
