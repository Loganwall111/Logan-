import * as THREE from 'three';
import { heightAt, WATER_Y, WORLD_HALF, LODAMIS } from './terrain.js';

const WALK = 6.5;
const RUN = 11;
const SWIM = 4.2;
const SWIM_FAST = 6.5;
const GRAVITY = 28;
const JUMP = 9.5;
const STEP = 1.1; // highest ledge the player can climb in one step
const EYE = 1.65;
const EYE_SWIM = 0.8;

export class Player {
  constructor(spawn) {
    this.pos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.atan2(-(LODAMIS.x - spawn.x), -(LODAMIS.z - spawn.z)); // look at the Lodamis machine
    this.pitch = -0.12;
    this.onGround = false;
    this.swimming = false;
    this.keys = new Set();
    this.name = 'Simalisis';
  }

  get eye() {
    const off = this.swimming ? EYE_SWIM : EYE;
    return new THREE.Vector3(this.pos.x, this.pos.y + off, this.pos.z);
  }

  look(dx, dy, sensitivity = 0.0022) {
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * sensitivity));
  }

  applyCamera(camera) {
    camera.position.copy(this.eye);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  update(dt) {
    const k = this.keys;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) wish.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) wish.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) wish.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const up = k.has('Space');
    const down = k.has('KeyC') || k.has('ControlLeft') || k.has('ControlRight');

    const ground = heightAt(this.pos.x, this.pos.z);
    const feetBelowSurface = this.pos.y < WATER_Y - 0.4;
    this.swimming = feetBelowSurface || (ground < WATER_Y - 0.6 && this.pos.y < WATER_Y);

    if (this.swimming) {
      const speed = sprint ? SWIM_FAST : SWIM;
      const targetH = wish.clone().multiplyScalar(speed);
      this.vel.x += (targetH.x - this.vel.x) * Math.min(1, dt * 4);
      this.vel.z += (targetH.z - this.vel.z) * Math.min(1, dt * 4);
      // Buoyancy: float with the eyes just under the surface, rise or dive on command.
      const floatFeet = WATER_Y - 1.7;
      this.vel.y += (floatFeet - this.pos.y) * 1.6 * dt;
      if (up) this.vel.y += 16 * dt;
      if (down) this.vel.y -= 16 * dt;
      this.vel.y *= Math.max(0, 1 - 2.2 * dt);
      this.vel.x *= Math.max(0, 1 - 0.6 * dt);
      this.vel.z *= Math.max(0, 1 - 0.6 * dt);
      this.onGround = false;
    } else {
      const speed = sprint ? RUN : WALK;
      const accel = this.onGround ? 14 : 3;
      this.vel.x += (wish.x * speed - this.vel.x) * Math.min(1, dt * accel);
      this.vel.z += (wish.z * speed - this.vel.z) * Math.min(1, dt * accel);
      this.vel.y -= GRAVITY * dt;
      if (this.onGround && up) {
        this.vel.y = JUMP;
        this.onGround = false;
      }
    }

    // Horizontal movement with a step limit so cliffs cannot be climbed.
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const gNew = heightAt(nx, nz);
    if (this.swimming || gNew <= this.pos.y + STEP) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      this.vel.x *= -0.2;
      this.vel.z *= -0.2;
    }
    this.pos.x = Math.max(-WORLD_HALF * 0.97, Math.min(WORLD_HALF * 0.97, this.pos.x));
    this.pos.z = Math.max(-WORLD_HALF * 0.97, Math.min(WORLD_HALF * 0.97, this.pos.z));

    this.pos.y += this.vel.y * dt;
    const g = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= g + 0.05) {
      this.pos.y = g + 0.05;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = !this.swimming;
    }
    if (this.swimming && this.pos.y > WATER_Y + 1.4) {
      this.pos.y = WATER_Y + 1.4;
      this.vel.y = Math.min(0, this.vel.y);
    }
  }
}
