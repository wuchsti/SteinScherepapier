// Core game engine for "Stein, Schere, Papier" online (Stratego-artige Variante).
// Server-authoritative: der komplette, wahre Spielfeldzustand lebt nur hier.
// Clients bekommen ueber getView() immer nur eine gefilterte Sicht.

const BOARD_ROWS = 6;
const BOARD_COLS = 7;

const HOME_ROWS = {
  A: [4, 5], // Host, unten
  B: [0, 1], // Beigetretener Spieler, oben
};
const NEUTRAL_ROWS = [2, 3];

// Zusammensetzung der 14 Figuren pro Spieler (2 Reihen x 7 Spalten).
const PIECE_COUNTS = { rock: 4, scissors: 4, paper: 4, flag: 1, trap: 1 };
const TOTAL_PIECES = Object.values(PIECE_COUNTS).reduce((a, b) => a + b, 0); // 14

const MOBILE_TYPES = new Set(['rock', 'scissors', 'paper']);

function inBounds(row, col) {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

function otherSeat(seat) {
  return seat === 'A' ? 'B' : 'A';
}

// rock schlaegt scissors, scissors schlaegt paper, paper schlaegt rock
function beats(a, b) {
  return (
    (a === 'rock' && b === 'scissors') ||
    (a === 'scissors' && b === 'paper') ||
    (a === 'paper' && b === 'rock')
  );
}

class Game {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.phase = 'waiting'; // waiting -> setup -> playing -> finished
    this.players = { A: null, B: null }; // { socketId, token, ready, connected }
    this.board = Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
    this.turn = 'A';
    this.winner = null;
    this.winReason = null;
    this.lastMove = null; // { id, from, to, seat, outcome } fuer UI-Meldungen/Animationen
    this.moveCounter = 0;
    this.lastActivity = Date.now();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  hasOpenSeat() {
    return this.players.A === null || this.players.B === null;
  }

  addPlayer(socketId, token) {
    this.touch();
    const seat = this.players.A === null ? 'A' : this.players.B === null ? 'B' : null;
    if (!seat) return null;
    this.players[seat] = { socketId, token, ready: false, connected: true };
    if (this.players.A && this.players.B) {
      this.phase = 'setup';
    }
    return seat;
  }

  findSeatByToken(token) {
    for (const seat of ['A', 'B']) {
      if (this.players[seat] && this.players[seat].token === token) return seat;
    }
    return null;
  }

  reconnect(seat, socketId) {
    this.touch();
    if (!this.players[seat]) return false;
    this.players[seat].socketId = socketId;
    this.players[seat].connected = true;
    return true;
  }

  disconnect(seat) {
    this.touch();
    if (this.players[seat]) this.players[seat].connected = false;
  }

  // placements: Array<{row, col, type}> - muss exakt die Heimreihen des Spielers fuellen
  placePieces(seat, placements) {
    this.touch();
    if (this.phase !== 'setup') return { ok: false, error: 'Nicht in der Aufstellungsphase.' };
    if (this.players[seat].ready) return { ok: false, error: 'Du bist bereits bereit.' };

    const homeRows = new Set(HOME_ROWS[seat]);
    const homeCells = new Set();
    for (const r of HOME_ROWS[seat]) {
      for (let c = 0; c < BOARD_COLS; c++) homeCells.add(`${r},${c}`);
    }

    if (!Array.isArray(placements) || placements.length !== TOTAL_PIECES) {
      return { ok: false, error: `Es muessen genau ${TOTAL_PIECES} Figuren platziert werden.` };
    }

    const counts = { rock: 0, scissors: 0, paper: 0, flag: 0, trap: 0 };
    const seen = new Set();

    for (const p of placements) {
      if (!p || typeof p.row !== 'number' || typeof p.col !== 'number') {
        return { ok: false, error: 'Ungueltige Platzierung.' };
      }
      if (!homeRows.has(p.row)) {
        return { ok: false, error: 'Figuren muessen in deiner eigenen Heimzone stehen.' };
      }
      const key = `${p.row},${p.col}`;
      if (!homeCells.has(key)) {
        return { ok: false, error: 'Ungueltiges Feld.' };
      }
      if (seen.has(key)) {
        return { ok: false, error: 'Doppelte Platzierung auf demselben Feld.' };
      }
      if (!Object.prototype.hasOwnProperty.call(counts, p.type)) {
        return { ok: false, error: 'Unbekannter Figurentyp.' };
      }
      seen.add(key);
      counts[p.type]++;
    }

    for (const type of Object.keys(PIECE_COUNTS)) {
      if (counts[type] !== PIECE_COUNTS[type]) {
        return {
          ok: false,
          error: `Falsche Anzahl: ${type} braucht genau ${PIECE_COUNTS[type]}.`,
        };
      }
    }

    // Alles gueltig: auf dem echten Brett ablegen
    for (const r of HOME_ROWS[seat]) {
      for (let c = 0; c < BOARD_COLS; c++) this.board[r][c] = null;
    }
    for (const p of placements) {
      this.board[p.row][p.col] = { owner: seat, type: p.type, revealed: false };
    }

    return { ok: true };
  }

  setReady(seat) {
    this.touch();
    if (this.phase !== 'setup') return { ok: false, error: 'Nicht in der Aufstellungsphase.' };
    // Pruefen, ob die Heimzone des Spielers vollstaendig besetzt ist
    let filled = 0;
    for (const r of HOME_ROWS[seat]) {
      for (let c = 0; c < BOARD_COLS; c++) {
        if (this.board[r][c] && this.board[r][c].owner === seat) filled++;
      }
    }
    if (filled !== TOTAL_PIECES) {
      return { ok: false, error: 'Bitte zuerst alle Figuren aufstellen.' };
    }
    this.players[seat].ready = true;

    if (this.players.A.ready && this.players.B.ready) {
      this.phase = 'playing';
      this.turn = 'A';
    }
    return { ok: true };
  }

  getPieceMoves(row, col) {
    const piece = this.board[row][col];
    if (!piece || !MOBILE_TYPES.has(piece.type)) return [];
    const deltas = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    const moves = [];
    for (const [dr, dc] of deltas) {
      const nr = row + dr;
      const nc = col + dc;
      if (!inBounds(nr, nc)) continue;
      const target = this.board[nr][nc];
      if (!target || target.owner !== piece.owner) {
        moves.push({ row: nr, col: nc });
      }
    }
    return moves;
  }

  seatHasAnyMove(seat) {
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const piece = this.board[r][c];
        if (piece && piece.owner === seat && MOBILE_TYPES.has(piece.type)) {
          if (this.getPieceMoves(r, c).length > 0) return true;
        }
      }
    }
    return false;
  }

  resolveCombat(attacker, defender) {
    // Gibt { outcome, attackerSurvives, defenderSurvives, flagCaptured } zurueck
    if (defender.type === 'flag') {
      return { outcome: 'flagCaptured', attackerSurvives: true, defenderSurvives: false };
    }
    if (defender.type === 'trap') {
      return { outcome: 'trap', attackerSurvives: false, defenderSurvives: false };
    }
    if (attacker.type === defender.type) {
      return { outcome: 'draw', attackerSurvives: false, defenderSurvives: false };
    }
    if (beats(attacker.type, defender.type)) {
      return { outcome: 'attackerWins', attackerSurvives: true, defenderSurvives: false };
    }
    return { outcome: 'defenderWins', attackerSurvives: false, defenderSurvives: true };
  }

  move(seat, from, to) {
    this.touch();
    if (this.phase !== 'playing') return { ok: false, error: 'Das Spiel laeuft nicht.' };
    if (this.turn !== seat) return { ok: false, error: 'Du bist nicht am Zug.' };
    if (!from || !to || !inBounds(from.row, from.col) || !inBounds(to.row, to.col)) {
      return { ok: false, error: 'Ungueltige Koordinaten.' };
    }
    const piece = this.board[from.row][from.col];
    if (!piece || piece.owner !== seat) {
      return { ok: false, error: 'Dort steht keine deiner Figuren.' };
    }
    if (!MOBILE_TYPES.has(piece.type)) {
      return { ok: false, error: 'Diese Figur kann sich nicht bewegen.' };
    }
    const rowDiff = Math.abs(to.row - from.row);
    const colDiff = Math.abs(to.col - from.col);
    const isOrthogonalStep = (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
    if (!isOrthogonalStep) {
      return { ok: false, error: 'Es kann nur ein Feld orthogonal gezogen werden.' };
    }

    const target = this.board[to.row][to.col];
    let outcome = 'move';
    let revealedDefenderType = null;
    let revealedAttackerType = null;

    if (target === null) {
      this.board[to.row][to.col] = piece;
      this.board[from.row][from.col] = null;
    } else if (target.owner === seat) {
      return { ok: false, error: 'Dort steht bereits eine eigene Figur.' };
    } else {
      const result = this.resolveCombat(piece, target);
      outcome = result.outcome;
      revealedDefenderType = target.type;
      revealedAttackerType = piece.type;

      this.board[from.row][from.col] = null;

      if (result.outcome === 'flagCaptured') {
        piece.revealed = true;
        this.board[to.row][to.col] = piece;
        this.phase = 'finished';
        this.winner = seat;
        this.winReason = 'flag';
      } else if (result.outcome === 'trap') {
        this.board[to.row][to.col] = null; // Falle und Angreifer beide vernichtet
      } else if (result.outcome === 'draw') {
        this.board[to.row][to.col] = null; // beide vernichtet
      } else if (result.attackerSurvives) {
        piece.revealed = true;
        this.board[to.row][to.col] = piece;
      } else {
        target.revealed = true;
        this.board[to.row][to.col] = target;
      }
    }

    this.moveCounter += 1;
    this.lastMove = {
      id: this.moveCounter,
      seat,
      from,
      to,
      outcome,
      attackerType: revealedAttackerType,
      defenderType: revealedDefenderType,
    };

    if (this.phase === 'finished') {
      return { ok: true };
    }

    // Zugwechsel + Pattsituation pruefen
    const nextSeat = otherSeat(seat);
    if (!this.seatHasAnyMove(nextSeat)) {
      this.phase = 'finished';
      this.winner = seat;
      this.winReason = 'stalemate';
    } else {
      this.turn = nextSeat;
    }

    return { ok: true };
  }

  // Gefilterte Sicht fuer einen bestimmten Spieler
  getView(seat) {
    const board = this.board.map((row) =>
      row.map((cell) => {
        if (!cell) return null;
        if (cell.owner === seat || cell.revealed) {
          return { owner: cell.owner, type: cell.type, revealed: !!cell.revealed };
        }
        return { owner: cell.owner, type: 'hidden', revealed: false };
      })
    );

    return {
      roomCode: this.roomCode,
      seat,
      phase: this.phase,
      turn: this.turn,
      board,
      rows: BOARD_ROWS,
      cols: BOARD_COLS,
      homeRows: HOME_ROWS[seat],
      pieceCounts: PIECE_COUNTS,
      totalPieces: TOTAL_PIECES,
      winner: this.winner,
      winReason: this.winReason,
      lastMove: this.lastMove,
      opponentConnected: !!(this.players[otherSeat(seat)] && this.players[otherSeat(seat)].connected),
      opponentReady: !!(this.players[otherSeat(seat)] && this.players[otherSeat(seat)].ready),
      youReady: !!(this.players[seat] && this.players[seat].ready),
    };
  }
}

module.exports = {
  Game,
  BOARD_ROWS,
  BOARD_COLS,
  HOME_ROWS,
  NEUTRAL_ROWS,
  PIECE_COUNTS,
  TOTAL_PIECES,
};
