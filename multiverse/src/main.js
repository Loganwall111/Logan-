import './style.css';
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Intro } from './intro.js';
import { MenuScene } from './menu.js';
import { AudioManager } from './audio.js';
import { SPAWN, LODAMIS, heightAt, WATER_Y, CLIFF_X, PLATEAU_Y } from './terrain.js';

// ---------- Narration (generated voice clips live in public/audio) ----------
const NARRATION = [
  {
    src: 'audio/narration-1.mp3',
    text: 'Before life was ever built, there was only dust. Silent. Endless. Waiting in the dark. Then, across the entire multiverse, came a burst of energy so vast it tore open the fabric of nothing, and everything began to shine.',
  },
  {
    src: 'audio/narration-2.mp3',
    text: 'From that single moment, galaxies were born, billions of them, spinning like the eyes of a sleeping god. Inside one grain of cosmic dust, a particle began to stir. You are that particle. Before life. Before form. Before a name.',
  },
  {
    src: 'audio/narration-3.mp3',
    text: 'Earth is already dead. Its oceans have dried, and a burning meteorite is falling through the last light of its sky. Beneath the ruins waits Lodamis, the last machine ever built, keeping a handful of lives alive, just long enough to choose where they go next.',
  },
  {
    src: 'audio/narration-4.mp3',
    text: 'Step inside. Lodamis will plug you into a reality of your own making. Floating voids. Endless rooms. Black holes that sing. Here, you are dust no longer. Here, you are Simalisis, the god who started everything. The multiverse is waiting.',
  },
];

// ---------- Settings ----------
const SETTINGS_KEY = 'multiverse-settings-v1';
const defaults = {
  master: 0.8,
  music: 0.5,
  voice: 1,
  sensitivity: 1,
  quality: (navigator.hardwareConcurrency || 4) >= 6 && !/Mobi|Android/i.test(navigator.userAgent) ? 'high' : 'low',
  subtitles: true,
};
let settings = { ...defaults };
try {
  settings = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
} catch (_) { /* ignore corrupt storage */ }
const saveSettings = () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* private mode */ }
};

// ---------- DOM helpers ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const layers = {
  gate: $('#gate'), intro: $('#intro'), menu: $('#menu'), settings: $('#settings'), pause: $('#pause'),
  hud: $('#hud'), loading: $('#loading'), goodbye: $('#goodbye'), namePanel: $('#name-panel'), introTitle: $('#intro-title'),
};
const fade = $('#fade');
const subtitleEl = $('#subtitle');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#stage').appendChild(renderer.domElement);

function pixelRatio() {
  return Math.min(window.devicePixelRatio || 1, settings.quality === 'high' ? 1.75 : 1);
}
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = `${w}px`;
  renderer.domElement.style.height = `${h}px`;
  menu.resize(w, h);
  intro?.resize();
  if (world) world.resize(w, h, pixelRatio());
}

// ---------- Audio, menu and state ----------
const audio = new AudioManager();
audio.setSettings({ master: settings.master, music: settings.music, voice: settings.voice });
const menu = new MenuScene();
let intro = null;
let world = null;
let player = null;
let worldQuality = null;
const state = { mode: 'gate', paused: false, underwater: false, lastHud: 0, introStartedAt: 0, pauseReturn: 'game', name: 'Simalisis' };

function show(...names) {
  for (const k of Object.keys(layers)) layers[k].classList.toggle('hidden', !names.includes(k));
}
function setSubtitles(text, p) {
  if (!settings.subtitles) { subtitleEl.textContent = ''; return; }
  const n = Math.floor(text.length * Math.min(1, p * 1.15));
  const next = text.slice(0, n);
  if (subtitleEl.textContent !== next) subtitleEl.textContent = next;
}
function flashScreen(kind = 'black') {
  fade.classList.toggle('flash', kind === 'white');
  fade.classList.add('on');
  clearTimeout(flashScreen.t);
  flashScreen.t = setTimeout(() => fade.classList.remove('on'), kind === 'white' ? 380 : 420);
}

// ---------- Gate: any click or key starts the experience ----------
function onGate(e) {
  if (state.mode !== 'gate') return;
  if (e.type === 'keydown' && e.repeat) return;
  startExperience();
}
window.addEventListener('pointerdown', onGate);
window.addEventListener('keydown', onGate);

function startExperience() {
  state.mode = 'intro';
  state.introStartedAt = performance.now();
  audio.init();
  audio.startMusic();
  show('intro');
  intro = new Intro(renderer, {
    clips: NARRATION,
    audio,
    onDone: finishIntro,
    ui: {
      flash: (kind) => flashScreen(kind),
      setSubtitle: setSubtitles,
    },
  });
  intro.start();
  resize();
}

function skipIntro() {
  if (state.mode !== 'intro' || !intro) return;
  if (performance.now() - state.introStartedAt < 900) return; // ignore the click that started it
  intro.skip();
}
window.addEventListener('pointerdown', skipIntro);
window.addEventListener('keydown', (e) => {
  if (['Enter', 'Space', 'Escape'].includes(e.code) || e.key === ' ') skipIntro();
});

function finishIntro() {
  // Title card, then the menu.
  state.mode = 'title';
  show('intro');
  layers.introTitle.classList.remove('hidden');
  subtitleEl.textContent = '';
  setTimeout(showMenu, 3800);
}

function showMenu() {
  if (state.mode === 'menu' || state.mode === 'game') return;
  state.mode = 'menu';
  show('menu');
  audio.setRain(0);
  focusMenu();
}

function focusMenu() {
  const first = $('#menu [data-action="play"]');
  first?.focus({ preventScroll: true });
}

// ---------- Menu buttons ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  switch (action) {
    case 'play':
      layers.namePanel.classList.remove('hidden');
      setTimeout(() => $('#name-input').focus(), 10);
      break;
    case 'name-back':
      layers.namePanel.classList.add('hidden');
      focusMenu();
      break;
    case 'name-begin':
      state.name = ($('#name-input').value || 'Simalisis').trim().slice(0, 18) || 'Simalisis';
      enterGame(state.name);
      break;
    case 'settings':
      state.settingsReturn = 'menu';
      layers.settings.classList.remove('hidden');
      break;
    case 'pause-settings':
      state.settingsReturn = 'pause';
      layers.pause.classList.add('hidden');
      layers.settings.classList.remove('hidden');
      break;
    case 'settings-back':
      layers.settings.classList.add('hidden');
      if (state.settingsReturn === 'pause') layers.pause.classList.remove('hidden');
      else focusMenu();
      break;
    case 'quit':
      show('goodbye');
      state.mode = 'quit';
      audio.setRain(0);
      try { window.close(); } catch (_) { /* browsers may refuse */ }
      break;
    case 'reopen':
      showMenu();
      break;
    case 'resume':
      resumeGame();
      break;
    case 'to-menu':
      document.exitPointerLock?.();
      state.paused = true;
      state.mode = 'menu';
      show('menu');
      focusMenu();
      break;
    default:
      break;
  }
});

// Keyboard navigation for the menu.
window.addEventListener('keydown', (e) => {
  if (state.mode !== 'menu') return;
  if (!layers.namePanel.classList.contains('hidden')) return;
  const items = $$('#menu .menu-btn');
  const i = items.indexOf(document.activeElement);
  if (e.code === 'ArrowDown') { items[(i + 1 + items.length) % items.length].focus(); e.preventDefault(); }
  if (e.code === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
});

// Settings controls.
$$('[data-setting]').forEach((el) => {
  const key = el.dataset.setting;
  if (el.type === 'checkbox') el.checked = !!settings[key];
  else el.value = settings[key];
  el.addEventListener('input', () => {
    if (el.type === 'checkbox') settings[key] = el.checked;
    else if (key === 'quality') settings[key] = el.value;
    else settings[key] = parseFloat(el.value);
    saveSettings();
    audio.setSettings({ master: settings.master, music: settings.music, voice: settings.voice });
    if (key === 'quality') {
      renderer.setPixelRatio(pixelRatio());
      if (state.mode === 'game' || state.paused) toast('Graphics quality applies when you next enter the world.');
    }
  });
});

function toast(msg) {
  const el = $('#hud-hint');
  el.textContent = msg;
  el.style.display = '';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

// ---------- Entering the world ----------
function enterGame(name) {
  state.name = name;
  show('loading');
  // Let the loading panel paint before the heavy world build.
  setTimeout(() => {
    if (!world || worldQuality !== settings.quality) {
      world?.composer?.dispose?.();
      world = new World(renderer, settings.quality);
      worldQuality = settings.quality;
      resize();
    }
    player = new Player({ x: SPAWN.x, y: heightAt(SPAWN.x, SPAWN.z), z: SPAWN.z });
    player.name = name;
    player.keys.clear();
    state.mode = 'game';
    state.paused = false;
    state.lastHud = 0;
    $('#hud-name').textContent = name.toUpperCase();
    show('hud');
    renderer.domElement.focus?.();
    requestLock();
    setTimeout(() => { $('#hud-hint').style.display = 'none'; }, 15000);
    $('#hud-hint').style.display = '';
  }, 60);
}

function requestLock() {
  try {
    const p = renderer.domElement.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* no pointer lock available: drag-to-look still works */ }
}

function pauseGame() {
  if (state.mode !== 'game' || state.paused) return;
  state.paused = true;
  player?.keys.clear();
  layers.pause.classList.remove('hidden');
}
function resumeGame() {
  if (state.mode !== 'game') return;
  layers.pause.classList.add('hidden');
  layers.settings.classList.add('hidden');
  state.paused = false;
  requestLock();
}

document.addEventListener('pointerlockchange', () => {
  if (state.mode !== 'game') return;
  if (document.pointerLockElement === renderer.domElement) {
    if (state.paused) resumeGame();
  } else if (!state.paused) {
    pauseGame();
  }
});

// Mouse look: pointer lock when available, drag-to-look otherwise.
let dragging = false;
renderer.domElement.addEventListener('pointerdown', () => {
  dragging = true;
  // Clicking the world re-captures the mouse after Esc.
  if (state.mode === 'game' && !state.paused && document.pointerLockElement !== renderer.domElement) requestLock();
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (state.mode === 'menu' || state.mode === 'title') {
    menu.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    return;
  }
  if (state.mode !== 'game' || state.paused || !player) return;
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked || dragging) player.look(e.movementX, e.movementY, 0.0022 * settings.sensitivity);
});

// Keyboard in-game.
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'ControlLeft', 'ControlRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (state.mode !== 'game') return;
  if (e.code === 'Escape') {
    if (state.paused) resumeGame();
    else pauseGame();
    return;
  }
  if (state.paused) return;
  if (GAME_KEYS.has(e.code)) {
    player.keys.add(e.code);
    e.preventDefault();
  }
  if (e.code === 'KeyR' && !e.repeat) {
    const on = world.weather.toggleRain();
    toast(on ? 'Rain is rolling in.' : 'The skies are clearing.');
  }
});
window.addEventListener('keyup', (e) => {
  player?.keys.delete(e.code);
});
window.addEventListener('blur', () => player?.keys.clear());

// ---------- HUD ----------
function locationName(p) {
  if (p.pos.y < WATER_Y - 0.4) return 'Drowned Glass Depths';
  if (Math.abs(p.pos.x - LODAMIS.x) < 60 && Math.abs(p.pos.z - LODAMIS.z) < 60) return 'The Lodamis Gate';
  if (Math.abs(p.pos.x - CLIFF_X) < 60) return 'Cliffs of the Great Fall';
  if (p.pos.x < CLIFF_X - 30 && p.pos.y > PLATEAU_Y - 20) return 'The Ember Plateau';
  if (p.pos.x > 300 && p.pos.z < -300) return 'Floating Isles';
  return 'Valley of the First Light';
}
function updateHud(now) {
  if (now - state.lastHud < 250) return;
  state.lastHud = now;
  const h = world.hour;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  $('#hud-time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('#hud-weather').textContent = world.weather.label;
  $('#hud-mode').textContent = player.swimming ? (player.pos.y < WATER_Y - 2 ? 'Diving' : 'Swimming') : 'Walking';
  $('#hud-loc').textContent = locationName(player);
  const under = world.underwater;
  $('#underwater-tint').classList.toggle('on', under);
  if (under !== state.underwater) {
    state.underwater = under;
    audio.setUnderwater(under);
  }
}

// ---------- Main loop ----------
window.addEventListener('resize', resize);
resize();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (state.mode === 'intro' && intro) {
      intro.update(dt);
    } else if (state.mode === 'title' || state.mode === 'menu') {
      menu.update(dt);
      renderer.render(menu.scene, menu.camera);
    } else if (state.mode === 'game' && world && player) {
      if (!state.paused) {
        player.update(dt);
        player.applyCamera(world.camera);
        world.update(dt, player.pos);
        audio.setRain(world.weather.rainAmt);
      } else {
        player.applyCamera(world.camera);
      }
      world.render();
      updateHud(now);
    }
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose a tiny debug handle for development.
window.multiverse = { state, get world() { return world; }, get player() { return player; }, audio };
