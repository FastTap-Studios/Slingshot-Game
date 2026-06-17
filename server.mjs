/**
 * Socket.IO server for Online PvP. Run with: node server.mjs
 * Then set VITE_SOCKET_URL=http://localhost:3000 in .env and run npm run dev.
 */
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const PORT = Number(process.env.PORT) || 3000;
let matchmakingQueue = null;
const rematchReadyByRoom = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find-match", () => {
    if (matchmakingQueue && matchmakingQueue !== socket.id) {
      const opponentId = matchmakingQueue;
      matchmakingQueue = null;
      const roomId = `MATCH_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
      const opponentSocket = io.sockets.sockets.get(opponentId);
      if (opponentSocket) {
        opponentSocket.join(roomId);
        socket.join(roomId);
        opponentSocket.emit("player-assignment", 1);
        socket.emit("player-assignment", 2);
        io.to(roomId).emit("game-start", { roomId });
        console.log(`Match found in room ${roomId}`);
      } else {
        matchmakingQueue = socket.id;
        socket.emit("waiting-for-match");
      }
    } else {
      matchmakingQueue = socket.id;
      socket.emit("waiting-for-match");
      console.log("Waiting for match...");
    }
  });

  socket.on("join-room", (roomId) => {
    const normalized = String(roomId || "").trim().toUpperCase();
    if (!normalized) return;
    socket.join(normalized);
    const clients = io.sockets.adapter.rooms.get(normalized);
    const numClients = clients ? clients.size : 0;
    socket.emit("player-assignment", numClients === 1 ? 1 : 2);
    if (numClients === 2) io.to(normalized).emit("game-start", { roomId: normalized });
  });

  socket.on("send-attack", ({ roomId, attack }) => {
    socket.to(roomId).emit("receive-attack", attack);
  });

  socket.on("sync-state", ({ roomId, state }) => {
    socket.to(roomId).emit("opponent-state", state);
  });

  socket.on("game-over", ({ roomId, playerId }) => {
    io.to(roomId).emit("opponent-game-over", playerId);
  });

  socket.on("request-rematch", (data) => {
    console.log("[rematch] received from", socket.id, "data:", JSON.stringify(data));
    const roomId = data && data.roomId;
    const normalized = String(roomId != null ? roomId : "").trim().toUpperCase();
    if (!normalized) {
      console.log("[rematch] no roomId", data);
      return;
    }
    const room = io.sockets.adapter.rooms.get(normalized);
    if (!room || !room.has(socket.id)) {
      console.log("[rematch] socket not in room", normalized, room ? room.size : 0);
      return;
    }
    io.to(normalized).emit("opponent-requested-rematch");
    let set = rematchReadyByRoom.get(normalized);
    if (!set) {
      set = new Set();
      rematchReadyByRoom.set(normalized, set);
    }
    set.add(socket.id);
    if (set.size >= 2 && room.size >= 2) {
      rematchReadyByRoom.delete(normalized);
      io.in(normalized).emit("rematch-start");
      console.log("[rematch] rematch-start sent to", normalized);
    }
  });

  // Viktigt: använd "disconnecting" för att komma åt rummen INNAN Socket.IO tömmer dem.
  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      const set = rematchReadyByRoom.get(roomId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) rematchReadyByRoom.delete(roomId);
      }
      // Tala om för kvarvarande spelare i rummet att motståndaren har lämnat.
      socket.to(roomId).emit("opponent-left");
    }
  });

  socket.on("disconnect", () => {
    if (matchmakingQueue === socket.id) matchmakingQueue = null;
    console.log("User disconnected:", socket.id);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Socket.IO server: http://localhost:${PORT}`);
  console.log(`Öppna spelet i webbläsaren (t.ex. http://localhost:3002) och gå till Online PvP.`);
});
