const crypto = require('crypto');
const { Game } = require('./game');

// Zeichen ohne leicht verwechselbare Buchstaben/Ziffern (0/O, 1/I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // 3 Stunden Inaktivitaet -> aufraeumen

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Game
    setInterval(() => this.cleanup(), 15 * 60 * 1000).unref();
  }

  generateCode() {
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => {
        const idx = crypto.randomInt(0, CODE_CHARS.length);
        return CODE_CHARS[idx];
      }).join('');
    } while (this.rooms.has(code));
    return code;
  }

  generateToken() {
    return crypto.randomBytes(16).toString('hex');
  }

  createRoom() {
    const code = this.generateCode();
    const game = new Game(code);
    this.rooms.set(code, game);
    return game;
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase()) || null;
  }

  cleanup() {
    const now = Date.now();
    for (const [code, game] of this.rooms.entries()) {
      if (now - game.lastActivity > ROOM_TTL_MS) {
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = { RoomManager };
