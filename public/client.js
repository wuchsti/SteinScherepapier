(() => {
  'use strict';

  const TYPE_LABELS = { rock: 'Stein', scissors: 'Schere', paper: 'Papier', flag: 'Fahne', trap: 'Falle', hidden: 'Unbekannt' };
  const NEUTRAL_ROWS = [2, 3];

  function pieceSvg(type) {
    const id = type === 'hidden' ? 'pc-hidden' : `pc-${type}`;
    return `<svg viewBox="0 0 64 64"><use href="#${id}"></use></svg>`;
  }

  // Feste Teamfarben: Host (Seat A) ist immer blau, Beigetretener (Seat B) immer rot -
  // unabhaengig davon, aus wessen Sicht gerade gerendert wird.
  function seatClass(seat) {
    return seat === 'A' ? 'owner-host' : 'owner-joiner';
  }
  function mySeatClass(view) {
    return seatClass(view.seat);
  }
  function oppSeatClass(view) {
    return seatClass(view.seat === 'A' ? 'B' : 'A');
  }

  // ---------- Sound (synthetisiert per Web Audio API, keine externen Dateien) ----------
  const Sound = (() => {
    let ctx = null;
    function ensureCtx() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, start, duration, { type = 'sine', gain = 0.18, slideTo = null } = {}) {
      const c = ensureCtx();
      const osc = c.createOscillator();
      const amp = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime + start);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + start + duration);
      }
      amp.gain.setValueAtTime(0, c.currentTime + start);
      amp.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
      amp.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration);
      osc.connect(amp).connect(c.destination);
      osc.start(c.currentTime + start);
      osc.stop(c.currentTime + start + duration + 0.02);
    }
    function noiseBurst(start, duration, gain = 0.25, filterType = null, filterFreq = 1000) {
      const c = ensureCtx();
      const bufferSize = Math.max(1, Math.floor(c.sampleRate * duration));
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const src = c.createBufferSource();
      src.buffer = buffer;
      const amp = c.createGain();
      amp.gain.setValueAtTime(gain, c.currentTime + start);
      amp.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration);
      let node = src;
      if (filterType) {
        const filter = c.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = filterFreq;
        node.connect(filter);
        node = filter;
      }
      node.connect(amp).connect(c.destination);
      src.start(c.currentTime + start);
    }
    const S = {
      click() { try { tone(520, 0, 0.07, { type: 'triangle', gain: 0.12 }); } catch (e) {} },
      place() { try { tone(440, 0, 0.09, { type: 'triangle', gain: 0.15 }); tone(660, 0.05, 0.08, { type: 'triangle', gain: 0.1 }); } catch (e) {} },
      select() { try { tone(700, 0, 0.06, { type: 'sine', gain: 0.12 }); } catch (e) {} },
      move() { try { tone(380, 0, 0.12, { type: 'sine', gain: 0.14, slideTo: 300 }); } catch (e) {} },
      error() { try { tone(160, 0, 0.18, { type: 'sawtooth', gain: 0.1 }); } catch (e) {} },

      // Stein: dumpfer, tiefer Klopf-Impact (zwei Stein-auf-Stein-Schlaege)
      rock() {
        try {
          noiseBurst(0, 0.09, 0.22, 'lowpass', 400);
          tone(130, 0, 0.14, { type: 'sine', gain: 0.24, slideTo: 80 });
          noiseBurst(0.09, 0.07, 0.14, 'lowpass', 350);
          tone(95, 0.09, 0.1, { type: 'sine', gain: 0.14 });
        } catch (e) {}
      },
      // Schere: scharfer, metallischer Schnitt
      scissors() {
        try {
          tone(2400, 0, 0.03, { type: 'square', gain: 0.1 });
          noiseBurst(0, 0.045, 0.2, 'highpass', 4000);
          tone(1600, 0.05, 0.03, { type: 'square', gain: 0.08 });
          noiseBurst(0.05, 0.045, 0.16, 'highpass', 3200);
        } catch (e) {}
      },
      // Papier: raschelndes Zerknuellen aus vielen kurzen, zufaelligen Knister-Impulsen
      paper() {
        try {
          for (let i = 0; i < 10; i++) {
            const t = i * 0.032 + Math.random() * 0.015;
            noiseBurst(t, 0.025 + Math.random() * 0.02, 0.09 + Math.random() * 0.06, 'highpass', 2200 + Math.random() * 2000);
          }
        } catch (e) {}
      },
      material(type) {
        if (type === 'rock') S.rock();
        else if (type === 'scissors') S.scissors();
        else if (type === 'paper') S.paper();
      },
      // Figur eliminiert: Einschlag + absteigendes Glissando, deutlich wuchtiger als ein einfacher Klick
      defeat() {
        try {
          noiseBurst(0, 0.2, 0.22, 'highpass', 900);
          tone(520, 0, 0.32, { type: 'sawtooth', gain: 0.14, slideTo: 70 });
          tone(75, 0.17, 0.22, { type: 'sine', gain: 0.22 });
        } catch (e) {}
      },
      trap() { try { noiseBurst(0, 0.4, 0.32, 'lowpass', 500); tone(90, 0, 0.32, { type: 'sawtooth', gain: 0.17, slideTo: 40 }); } catch (e) {} },
      win() {
        try {
          [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.1, 0.22, { type: 'triangle', gain: 0.16 }));
        } catch (e) {}
      },
      lose() {
        try {
          [392, 349, 293, 220].forEach((f, i) => tone(f, i * 0.12, 0.25, { type: 'sine', gain: 0.14 }));
        } catch (e) {}
      },
    };
    return S;
  })();

  // ---------- DOM ----------
  const screens = {
    lobby: document.getElementById('screen-lobby'),
    waiting: document.getElementById('screen-waiting'),
    setup: document.getElementById('screen-setup'),
    game: document.getElementById('screen-game'),
  };
  const lobbyError = document.getElementById('lobby-error');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const paletteEl = document.getElementById('palette');
  const setupBoardEl = document.getElementById('setup-board');
  const setupStatusEl = document.getElementById('setup-status');
  const gameBoardEl = document.getElementById('game-board');
  const turnIndicatorEl = document.getElementById('turn-indicator');
  const connectionIndicatorEl = document.getElementById('connection-indicator');
  const moveLogEl = document.getElementById('move-log');
  const overlayEl = document.getElementById('gameover-overlay');
  const overlayTitleEl = document.getElementById('gameover-title');
  const overlayReasonEl = document.getElementById('gameover-reason');
  const trackerEl = document.getElementById('piece-tracker');
  const tiebreakOverlayEl = document.getElementById('tiebreak-overlay');
  const tiebreakInfoEl = document.getElementById('tiebreak-info');
  const tiebreakStatusEl = document.getElementById('tiebreak-status');

  function showScreen(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('hidden', key !== name);
    }
  }

  // ---------- State ----------
  const socket = io();
  let session = loadSession(); // { roomCode, token }
  let mySeat = null;
  let latestView = null;
  let localPlacements = {}; // "r,c" -> type   (nur waehrend Setup, client-seitig)
  let selectedPaletteType = null;
  let selectedCell = null; // {row, col} auf dem Spielbrett
  let seenMoveId = 0;

  function loadSession() {
    try {
      const raw = localStorage.getItem('ssp-session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveSession(s) {
    try { localStorage.setItem('ssp-session', JSON.stringify(s)); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem('ssp-session'); } catch (e) {}
  }

  // ---------- Lobby ----------
  document.getElementById('btn-create').addEventListener('click', () => {
    Sound.click();
    socket.emit('createRoom', {}, (res) => {
      if (!res.ok) { lobbyError.textContent = res.error; return; }
      mySeat = res.seat;
      session = { roomCode: res.roomCode, token: res.token };
      saveSession(session);
      roomCodeDisplay.textContent = res.roomCode;
      lobbyError.textContent = '';
    });
  });

  document.getElementById('btn-join').addEventListener('click', () => doJoin());
  document.getElementById('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    Sound.click();
    const code = document.getElementById('input-code').value.trim().toUpperCase();
    if (!code) return;
    socket.emit('joinRoom', { roomCode: code }, (res) => {
      if (!res.ok) { lobbyError.textContent = res.error; return; }
      mySeat = res.seat;
      session = { roomCode: res.roomCode, token: res.token };
      saveSession(session);
      lobbyError.textContent = '';
    });
  }

  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = roomCodeDisplay.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
  });

  function leaveToLobby(needsConfirm) {
    if (needsConfirm && !window.confirm('Spiel wirklich verlassen? Der Fortschritt geht verloren.')) {
      return;
    }
    clearSession();
    window.location.reload();
  }

  document.getElementById('btn-new-game').addEventListener('click', () => leaveToLobby(false));
  document.getElementById('btn-cancel-waiting').addEventListener('click', () => leaveToLobby(false));
  document.getElementById('btn-leave-setup').addEventListener('click', () => leaveToLobby(true));
  document.getElementById('btn-leave-game').addEventListener('click', () => leaveToLobby(true));

  // ---------- Socket lifecycle ----------
  socket.on('connect', () => {
    if (session && session.roomCode && session.token) {
      socket.emit('rejoin', session, (res) => {
        if (!res.ok) {
          clearSession();
          session = null;
          showScreen('lobby');
          return;
        }
        mySeat = res.seat;
      });
    }
  });

  socket.on('errorMsg', (data) => {
    if (screens.lobby.classList.contains('hidden') === false) {
      lobbyError.textContent = data.error;
    } else {
      setupStatusEl.textContent = data.error;
    }
    Sound.error();
  });

  socket.on('state', (view) => {
    latestView = view;
    render(view);
  });

  // ---------- Render dispatch ----------
  function render(view) {
    if (view.phase === 'waiting') {
      roomCodeDisplay.textContent = view.roomCode;
      showScreen('waiting');
      return;
    }
    if (view.phase === 'setup') {
      showScreen('setup');
      renderSetup(view);
      return;
    }
    // playing oder finished
    showScreen('game');
    renderGame(view);
    if (view.phase === 'finished') {
      renderGameOver(view);
    } else {
      overlayEl.classList.add('hidden');
    }
  }

  // ---------- Setup screen ----------
  function placedCountFor(type) {
    return Object.values(localPlacements).filter((t) => t === type).length;
  }

  function renderPalette(view) {
    paletteEl.innerHTML = '';
    for (const type of Object.keys(view.pieceCounts)) {
      const max = view.pieceCounts[type];
      const used = placedCountFor(type);
      const remaining = max - used;
      const item = document.createElement('div');
      item.className = 'palette-item ' + mySeatClass(view) + (remaining <= 0 ? ' empty' : '') + (selectedPaletteType === type ? ' selected' : '');
      item.innerHTML = `<span class="icon">${pieceSvg(type)}</span><span class="count">${remaining}/${max}</span>`;
      item.title = TYPE_LABELS[type];
      item.addEventListener('click', () => {
        if (remaining <= 0) return;
        selectedPaletteType = selectedPaletteType === type ? null : type;
        Sound.click();
        renderPalette(view);
      });
      paletteEl.appendChild(item);
    }
  }

  function renderSetupBoard(view) {
    setupBoardEl.innerHTML = '';
    setupBoardEl.style.gridTemplateColumns = `repeat(${view.cols}, 56px)`;
    setupBoardEl.style.gridTemplateRows = `repeat(${view.homeRows.length}, 56px)`;
    for (const r of view.homeRows) {
      for (let c = 0; c < view.cols; c++) {
        const key = `${r},${c}`;
        const cell = document.createElement('div');
        cell.className = 'cell own-zone placeable';
        const type = localPlacements[key];
        if (type) {
          cell.innerHTML = `<span class="${mySeatClass(view)}">${pieceSvg(type)}</span>`;
          cell.title = TYPE_LABELS[type];
        }
        cell.addEventListener('click', () => {
          if (type) {
            delete localPlacements[key];
            Sound.click();
          } else if (selectedPaletteType) {
            const max = view.pieceCounts[selectedPaletteType];
            if (placedCountFor(selectedPaletteType) < max) {
              localPlacements[key] = selectedPaletteType;
              Sound.place();
              const cellEl = cell;
              cellEl.classList.add('pop');
              setTimeout(() => cellEl.classList.remove('pop'), 220);
            }
          }
          renderPalette(view);
          renderSetupBoard(view);
          updateReadyButton(view);
        });
        setupBoardEl.appendChild(cell);
      }
    }
  }

  function updateReadyButton(view) {
    const total = Object.values(localPlacements).length;
    document.getElementById('btn-ready').disabled = total !== view.totalPieces;
  }

  function renderSetup(view) {
    renderPalette(view);
    renderSetupBoard(view);
    updateReadyButton(view);
    setupStatusEl.textContent = view.opponentConnected
      ? (view.opponentReady ? 'Dein Gegner ist bereit und wartet auf dich.' : '')
      : 'Warte darauf, dass dein Gegner beitritt...';
  }

  document.getElementById('btn-randomize').addEventListener('click', () => {
    if (!latestView) return;
    Sound.click();
    const cells = [];
    for (const r of latestView.homeRows) {
      for (let c = 0; c < latestView.cols; c++) cells.push(`${r},${c}`);
    }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const bag = [];
    for (const type of Object.keys(latestView.pieceCounts)) {
      for (let i = 0; i < latestView.pieceCounts[type]; i++) bag.push(type);
    }
    localPlacements = {};
    cells.forEach((key, idx) => { localPlacements[key] = bag[idx]; });
    selectedPaletteType = null;
    renderSetup(latestView);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    Sound.click();
    localPlacements = {};
    selectedPaletteType = null;
    renderSetup(latestView);
  });

  document.getElementById('btn-ready').addEventListener('click', () => {
    if (!latestView) return;
    const placements = Object.entries(localPlacements).map(([key, type]) => {
      const [row, col] = key.split(',').map(Number);
      return { row, col, type };
    });
    socket.emit('placePieces', { placements }, (res) => {
      if (!res.ok) { setupStatusEl.textContent = res.error; Sound.error(); return; }
      socket.emit('ready', {}, (res2) => {
        if (!res2.ok) { setupStatusEl.textContent = res2.error; Sound.error(); return; }
        Sound.click();
        setupStatusEl.textContent = 'Bereit! Warte auf deinen Gegner...';
      });
    });
  });

  // ---------- Game board ----------
  function isOwnHomeRow(view, row) {
    return view.homeRows.includes(row);
  }
  function isNeutralRow(row) {
    return NEUTRAL_ROWS.includes(row);
  }

  function legalMovesFrom(view, row, col) {
    const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const moves = [];
    for (const [dr, dc] of deltas) {
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= view.rows || nc < 0 || nc >= view.cols) continue;
      const target = view.board[nr][nc];
      if (!target || target.owner !== view.seat) moves.push({ row: nr, col: nc });
    }
    return moves;
  }

  function renderGame(view) {
    gameBoardEl.innerHTML = '';
    gameBoardEl.style.gridTemplateColumns = `repeat(${view.cols}, 56px)`;
    gameBoardEl.style.gridTemplateRows = `repeat(${view.rows}, 56px)`;

    const myTurn = view.phase === 'playing' && view.turn === view.seat && !view.pendingTiebreak;
    const legalTargets = selectedCell ? legalMovesFrom(view, selectedCell.row, selectedCell.col) : [];

    for (let r = 0; r < view.rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        const cellData = view.board[r][c];
        const cellEl = document.createElement('div');
        let zoneClass = 'neutral';
        if (isOwnHomeRow(view, r)) zoneClass = 'own-zone';
        else if (!isNeutralRow(r)) zoneClass = 'opp-zone';
        cellEl.className = `cell ${zoneClass}`;

        if (cellData) {
          const ownerClass = seatClass(cellData.owner) + (cellData.revealed ? ' piece-revealed' : '');
          const span = document.createElement('span');
          span.className = ownerClass;
          span.innerHTML = pieceSvg(cellData.type);
          if (cellData.type !== 'hidden') span.title = TYPE_LABELS[cellData.type] || '';
          cellEl.appendChild(span);
        }

        const isTarget = legalTargets.some((m) => m.row === r && m.col === c);
        if (isTarget) {
          cellEl.classList.add('move-target');
          if (cellData) cellEl.classList.add('attack');
        }
        if (selectedCell && selectedCell.row === r && selectedCell.col === c) {
          cellEl.classList.add('selected');
        }

        const canSelect = myTurn && cellData && cellData.owner === view.seat && cellData.type !== 'flag' && cellData.type !== 'trap';
        if (canSelect || isTarget) cellEl.classList.add('selectable');

        cellEl.addEventListener('click', () => onBoardCellClick(view, r, c, Boolean(canSelect), isTarget));

        if (view.lastMove && view.lastMove.id === seenMoveId && pointsMatch(view.lastMove.to, r, c)) {
          cellEl.classList.add('flash-land');
        }

        gameBoardEl.appendChild(cellEl);
      }
    }

    turnIndicatorEl.textContent = view.phase === 'finished'
      ? 'Spiel beendet'
      : (myTurn ? 'Du bist am Zug' : 'Gegner ist am Zug');
    turnIndicatorEl.className = 'turn-indicator ' + (myTurn ? 'my-turn' : 'opp-turn');

    connectionIndicatorEl.textContent = view.opponentConnected ? 'Gegner verbunden' : 'Gegner getrennt – warte auf Rückkehr...';
    connectionIndicatorEl.className = 'connection-indicator' + (view.opponentConnected ? '' : ' offline');

    renderPieceTracker(view);
    renderTiebreak(view);
    maybeAnimateAndLogMove(view);
  }

  // ---------- Live-Anzeige: wer hat noch wie viele Figuren ----------
  function computeCounts(view) {
    const mine = { rock: 0, scissors: 0, paper: 0, flag: 0, trap: 0 };
    const opp = { rock: 0, scissors: 0, paper: 0, flag: 0, trap: 0, hidden: 0 };
    for (let r = 0; r < view.rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        const cell = view.board[r][c];
        if (!cell) continue;
        if (cell.owner === view.seat) {
          mine[cell.type] = (mine[cell.type] || 0) + 1;
        } else if (cell.type === 'hidden') {
          opp.hidden += 1;
        } else {
          opp[cell.type] = (opp[cell.type] || 0) + 1;
        }
      }
    }
    const mineTotal = mine.rock + mine.scissors + mine.paper;
    const oppTotal = opp.rock + opp.scissors + opp.paper + opp.hidden;
    return { mine, opp, mineTotal, oppTotal };
  }

  function countChip(type, count, ownerClass) {
    const dim = count === 0 ? ' dim' : '';
    return `<span class="tracker-chip ${ownerClass}${dim}" title="${TYPE_LABELS[type]}">${pieceSvg(type)}<b>${count}</b></span>`;
  }

  function statusChip(type, present, ownerClass) {
    const dim = present ? '' : ' dim';
    const title = TYPE_LABELS[type] + (present ? '' : ' (verloren)');
    return `<span class="tracker-chip ${ownerClass}${dim}" title="${title}">${pieceSvg(type)}</span>`;
  }

  function renderPieceTracker(view) {
    if (!trackerEl) return;
    const { mine, opp, mineTotal, oppTotal } = computeCounts(view);
    const myClass = mySeatClass(view);
    const oppClass = oppSeatClass(view);
    const mineChips = ['rock', 'scissors', 'paper'].map((t) => countChip(t, mine[t], myClass)).join('')
      + statusChip('flag', mine.flag > 0, myClass)
      + statusChip('trap', mine.trap > 0, myClass);
    const oppChips = ['rock', 'scissors', 'paper']
      .filter((t) => opp[t] > 0)
      .map((t) => countChip(t, opp[t], oppClass))
      .join('') + (opp.hidden > 0 ? countChip('hidden', opp.hidden, oppClass) : '');

    trackerEl.innerHTML = `
      <div class="tracker-col">
        <div class="tracker-head"><span class="tracker-dot ${myClass}"></span>Du <strong>${mineTotal}</strong></div>
        <div class="tracker-chips">${mineChips}</div>
      </div>
      <div class="tracker-col">
        <div class="tracker-head"><span class="tracker-dot ${oppClass}"></span>Gegner <strong>${oppTotal}</strong></div>
        <div class="tracker-chips">${oppChips}</div>
      </div>
    `;
  }

  // ---------- Stichkampf bei Gleichstand ----------
  function renderTiebreak(view) {
    const pt = view.pendingTiebreak;
    if (!pt) {
      tiebreakOverlayEl.classList.add('hidden');
      return;
    }
    tiebreakOverlayEl.classList.remove('hidden');
    tiebreakInfoEl.textContent = pt.round === 1
      ? `Beide Figuren waren ${TYPE_LABELS[pt.type]} – wählt verdeckt noch einmal.`
      : `Schon wieder Gleichstand (Runde ${pt.round})! Noch einmal wählen.`;
    const waitingForMe = !pt.myChoiceMade;
    document.querySelectorAll('.tiebreak-btn').forEach((btn) => { btn.disabled = !waitingForMe; });
    tiebreakStatusEl.textContent = waitingForMe
      ? 'Wähle deine Figur für den Stichkampf.'
      : (pt.opponentChoiceMade ? 'Werte aus …' : 'Warte auf deinen Gegner …');
  }

  document.querySelectorAll('.tiebreak-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const type = btn.dataset.type;
      Sound.click();
      document.querySelectorAll('.tiebreak-btn').forEach((b) => { b.disabled = true; });
      socket.emit('tiebreakChoice', { choice: type }, (res) => {
        if (!res.ok) {
          tiebreakStatusEl.textContent = res.error;
          Sound.error();
          if (latestView) renderTiebreak(latestView);
          return;
        }
        tiebreakStatusEl.textContent = 'Warte auf deinen Gegner …';
      });
    });
  });

  function pointsMatch(p, r, c) {
    return p && p.row === r && p.col === c;
  }

  function onBoardCellClick(view, r, c, canSelect, isTarget) {
    if (view.phase !== 'playing' || view.turn !== view.seat || view.pendingTiebreak) return;
    if (selectedCell && isTarget) {
      const from = selectedCell;
      selectedCell = null;
      socket.emit('move', { from, to: { row: r, col: c } }, (res) => {
        if (!res.ok) {
          setupStatusEl.textContent = '';
          Sound.error();
        }
      });
      return;
    }
    if (canSelect) {
      selectedCell = (selectedCell && selectedCell.row === r && selectedCell.col === c) ? null : { row: r, col: c };
      Sound.select();
      renderGame(view);
      return;
    }
    if (selectedCell) {
      selectedCell = null;
      renderGame(view);
    }
  }

  function describeMove(view, lastMove) {
    const mine = lastMove.seat === view.seat;
    const who = mine ? 'Du' : 'Gegner';
    // Verbformen fuer "Du" (2. Pers. Sg.) vs. "Gegner" (3. Pers. Sg.)
    const v = (duForm, erForm) => (mine ? duForm : erForm);
    switch (lastMove.outcome) {
      case 'move':
        return `${who} ${v('ziehst', 'zieht')} eine Figur.`;
      case 'draw':
        return `${who} ${v('greifst', 'greift')} an: Gleichstand (${TYPE_LABELS[lastMove.attackerType]} vs. ${TYPE_LABELS[lastMove.defenderType]}) – beide Figuren raus.`;
      case 'trap':
        return `${who} ${v('tappst', 'tappt')} in eine Falle 💣 – die Figur ist raus.`;
      case 'flagCaptured':
        return `${mine ? 'Du hast' : 'Gegner hat'} die Fahne erobert! 🚩`;
      case 'attackerWins':
        return `${who} ${v('gewinnst', 'gewinnt')}: ${TYPE_LABELS[lastMove.attackerType]} schlägt ${TYPE_LABELS[lastMove.defenderType]}.`;
      case 'defenderWins':
        return `${mine ? 'Dein Angriff scheitert' : 'Gegner-Angriff scheitert'}: ${TYPE_LABELS[lastMove.defenderType]} schlägt ${TYPE_LABELS[lastMove.attackerType]}.`;
      case 'drawPending':
        return `Gleichstand (${TYPE_LABELS[lastMove.attackerType]} gegen ${TYPE_LABELS[lastMove.defenderType]}) – Stichkampf! Beide wählen verdeckt neu.`;
      case 'drawResolved': {
        const iAmAttacker = lastMove.seat === view.seat;
        const myChoice = iAmAttacker ? lastMove.tiebreakChoiceAttacker : lastMove.tiebreakChoiceDefender;
        const oppChoice = iAmAttacker ? lastMove.tiebreakChoiceDefender : lastMove.tiebreakChoiceAttacker;
        const iWon = lastMove.winnerSeat === view.seat;
        return `Stichkampf: Du ${TYPE_LABELS[myChoice]}, Gegner ${TYPE_LABELS[oppChoice]} – ${iWon ? 'du behältst deine Figur!' : 'deine Figur ist raus.'}`;
      }
      default:
        return '';
    }
  }

  function maybeAnimateAndLogMove(view) {
    const lm = view.lastMove;
    if (!lm || lm.id === seenMoveId) return;
    seenMoveId = lm.id;

    const text = describeMove(view, lm);
    if (text) {
      const entry = document.createElement('div');
      entry.textContent = text;
      moveLogEl.prepend(entry);
      while (moveLogEl.children.length > 30) moveLogEl.removeChild(moveLogEl.lastChild);
    }

    const mine = lm.seat === view.seat;
    switch (lm.outcome) {
      case 'move':
        Sound.move();
        break;
      case 'trap':
        Sound.trap();
        break;
      case 'flagCaptured':
        mine ? Sound.win() : Sound.lose();
        break;
      case 'drawPending':
        Sound.material(lm.attackerType);
        break;
      case 'attackerWins':
      case 'defenderWins': {
        const winningType = lm.outcome === 'attackerWins' ? lm.attackerType : lm.defenderType;
        const iWon = lm.outcome === 'attackerWins' ? mine : !mine;
        Sound.material(winningType);
        setTimeout(() => Sound.defeat(), 160);
        setTimeout(() => (iWon ? Sound.win() : Sound.lose()), 380);
        break;
      }
      case 'drawResolved': {
        const winningChoice = lm.winnerSeat === lm.seat ? lm.tiebreakChoiceAttacker : lm.tiebreakChoiceDefender;
        const iWon = lm.winnerSeat === view.seat;
        Sound.material(winningChoice);
        setTimeout(() => Sound.defeat(), 160);
        setTimeout(() => (iWon ? Sound.win() : Sound.lose()), 380);
        break;
      }
      default:
        break;
    }
  }

  // ---------- Game over ----------
  function renderGameOver(view) {
    const iWon = view.winner === view.seat;
    overlayTitleEl.textContent = iWon ? '🎉 Du hast gewonnen!' : '😔 Du hast verloren';
    overlayReasonEl.textContent = view.winReason === 'flag'
      ? (iWon ? 'Du hast die gegnerische Fahne erobert.' : 'Deine Fahne wurde erobert.')
      : (iWon ? 'Dein Gegner kann sich nicht mehr bewegen.' : 'Du kannst dich nicht mehr bewegen.');
    overlayEl.classList.remove('hidden');
    spawnConfetti(iWon);
  }

  function spawnConfetti(iWon) {
    if (!iWon) return;
    const colors = ['#ffd54f', '#66bb6a', '#42a5f5', '#ef5350', '#ab47bc'];
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = (Math.random() * 0.4) + 's';
      piece.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3200);
    }
  }

  showScreen('lobby');
})();
