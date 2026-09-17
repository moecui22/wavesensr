// Setup figure for the "Live data not available" screen: a lit, rotatable 3D scene
// of the recommended placement. Units are cm; x = the participant's left (+) / right (-),
// y = up, z = toward the desk. The person is Mixamo's plain "X Bot" mannequin from the
// three.js examples, posed seated here, with a nose so the face direction reads. Boards are drawn 1.6x real size so they read; click one
// to zoom in on its orientation.
import * as THREE from 'three';
import {OrbitControls} from '/static/vendor/OrbitControls.js';
import {RoundedBoxGeometry} from '/static/vendor/RoundedBoxGeometry.js';
import {GLTFLoader} from '/static/vendor/GLTFLoader.js';
import {RoomEnvironment} from '/static/vendor/RoomEnvironment.js';

const host = document.getElementById('setup3d');
const overlay = document.getElementById('unavail');
const LAMBDA = 12.5, HEAD_Z = -4, BOARD_SCALE = 1.6;
let EYE = 120;                                         // updated to the posed model's eye height
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMappingExposure = .9;
host.prepend(renderer.domElement);

const scene = new THREE.Scene();
// Studio lighting: a soft room environment for reflections, then key, fill and rim lights.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), .04).texture;
const camera = new THREE.PerspectiveCamera(30, 2, 1, 5000);
const HOME = {pos: new THREE.Vector3(-190, 175, 205), target: new THREE.Vector3(0, 102, 8)};   // front three-quarter: face visible
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 20; controls.maxDistance = 900;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = !reduced;
controls.autoRotateSpeed = 0.45;
controls.addEventListener('start', () => { controls.autoRotate = false; });

const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, .35);
const sun = new THREE.DirectionalLight(0xfff4e8, 2.2);                 // key, warm, high front-left
sun.position.set(-160, 320, 200);
const fill = new THREE.DirectionalLight(0xdfe8ff, .6); fill.position.set(220, 120, 80);
const rim = new THREE.DirectionalLight(0xffffff, 1.1); rim.position.set(60, 220, -260);
scene.add(fill, rim);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left: -220, right: 220, top: 220, bottom: -220, near: 50, far: 800});
sun.shadow.bias = -0.0004; sun.shadow.normalBias = .6; sun.shadow.radius = 8;
scene.add(hemi, sun);

const mat = {
  metal: new THREE.MeshStandardMaterial({color: 0x8e8e93, metalness: .7, roughness: .3}),
  pcb: new THREE.MeshStandardMaterial({color: 0x15171a, roughness: .45}),
  shield: new THREE.MeshStandardMaterial({color: 0xc9ccd1, metalness: .9, roughness: .25}),
  usb: new THREE.MeshStandardMaterial({color: 0xd6d8dc, metalness: 1, roughness: .2}),
  pin: new THREE.MeshStandardMaterial({color: 0x2a2a2d, roughness: .6}),
  skin: new THREE.MeshPhysicalMaterial({color: 0xbdb6ac, roughness: .55, clearcoat: .25, clearcoatRoughness: .5}),   // satin mannequin
  sight: new THREE.LineDashedMaterial({dashSize: 3, gapSize: 2.5}),
  field: new THREE.LineBasicMaterial({color: 0x0a84ff}),
  fieldDot: new THREE.MeshBasicMaterial({color: 0x0a84ff}),
};
// The sensitive zone: clear in the middle, deepening blue toward its edge.
const bubbleMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: {field: {value: new THREE.Color(0x2997ff)}, strength: {value: 1},
             phase: {value: 2.0}, dir: {value: 1.0}},
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vX;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vX = position.x;
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 field; uniform float strength; uniform float phase; uniform float dir;
    varying vec3 vN; varying vec3 vV; varying float vX;
    void main(){ float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float x = vX * dir - phase;                              // crests roll from sender (+1) to receiver (-1)
      float band = pow(0.5 + 0.5 * cos(x * 5.0), 3.0) * smoothstep(1.0, 0.55, abs(vX));
      float a = 0.03 + 0.30 * pow(rim, 2.2) + 0.045 * band;
      gl_FragColor = vec4(field, a * strength); }`,                          // one blue; depth comes from opacity alone
});

const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShadowMaterial({opacity: .32}));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
// a soft pool of floor under the scene, fading to nothing: no hard edge, no grid
const pool = new THREE.Mesh(new THREE.CircleGeometry(230, 64), new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, map: (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(.6, 'rgba(255,255,255,.04)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
})()}));
pool.rotation.x = -Math.PI / 2; pool.position.y = .05;
scene.add(floor, pool);

function mesh(geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
  return o;
}
const box = (w, h, d, m, x, y, z, r = 1.2) => mesh(new RoundedBoxGeometry(w, h, d, 3, r), m, x, y, z);
function rod(a, b, r, m) {                             // a cylinder from point a to point b
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A);
  const o = mesh(new THREE.CylinderGeometry(r, r, dir.length(), 12), m);
  o.position.copy(A).add(B).multiplyScalar(.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return o;
}
const line = (pts, m) => {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p))), m);
  l.computeLineDistances(); return l;
};

// ---- desk and chair: Poly Haven's "Wooden Table 02" and "School Chair 01" (CC0), vendored
const room = new THREE.Group();
scene.add(room);
function furniture(id, place) {
  return new Promise(done => new GLTFLoader().load(`/static/vendor/models/${id}/${id}_1k.gltf`, g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.scene.scale.setScalar(100);                    // metres to cm
    place(g.scene); room.add(g.scene); g.scene.updateWorldMatrix(true, true); done(g.scene);
  }, undefined, e => console.error('setup figure: could not load ' + id, e)));
}
const tableReady = furniture('wooden_table_02', m => {   // 1 m long (the model is 113 cm), 71 cm deep
  m.updateWorldMatrix(true, true);
  m.scale.x *= 100 / new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).x;
  m.position.set(0, 0, 46);
});
const CHAIR_Z = -14;
const chairReady = furniture('SchoolChair_01', m => {
  m.position.set(0, 0, CHAIR_Z);
  m.traverse(o => {                                 // neutral grey, so blue only ever means the receptive field
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.map = null; o.material.color.set(0x5c5e63); o.material.needsUpdate = true;
  });
});

// ---- the participant: a real human model, posed seated by aiming bones at world directions
const person = new THREE.Group();
scene.add(person);
function aim(bone, child, dir) {
  bone.updateWorldMatrix(true, true);
  const a = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
  const b = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
  const now = b.sub(a).normalize(), want = new THREE.Vector3(...dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(now, want);
  const world = new THREE.Quaternion(); bone.getWorldQuaternion(world);
  const parent = new THREE.Quaternion(); bone.parent.getWorldQuaternion(parent);
  bone.quaternion.copy(parent.invert().multiply(q.multiply(world)));
  bone.updateWorldMatrix(false, true);
}
new GLTFLoader().load('/static/vendor/Xbot.glb', gltf => {
  const model = gltf.scene;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    o.material = mat.skin;                            // one plain matte finish
  });
  const bone = n => model.getObjectByName('mixamorig' + n);   // the loader drops the ':'
  model.scale.setScalar(100);                         // metres to cm (about 168 cm tall); already faces +z
  person.add(model);
  model.updateWorldMatrix(true, true);
  const pose = [
    ['Spine', 'Spine1', [0, 1, .02]], ['Spine1', 'Spine2', [0, 1, .03]], ['Spine2', 'Neck', [0, 1, .05]],
    ['Neck', 'Head', [0, 1, .12]], ['Head', 'HeadTop_End', [0, 1, 0]],
  ];
  for (const s of ['Left', 'Right']) pose.push(
    [s + 'UpLeg', s + 'Leg', [0, -.1, 1]], [s + 'Leg', s + 'Foot', [0, -1, .05]], [s + 'Foot', s + 'ToeBase', [0, -.25, 1]],
    [s + 'Arm', s + 'ForeArm', [s === 'Left' ? .1 : -.1, -1, .3]], [s + 'ForeArm', s + 'Hand', [s === 'Left' ? -.2 : .2, .12, 1]],
    [s + 'Hand', s + 'HandMiddle1', [0, -.1, 1]]);
  for (const [a, b, d] of pose) aim(bone(a), bone(b), d);
  // sit: hips on the seat, head centred on the line between the boards
  model.updateWorldMatrix(true, true);
  const hips = new THREE.Vector3().setFromMatrixPosition(bone('Hips').matrixWorld);
  const headP = new THREE.Vector3().setFromMatrixPosition(bone('Head').matrixWorld);
  const top = new THREE.Vector3().setFromMatrixPosition(bone('HeadTop_End').matrixWorld);
  person.position.set(-headP.x, 57 - hips.y, HEAD_Z - headP.z);   // first guess; seatOnChair() refines it
  person.updateWorldMatrix(true, true);
  const eye = new THREE.Vector3().setFromMatrixPosition(bone('LeftEye').matrixWorld)
    .add(new THREE.Vector3().setFromMatrixPosition(bone('RightEye').matrixWorld)).multiplyScalar(.5);
  EYE = eye.y;
  // a nose, riding on the head bone so it sits on the face
  const headBone = bone('Head'), g = new THREE.Group(), front = eye.z + 3.6;
  const nose = mesh(new THREE.ConeGeometry(1.2, 3.4, 16), mat.skin, 0, eye.y - 3.2, front - .6);
  nose.rotation.x = Math.PI / 2.4; g.add(nose);       // points forward, so the face direction reads
  person.updateWorldMatrix(true, true);
  headBone.updateWorldMatrix(true, false);
  const inv = headBone.matrixWorld.clone().invert();
  g.children.forEach(c => c.applyMatrix4(inv));
  headBone.add(g);
  // remember each bone's resting orientation relative to its parent, so idle motion layers on top
  head.bone = headBone;
  head.chain = ['Spine1', 'Spine2', 'Neck', 'Head'].map(n => {
    const b = bone(n);
    const restWorld = b.getWorldQuaternion(new THREE.Quaternion());
    const parentRest = b.parent.getWorldQuaternion(new THREE.Quaternion());
    return {name: n, bone: b, restLocal: parentRest.invert().multiply(restWorld)};
  });
  builtFor = 0;                                        // rebuild the rig at the real eye height
  Promise.all([chairReady, tableReady]).then(([chair, table]) => {
    seatOnChair(model, chair);                         // sit first: it moves the whole body
    restHandsOn(table);
  });
}, undefined, e => console.error('setup figure: could not load the person model', e));

// Seat the person properly: find the chair's seat surface, slide the chair under the
// pelvis (the pose decides where the pelvis is), then drop the body until it rests on it.
function seatOnChair(model, chair) {
  model.updateWorldMatrix(true, true);
  model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });   // measure the seated pose, not the bind pose
  const hips = new THREE.Vector3().setFromMatrixPosition(model.getObjectByName('mixamorigHips').matrixWorld);

  // The seat is the height most downward rays share: it is one broad flat surface, while
  // the backrest and the frame only ever show a ray their narrow top edge.
  const b = new THREE.Box3().setFromObject(chair), down = new THREE.Vector3(0, -1, 0);
  const ray = new THREE.Raycaster(new THREE.Vector3(), down);
  const levels = new Map();
  for (let x = b.min.x + 1; x <= b.max.x - 1; x += 1.5)
    for (let z = b.min.z + 1; z <= b.max.z - 1; z += 1.5) {
      ray.set(new THREE.Vector3(x, b.max.y + 10, z), down);
      const h = ray.intersectObject(chair, true)[0];
      if (!h || h.point.y < 20) continue;                   // skip the floor and the legs
      const k = Math.round(h.point.y / 2);
      const e = levels.get(k) || {n: 0, x: 0, y: 0, z: 0};
      e.n++; e.x += x; e.y += h.point.y; e.z += z; levels.set(k, e);
    }
  let seat = null;
  for (const e of levels.values()) if (!seat || e.n > seat.n) seat = e;
  if (!seat) return;
  seat = {x: seat.x / seat.n, y: seat.y / seat.n, z: seat.z / seat.n};

  chair.position.x += hips.x - seat.x;                      // the seat goes under the pelvis
  chair.position.z += hips.z - seat.z;
  chair.updateWorldMatrix(true, true);

  // the pelvis bone sits about 9 cm above the surface a person's weight rests on
  const dy = seat.y + 9 - hips.y;
  person.position.y += dy; person.updateWorldMatrix(true, true);
  EYE += dy; builtFor = 0;                             // boards and field follow the eyes
  if (window.__ws) window.__ws.seat = {seat, hips, dy};
}

// The desk meets the hands, not the other way round: a seated person's hands rest on
// the top, and the arm pose is fixed, so set the desk height from where the hands are.
function restHandsOn(table) {
  person.updateWorldMatrix(true, true);
  const hand = new THREE.Vector3().setFromMatrixPosition(person.getObjectByName('mixamorigRightHand').matrixWorld);
  const b = new THREE.Box3().setFromObject(table);
  const want = hand.y - 2;                             // palm on the surface, wrist bone just above
  table.scale.y *= (want - b.min.y) / (b.max.y - b.min.y);   // legs stay on the floor
  table.updateWorldMatrix(true, true);
}

// ---- a board, modelled: PCB, metal chip cover, printed antenna, two USB-C ports, pin headers.
// Local frame: y = along the board (antenna end +y), face (components) toward -x.
const antennaTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#15171a'; x.fillRect(0, 0, 256, 96);
  x.strokeStyle = '#d4a53a'; x.lineWidth = 7; x.beginPath();
  let px = 20; x.moveTo(px, 80);
  for (let i = 0; i < 6; i++) { x.lineTo(px, 18); px += 18; x.lineTo(px, 18); x.lineTo(px, 80); px += 18; x.lineTo(px, 80); }
  x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function makeBoard() {
  const b = new THREE.Group(), L = 7, W = 2.8;
  b.add(box(.16, L, W, mat.pcb, 0, 0, 0, .05));
  const ant = mesh(new THREE.PlaneGeometry(W * .92, 1.1), new THREE.MeshStandardMaterial({map: antennaTex, roughness: .4, metalness: .3}));
  ant.position.set(-.09, L / 2 - .7, 0); ant.rotation.y = -Math.PI / 2; b.add(ant);
  b.add(box(.3, 1.8, 1.6, mat.shield, -.22, L / 2 - 2.35, 0, .05));        // metal chip cover under the antenna
  for (const z of [-.55, .55]) b.add(box(.33, .75, .9, mat.usb, -.25, -L / 2 + .3, z, .12));   // USB-C ports at the bottom
  for (const z of [-W / 2 + .2, W / 2 - .2]) for (let i = 0; i < 9; i++) b.add(box(.25, .22, .22, mat.pin, -.18, -L / 2 + 1.4 + i * .55, z, .03));
  const led = mesh(new THREE.SphereGeometry(.18, 12, 8), new THREE.MeshStandardMaterial({color: 0x2a2a2d, emissive: 0x2997ff, emissiveIntensity: 0}));
  led.position.set(-.2, -L / 2 + 1.1, 0); b.add(led);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: haloTex, color: 0x2997ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending}));
  halo.scale.set(16, 16, 1); b.add(halo);
  b.userData = {led, halo};
  b.scale.setScalar(BOARD_SCALE);
  return b;
}
const haloTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// ---- distance-dependent parts: stands, boards, zone, reference lines
const rig = new THREE.Group();
// Signal flow: particles with fading tails stream from the sender to the receiver along
// curved paths that fill the receptive field (its meridians at several radii and angles).
// The head: a gentle idle look-around and nod. Its speed drives how much the wave is disturbed.
const head = {bone: null, rest: null, parentInv: null, yaw: 0, pitch: 0, motion: 0, centre: new THREE.Vector3(),
              glow: null};
const FLOW_N = 9, TAIL = 90, flow = {pts: null, seeds: [], half: 55, r: 18};
let txX = 1;
const flowMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: {color: {value: new THREE.Color(0x2997ff)}, scale: {value: 1}},
  vertexShader: `attribute float alpha; attribute float size; uniform float scale; varying float vA;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha;
      gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      gl_FragColor = vec4(color, vA * smoothstep(0.5, 0.0, d)); }`,
});
scene.add(rig);
const boards = {rx: null, tx: null};
let builtFor = 0, builtSet = false, rxSide = localStorage.getItem('rxSide') || 'right';
const anchors = {};
// Callouts, Apple product-page style: a dot on the thing, a hairline out to a label at the side.
const svg = host.querySelector('svg.leaders');
const callouts = {};
function callout(key, title, sub, accent) {
  let c = callouts[key];
  if (!c) {
    const el = document.createElement('div'); el.className = 'callout' + (accent ? ' accent' : '');
    el.innerHTML = '<b></b><span></span>'; host.appendChild(el);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'), dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', 3); svg.append(path, dot);
    if (accent) { path.classList.add('accent'); dot.classList.add('accent'); }
    c = callouts[key] = {el, path, dot};
  }
  c.el.children[0].textContent = title; c.el.children[1].textContent = sub;
  return c;
}
function layoutCallouts(list, w, h) {                  // list: [{c, v: Vector3}] placed in two side columns
  const pts = list.map(o => { tmp.copy(o.v).project(camera); return {...o, x: (tmp.x + 1) / 2 * w, y: (1 - tmp.y) / 2 * h, hidden: tmp.z > 1}; });
  for (const side of ['left', 'right']) {
    const col = pts.filter(p => (p.x < w / 2) === (side === 'left')).sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const p of col) {
      const ly = Math.max(p.y, prev + 46), lx = side === 'left' ? 18 : w - 18;
      prev = ly;
      p.c.el.style.transform = `translate(${side === 'left' ? lx : lx}px, ${ly}px) translate(${side === 'left' ? '0' : '-100%'}, -50%)`;
      p.c.el.style.textAlign = side;
      const ex = side === 'left' ? lx + p.c.el.offsetWidth + 8 : lx - p.c.el.offsetWidth - 8;
      p.c.path.setAttribute('d', `M${p.x},${p.y} L${(ex + p.x) / 2},${ly} L${ex},${ly}`);
      p.c.dot.setAttribute('cx', p.x); p.c.dot.setAttribute('cy', p.y);
    }
  }
  for (const p of pts) { const on = !p.hidden; p.c.el.style.opacity = on ? 1 : 0; p.c.path.style.opacity = p.c.dot.style.opacity = on ? 1 : 0; }
}
function hideCallouts(keys) { for (const k of keys) if (callouts[k]) { const c = callouts[k]; c.el.style.opacity = 0; c.path.style.opacity = c.dot.style.opacity = 0; } }
function buildRig(D) {
  rig.clear();
  const half = D / 2, r = Math.sqrt(LAMBDA * D) / 2;
  const rxX = rxSide === 'right' ? -half : half;       // the participant's right is -x
  for (const role of ['rx', 'tx']) {
    const x = role === 'rx' ? rxX : -rxX;
    const px = x + Math.sign(x) * .9, top = EYE - 10.4;             // the stand ends in a clip behind the board
    rig.add(rod([px, 0, HEAD_Z], [px, top, HEAD_Z], .45, mat.metal));
    rig.add(box(1.2, 2.2, 2.2, mat.pin, px, top + .6, HEAD_Z, .3));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + .5;
      rig.add(rod([px, 30, HEAD_Z], [px + Math.cos(a) * 24, 0, HEAD_Z + Math.sin(a) * 24], .32, mat.metal));
    }
    const b = makeBoard();
    b.position.set(x, EYE - (7 / 2 - .7) * BOARD_SCALE, HEAD_Z);   // antenna level with the eyes
    if (x < 0) b.rotation.y = Math.PI;                 // chip side (local -x) turned toward the head
    b.userData.role = role;
    boards[role] = b; rig.add(b);
    anchors[role] = new THREE.Vector3(x, EYE - 4, HEAD_Z);
  }
  const ell = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), bubbleMat);
  ell.scale.set(half, r, r); ell.position.set(0, EYE, HEAD_Z); ell.renderOrder = 3;
  rig.add(ell);
  rig.add(line([[-half, EYE, HEAD_Z], [half, EYE, HEAD_Z]], mat.sight));                  // signal path, antenna to antenna
  txX = -rxX; bubbleMat.uniforms.dir.value = Math.sign(txX);
  Object.assign(flow, {half, r, seeds: Array.from({length: FLOW_N}, (_, i) => ({
    theta: i * 2.39996,                              // golden angle: paths spread evenly around the axis
    rho: [.2, .55, .8, .35, .7, .15, .5, .85, .4][i],  // a few near the head, a few near the rim
    scatter: i === 0 || i === 5,                     // the two closest to the head get knocked out of the field
    offset: i / FLOW_N, speed: .8 + .15 * ((i * .7548) % 1),
    size: .6 + .7 * ((i * .5698) % 1), glow: .45 + .55 * ((i * .8312) % 1), wob: (i * 1.7) % 6.283}))});
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLOW_N * TAIL * 3), 3));
  g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(FLOW_N * TAIL), 1));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(FLOW_N * TAIL), 1));
  flow.pts = new THREE.Points(g, flowMat); flow.pts.renderOrder = 4; flow.pts.frustumCulled = false;
  rig.add(flow.pts);
  // the field's height, in the field's own blue: an arc hugging its surface, a dot at each end
  const zw = half * .45, rz = r * Math.sqrt(1 - (zw / half) ** 2);
  const arc = [];
  for (let i = 0; i <= 48; i++) { const a = Math.PI * i / 48; arc.push([zw, EYE + rz * Math.cos(a), HEAD_Z + rz * Math.sin(a)]); }
  rig.add(line(arc, mat.field));
  for (const y of [EYE - rz, EYE + rz]) rig.add(mesh(new THREE.SphereGeometry(.9, 16, 12), mat.fieldDot, zw, y, HEAD_Z));
  anchors.field = new THREE.Vector3(zw, EYE + rz, HEAD_Z);
  anchors.head = new THREE.Vector3(0, EYE + 6, HEAD_Z + 4);
  callout('rx', 'Receiver', 'USB to this Mac');
  callout('tx', 'Sender', 'on a charger');
  callout('field', 'Receptive field', Math.round(2 * r) + ' cm across · best region for movement', true);
  callout('head', 'Head', 'centred, eyes level with the antennas');
  const fd = document.getElementById('figDist');
  fd.innerHTML = window.wsDistanceSet
    ? 'Receiver–sender distance <b>' + Math.round(D) + ' cm</b> · measured'
    : 'Receiver–sender distance <b>not set</b> · drawn at the recommended ' + Math.round(D) + ' cm · <u>enter yours</u>';
  builtFor = D; builtSet = !!window.wsDistanceSet;
}
document.querySelectorAll('#rxSide button').forEach(b => {
  b.classList.toggle('on', b.dataset.side === rxSide);
  b.setAttribute('aria-pressed', b.dataset.side === rxSide);
  b.onclick = () => {
    rxSide = b.dataset.side; localStorage.setItem('rxSide', rxSide); builtFor = 0;
    document.querySelectorAll('#rxSide button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
  };
});

// ---- click a board: fly in to show its orientation
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let fly = null, zoomed = null, downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;   // a drag, not a click
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects([boards.rx, boards.tx].filter(Boolean), true)[0];
  if (!hit) return;
  let b = hit.object; while (b && !b.userData.role) b = b.parent;
  zoomTo(b);
});
function flyTo(pos, target) {
  fly = {t0: performance.now(), from: [camera.position.clone(), controls.target.clone()], to: [pos, target]};
  controls.autoRotate = false;
}
function zoomTo(b) {
  zoomed = b;
  const c = b.getWorldPosition(new THREE.Vector3()), toward = Math.sign(-c.x) || 1;   // stand in front of its face
  flyTo(new THREE.Vector3(c.x + toward * 26, c.y + 4, c.z - 14), c.clone());
  document.getElementById('zoomBack').hidden = false;
  host.classList.add('zoomed');
}
document.getElementById('figDist').onclick = () => window.openPanel && window.openPanel('setupPanel');
document.getElementById('zoomBack').onclick = () => {
  zoomed = null; flyTo(HOME.pos.clone(), HOME.target.clone());
  document.getElementById('zoomBack').hidden = true; host.classList.remove('zoomed');
};

// ---- theme: reference lines in ink; wood follows light / dark
function applyTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000';
  mat.sight.color.set(ink);
  // Apple's single Action Blue: #0066cc on light, #2997ff on dark (awesome-design-md, Apple DESIGN.md)
  const field = getComputedStyle(document.documentElement).getPropertyValue('--field').trim() || '#2997ff';
  for (const c of [bubbleMat.uniforms.field.value, flowMat.uniforms.color.value, mat.field.color, mat.fieldDot.color]) c.set(field);
  flowMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;   // glow on dark, ink-like on light
  flowMat.needsUpdate = true;
  bubbleMat.uniforms.strength.value = dark ? 1 : .55;             // light pages need a lighter touch
  head.glowScale = dark ? 1 : .35;
  pool.material.color.set(dark ? 0xffffff : 0x000000);
  hemi.intensity = dark ? .35 : .6;
}
new MutationObserver(applyTheme).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
applyTheme();

// ---- render only while the overlay is on screen
const tmp = new THREE.Vector3(), ease = t => 1 - Math.pow(1 - t, 3);
function frame(now) {
  const D = window.wsDistance || 110;
  if (D !== builtFor || builtSet !== !!window.wsDistanceSet) buildRig(D);
  const w = host.clientWidth, h = host.clientHeight;
  if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  if (fly) {
    const k = Math.min(1, (now - fly.t0) / 700), e = ease(k);
    camera.position.lerpVectors(fly.from[0], fly.to[0], e);
    controls.target.lerpVectors(fly.from[1], fly.to[1], e);
    if (k === 1) fly = null;
  }
  // live link: the receiver lights when it is plugged in, the sender when packets arrive
  const link = window.wsLink || {}, pulse = reduced ? 1 : .75 + .25 * Math.sin(now / 600);
  for (const role of ['rx', 'tx']) {
    const b = boards[role]; if (!b) continue;
    const on = !!link[role];
    b.userData.led.material.emissiveIntensity = on ? 3 * pulse : 0;
    b.userData.halo.material.opacity = on ? .55 * pulse : 0;
  }
  // the field at work: a wavefront and pulses carry the signal from sender to receiver
  if (head.bone) {
    if (!reduced) {
      // Alive: breathing lifts the chest (~15 breaths a minute), the upper body sways a little,
      // and the head drifts and glances. Several slow, unrelated sines so it never looks looped.
      const breath = Math.sin(now / 4000 * 2 * Math.PI);
      const yaw = .14 * Math.sin(now / 3700) + .05 * Math.sin(now / 1500 + 2) + .02 * Math.sin(now / 610);
      const pitch = .05 * Math.sin(now / 2900 + 1) + .02 * Math.sin(now / 1170) - .01 * breath;
      const motion = {
        Spine1: [.006 * breath, .006 * Math.sin(now / 6100), .006 * Math.sin(now / 5300 + 1)],
        Spine2: [.012 * breath, .01 * Math.sin(now / 7300 + .5), .005 * Math.sin(now / 4700)],
        Neck: [.3 * pitch, .3 * yaw, .004 * Math.sin(now / 3900)],
        Head: [.7 * pitch, .7 * yaw, .02 * Math.sin(now / 5100 + 2)],
      };
      const q = new THREE.Quaternion(), parentNow = new THREE.Quaternion();
      for (const c of head.chain) {                   // top-down: each bone inherits its parent's motion
        c.bone.parent.getWorldQuaternion(parentNow);
        const [px, py, pz] = motion[c.name];
        q.setFromEuler(new THREE.Euler(-px, py, pz, 'YXZ'));   // world axes: nod, turn, tilt
        const world = parentNow.clone().multiply(c.restLocal).premultiply(q);
        c.bone.quaternion.copy(parentNow.clone().invert().multiply(world));
        c.bone.updateWorldMatrix(false, true);
      }
      const speed = (Math.abs(yaw - head.yaw) + Math.abs(pitch - head.pitch)) / Math.max(1, now - (head.at || now)) * 1000;
      head.motion += (Math.min(1, speed / .5) - head.motion) * .08;       // 0 still … 1 turning briskly
      Object.assign(head, {yaw, pitch, at: now});
    }
    head.bone.getWorldPosition(head.centre).y += 8;
    if (!head.glow) {
      head.glow = new THREE.Sprite(new THREE.SpriteMaterial({map: haloTex, transparent: true, depthWrite: false, opacity: 0}));
      head.glow.scale.set(46, 46, 1); head.glow.renderOrder = 2; scene.add(head.glow);
    }
    head.glow.material.color.copy(flowMat.uniforms.color.value);
    head.glow.material.blending = flowMat.blending;
    head.glow.position.copy(head.centre);
    head.glow.material.opacity = (.08 + .32 * head.motion) * (head.glowScale ?? 1);   // the head lights up as it disturbs the wave
  }
  if (flow.pts) {
    const T = 3400, t = reduced ? 0.37 : now / T;
    const disturb = .15 + 1.6 * head.motion;
    bubbleMat.uniforms.phase.value = -((t * 1.1) % (2 * Math.PI / 5)) * (reduced ? 0 : 1);
    flowMat.uniforms.scale.value = h * renderer.getPixelRatio();
    const P = flow.pts.geometry.attributes.position.array, A = flow.pts.geometry.attributes.alpha.array,
          S = flow.pts.geometry.attributes.size.array, dir = Math.sign(txX);
    flow.seeds.forEach((sd, i) => {
      const lin = (t * sd.speed + sd.offset) % 1;
      for (let j = 0; j < TAIL; j++) {
        const gl = lin - j * .0045, o = i * TAIL + j;      // a long trail: the path it has taken
        if (gl < 0) { A[o] = 0; continue; }
        const g = gl * gl * (3 - 2 * gl);                // ease out of the sender, settle into the receiver
        const u = 1 - 2 * g;                            // +1 at the sender, -1 at the receiver
        const x = dir * flow.half * u;
        const past = Math.max(0, -u);                    // 0 before the head, rising to 1 at the receiver
        const wander = 1 + .08 * Math.sin(gl * 9 + sd.wob + t * 2);
        let k = Math.sqrt(Math.max(0, 1 - u * u)) * sd.rho * flow.r * wander;
        k = Math.max(k, 13 * Math.exp(-(((x - head.centre.x) / 16) ** 2)) * Math.sqrt(1 - u * u));   // part around the head
        let th = sd.theta + .15 * Math.sin(gl * 6 + sd.wob);
        let alpha = 1;
        if (sd.scatter) {                                // scattered by the head, out of the field
          k += past * past * flow.r * (1.1 + disturb);
          th += past * head.yaw * 3;
          alpha = (1 - past) ** 1.5;
        } else {                                         // redirected: calm before the head, disturbed after it
          k *= 1 + past * disturb * .22 * Math.sin(gl * 14 + sd.wob + t * 3) * (1 - sd.rho * .5);
          th += past * (disturb * .35 * Math.sin(gl * 10 + sd.wob + t) + head.yaw * 1.2);
        }
        P[o * 3] = x;
        P[o * 3 + 1] = EYE + (head.centre.y - 8 - EYE) * Math.exp(-((x / 20) ** 2)) + k * Math.cos(th);
        P[o * 3 + 2] = HEAD_Z + k * Math.sin(th);
        A[o] = alpha * .35 * Math.sin(Math.PI * gl) ** .7 * (1 - j / TAIL) ** 1.2;
        S[o] = (j === 0 ? 7 : 3.2) * (1 - j / (TAIL * 1.8));   // a bright head, a thin fading line behind
      }
    });
    flow.pts.geometry.attributes.position.needsUpdate = flow.pts.geometry.attributes.alpha.needsUpdate =
      flow.pts.geometry.attributes.size.needsUpdate = true;
  }
  controls.update();
  renderer.render(scene, camera);
  const roomKeys = ['rx', 'tx', 'field', 'head'], parts = ['za', 'zc', 'zu', 'zf'];
  if (zoomed) {
    hideCallouts(roomKeys);
    const at = y => zoomed.localToWorld(new THREE.Vector3(-.3, y, 0));   // on the chip side
    callout('za', 'Antenna', 'wavy gold line · this end up');
    callout('zc', 'Chip', 'under the metal cover');
    callout('zu', 'USB-C ports', 'this end down');
    callout('zf', 'Chip side', 'faces the participant');
    layoutCallouts([{c: callouts.za, v: at(2.8)}, {c: callouts.zc, v: at(1.15)}, {c: callouts.zu, v: at(-3.3)}, {c: callouts.zf, v: at(-1.2)}], w, h);
  } else if (anchors.rx) {
    hideCallouts(parts);
    layoutCallouts(roomKeys.map(k => ({c: callouts[k], v: anchors[k]})), w, h);
  }
}
function sync() { renderer.setAnimationLoop(overlay.hidden || document.hidden ? null : frame); }
new MutationObserver(sync).observe(overlay, {attributes: true, attributeFilter: ['hidden']});
document.addEventListener('visibilitychange', sync);
sync();
if (location.search.includes('debug')) window.__ws = {camera, controls, person, THREE, zoomTo, boards};
