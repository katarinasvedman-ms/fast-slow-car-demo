import { copyFile, cp, mkdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const destination = new URL('public/vendor/', root);
const dependency = new URL('node_modules/three/', root);
const { version, license } = JSON.parse(await readFile(new URL('package.json', dependency), 'utf8'));
if (version !== '0.186.1' || license !== 'MIT') throw new Error('Unexpected Three.js version or licence.');
await mkdir(destination, { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) {
  await copyFile(new URL(`build/${file}`, dependency), new URL(file, destination));
}
await copyFile(new URL('LICENSE', dependency), new URL('THREE-LICENSE.txt', destination));
await cp(new URL('dist/client/cockpit/', root), new URL('public/cockpit-app/', root), { recursive: true });
