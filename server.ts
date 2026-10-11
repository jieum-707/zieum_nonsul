import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const PORT = Number(process.env.PORT) || 3000;

  interface PeerInfo {
    id: string;
    label: string;
    hasCamera: boolean;
    joinedAt: number;
  }

  const peers = new Map<string, PeerInfo>();

  io.on('connection', (socket) => {
    // When a user requests to join panopticon surveillance room
    socket.on('join-panopticon', (data: { label?: string; hasCamera: boolean }) => {
      const label = data.label || `CAM-${socket.id.slice(0, 4).toUpperCase()}`;
      peers.set(socket.id, {
        id: socket.id,
        label,
        hasCamera: data.hasCamera,
        joinedAt: Date.now(),
      });

      // Send existing peers list to the newly connected user
      const existingList = Array.from(peers.values()).filter((p) => p.id !== socket.id);
      socket.emit('existing-peers', existingList);

      // Notify other peers
      socket.broadcast.emit('peer-joined', {
        id: socket.id,
        label,
        hasCamera: data.hasCamera,
      });
    });

    // Camera status changed
    socket.on('update-camera-status', (data: { hasCamera: boolean; label?: string }) => {
      const current = peers.get(socket.id);
      if (current) {
        current.hasCamera = data.hasCamera;
        if (data.label) current.label = data.label;
      } else {
        peers.set(socket.id, {
          id: socket.id,
          label: data.label || `CAM-${socket.id.slice(0, 4).toUpperCase()}`,
          hasCamera: data.hasCamera,
          joinedAt: Date.now(),
        });
      }

      io.emit('peer-updated', {
        id: socket.id,
        hasCamera: data.hasCamera,
        label: data.label,
      });
    });

    // WebRTC Signaling: offer, answer, ICE candidate
    socket.on('offer', (data: { target: string; offer: unknown }) => {
      io.to(data.target).emit('offer', {
        sender: socket.id,
        offer: data.offer,
      });
    });

    socket.on('answer', (data: { target: string; answer: unknown }) => {
      io.to(data.target).emit('answer', {
        sender: socket.id,
        answer: data.answer,
      });
    });

    socket.on('candidate', (data: { target: string; candidate: unknown }) => {
      io.to(data.target).emit('candidate', {
        sender: socket.id,
        candidate: data.candidate,
      });
    });

    socket.on('disconnect', () => {
      peers.delete(socket.id);
      io.emit('peer-left', { id: socket.id });
    });
  });

  // Serve static or Vite in development
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[PANOPTICON] Server listening on port ${PORT}`);
  });
}

startServer();
