three.js r186 (MIT, https://github.com/mrdoob/three.js) – eingebunden, weil der Build ohne npm-Paket auskommen soll.
Typen aus three-ts-types (MIT). Import im Code als `three`, Alias in `scripts/build.mjs` und `tsconfig.json`.

WebGPU (nur der WebGPU-Test im Admin-Bereich): `three.webgpu.js` und `three.tsl.js` aus demselben Release – sie
importieren `three.core.js`, teilen sich also Geometrien, Mathe und Texturen mit dem WebGL-Teil. Import als
`three/webgpu` und `three/tsl` (Auflösung in `scripts/build.mjs`). In `addons/` zwei Beispielmodule aus
`examples/jsm` (SkyMesh, BloomNode) mit eigenen kleinen Typdateien.
