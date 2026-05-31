/**
 * game_rng.js — Seeded Pseudo-Random Number Generator
 * Extracted from script.js monolith (Issue #19 decompositon phase 1).
 *
 * Mulberry32 — fast 32-bit PRNG. Deterministic given the same seed sequence.
 * Usage: const rng = new GameRNG(); rng.seed(42); rng.d20(5);
 */
'use strict';

class GameRNG {
    constructor(seed) {
        this._seed = (typeof seed === 'number') ? (seed >>> 0) :
            (typeof crypto !== 'undefined' && crypto.getRandomValues)
                ? crypto.getRandomValues(new Uint32Array(1))[0]
                : (Date.now() ^ (Math.random() * 0x100000000 | 0));
    }

    /** Seed the RNG. Call once at game start or on load. */
    seed(s) { this._seed = s >>> 0; }

    /** Mulberry32 — returns [0, 1). */
    next() {
        let t = this._seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Returns integer in [min, max] inclusive. */
    roll(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /** d20 + modifier roll. */
    d20(modifier = 0) {
        return this.roll(1, 20) + modifier;
    }
}

// Export for both browser and Node.js
if (typeof window !== 'undefined') window.GameRNG = GameRNG;
if (typeof module !== 'undefined' && module.exports) module.exports = GameRNG;
