import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const GRAVITY = 18;
const AIR_DAMPING = 0.995;
const GROUND_Y = 0;

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

const groundMat = new THREE.MeshStandardMaterial({ color: 0x3d7a3d, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function addBlock(x, y, z, sx, sy, sz, color) {
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  );
  block.position.set(x, y, z);
  block.castShadow = true;
  block.receiveShadow = true;
  scene.add(block);
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
}

const controllerModelFactory = new XRControllerModelFactory();

function buildController(index) {
  const controller = renderer.xr.getController(index);
  rig.add(controller);

  const grip = renderer.xr.getControllerGrip(index);
  grip.add(controllerModelFactory.createControllerModel(grip));
  rig.add(grip);

  const handMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x000000 })
  );
  controller.add(handMarker);
  controller.userData.marker = handMarker;

  return controller;
}

const controller1 = buildController(0);
const controller2 = buildController(1);

const controllersState = [
  { grabbing: false, prevPos: new THREE.Vector3() },
  { grabbing: false, prevPos: new THREE.Vector3() }
];

function setGrabColor(controller, grabbing) {
  controller.userData.marker.material.color.set(grabbing ? 0x4dff88 : 0x222222);
  controller.userData.marker.material.emissive.set(grabbing ? 0x1c6b3a : 0x000000);
}

function onSqueezeStart(index) {
  const controller = index === 0 ? controller1 : controller2;
  controllersState[index].grabbing = true;
  controller.getWorldPosition(controllersState[index].prevPos);
  setGrabColor(controller, true);
}

function onSqueezeEnd(index) {
  const controller = index === 0 ? controller1 : controller2;
  controllersState[index].grabbing = false;
  setGrabColor(controller, false);
}

controller1.addEventListener('squeezestart', () => onSqueezeStart(0));
controller1.addEventListener('squeezeend', () => onSqueezeEnd(0));
controller2.addEventListener('squeezestart', () => onSqueezeStart(1));
controller2.addEventListener('squeezeend', () => onSqueezeEnd(1));

const velocity = new THREE.Vector3();
const clock = new THREE.Clock();
const tmpPos = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();

function updateLocomotion(dt) {
  if (dt <= 0) return;

  let anyGrabbing = false;
  const controllers = [controller1, controller2];

  controllers.forEach((controller, i) => {
    const state = controllersState[i];
    if (!state.grabbing) return;
    anyGrabbing = true;

    controller.getWorldPosition(tmpPos);
    tmpDelta.copy(tmpPos).sub(state.prevPos);

    rig.position.sub(tmpDelta);

    velocity.copy(tmpDelta).multiplyScalar(-1 / dt);

    controller.getWorldPosition(state.prevPos);
  });

  if (!anyGrabbing) {
    velocity.y -= GRAVITY * dt;
    rig.position.addScaledVector(velocity, dt);
    velocity.multiplyScalar(AIR_DAMPING);
  }

  if (rig.position.y < GROUND_Y) {
    rig.position.y = GROUND_Y;
    velocity.set(0, 0, 0);
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
