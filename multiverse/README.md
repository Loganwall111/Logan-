# The Multiverse

A Three.js open-world prototype: a cinematic narrated intro, a 3D holographic main menu,
and a valley world with planar-reflection water, underwater Snell's-window mirror, waterfalls,
rain, rainbows, god rays, aurora, moon, planets, animals, floating islands and a sky-whale.

## Run

    npm install
    npm run dev        # http://localhost:5173 (bound to 0.0.0.0)
    npm run build      # production bundle in dist/

## Controls

- Any click or key starts the intro. Enter, Space or click skips it.
- WASD move, Shift run, mouse look (click the world to capture the mouse).
- Space jump, or swim up. C dive. Esc pauses. R toggles rain.

## Layout

- `src/terrain.js` heightfield: plateau, giant cliff, valley, lakes and sea
- `src/water.js` water shader and planar reflector (mirror from above and below)
- `src/sky.js` sky dome, aurora, stars, moon, planets, day/night cycle
- `src/weather.js` rain, rainbow, god rays
- `src/foliage.js` instanced trees, grass, flowers, wind sway
- `src/features.js` waterfalls, islands, sky-whale, wormhole, watching eye, Lodamis
- `src/creatures.js` deer, birds, fish
- `src/intro.js` four-scene cinematic synced to narration clips
- `src/menu.js` 3D menu backdrop; `src/main.js` state flow, UI, controls
- `public/audio/` generated narration (narration-1..4.mp3)

## Not yet built

Backrooms-style endless rooms, fractal and black-hole realms, TV and movie characters,
ghost/heaven mode, giant ants and water drops, and the "lore realms" the design describes.

## Realms (round two)

Walk to the **Lodamis gate** and press **E**, or choose **REALMS** from the main menu:

- **Infinity Backrooms**: endless hashed yellow-wallpaper maze, chunked rebuild, flickering lights.
- **Infinity Fractal Maze**: raymarched Menger sponge inside a box.
- **Black Hole**: accretion disk shader, photon ring, halo, and a sinking grid well.
- **The Floating White Void**: white fog with 400 drifting shapes.
- **Heaven**: golden clouds, light beams, and a gate.

Pause (Esc) and choose **RETURN TO THE VALLEY** to leave a realm.

## Ghosts

- **G** toggles ghost mode. Ghosts fly and pass through walls, and their view is tinted.
- **H** ascends a ghost to Heaven. Press H again in Heaven to return to the valley.

## Valley extras

- **Midnight TV**: west of Lodamis, figures step out of a static screen between 23:30 and 00:30.
- **Giant ants**: 2–3 patrol the valley floor.
- **Giant water drops**: two glassy drops in the landscape.
- **Floating city**: visible on the horizon at (-200, 230, 300).

Status: built and bundled. Realm shaders and the TV shader have NOT been compiled in a real browser in this environment. Check them in-browser.
