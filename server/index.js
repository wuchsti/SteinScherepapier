const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);
const roomManager = new RoomManager();

// socket.id -> { roomCode, seat }
const socketInfo = new Map();

function broadcastState(game) {
  for (const seat of ['A', 'B']) {
    const player = game.players[seat];
    if (player && player.connected) {
      io.to(player.socketId).emit('state', game.getView(seat));
    }
  }
}

io.on('connection', (socket) => {
  socket.on('createRoom', (_data, ack) => {
    const game = roomManager.createRoom();
    const token = roomManager.generateToken();
    const seat = game.addPlayer(socket.id, token);
    socketInfo.set(socket.id, { roomCode: game.roomCode, seat });
    socket.join(game.roomCode);
    if (typeof ack === 'function') ack({ ok: true, roomCode: game.roomCode, seat, token });
    broadcastState(game);
  });

  socket.on('joinRoom', ({ roomCode } = {}, ack) => {
    const game = roomManager.getRoom(roomCode);
    if (!game) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Diesen Raum gibt es nicht.' });
      return;
    }
    if (!game.hasOpenSeat()) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Dieser Raum ist bereits voll.' });
      return;
    }
    const token = roomManager.generateToken();
    const seat = game.addPlayer(socket.id, token);
    socketInfo.set(socket.id, { roomCode: game.roomCode, seat });
    socket.join(game.roomCode);
    if (typeof ack === 'function') ack({ ok: true, roomCode: game.roomCode, seat, token });
    broadcastState(game);
  });

  socket.on('rejoin', ({ roomCode, token } = {}, ack) => {
    const game = roomManager.getRoom(roomCode);
    if (!game) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Diesen Raum gibt es nicht mehr.' });
      return;
    }
    const seat = game.findSeatByToken(token);
    if (!seat) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Konnte dich diesem Raum nicht zuordnen.' });
      return;
    }
    game.reconnect(seat, socket.id);
    socketInfo.set(socket.id, { roomCode: game.roomCode, seat });
    socket.join(game.roomCode);
    if (typeof ack === 'function') ack({ ok: true, roomCode: game.roomCode, seat, token });
    broadcastState(game);
  });

  socket.on('placePieces', ({ placements } = {}, ack) => {
    const info = socketInfo.get(socket.id);
    if (!info) return;
    const game = roomManager.getRoom(info.roomCode);
    if (!game) return;
    const result = game.placePieces(info.seat, placements);
    if (typeof ack === 'function') ack(result);
    if (!result.ok) return;
    broadcastState(game);
  });

  socket.on('ready', (_data, ack) => {
    const info = socketInfo.get(socket.id);
    if (!info) return;
    const game = roomManager.getRoom(info.roomCode);
    if (!game) return;
    const result = game.setReady(info.seat);
    if (typeof ack === 'function') ack(result);
    if (!result.ok) return;
    broadcastState(game);
  });

  socket.on('move', ({ from, to } = {}, ack) => {
    const info = socketInfo.get(socket.id);
    if (!info) return;
    const game = roomManager.getRoom(info.roomCode);
    if (!game) return;
    const result = game.move(info.seat, from, to);
    if (typeof ack === 'function') ack(result);
    if (!result.ok) return;
    broadcastState(game);
  });

  socket.on('disconnect', () => {
    const info = socketInfo.get(socket.id);
    socketInfo.delete(socket.id);
    if (!info) return;
    const game = roomManager.getRoom(info.roomCode);
    if (!game) return;
    game.disconnect(info.seat);
    broadcastState(game);
  });
});

server.listen(PORT, () => {
  console.log(`Stein-Schere-Papier Server laeuft auf Port ${PORT}`);
});
