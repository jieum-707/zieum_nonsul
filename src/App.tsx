import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { RemotePeer, CameraDeviceOption } from './types/panopticon';
import { LiveCameraTile } from './components/LiveCameraTile';
import { tacticalAudio } from './utils/audio';
import {
  Camera,
  VideoOff,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  Maximize2,
  Minimize2,
  Tv,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export default function App() {
  // Local stream state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [availableDevices, setAvailableDevices] = useState<CameraDeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // Remote peers
  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeer>>(new Map());
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());

  // Socket
  const socketRef = useRef<Socket | null>(null);
  const [socketId, setSocketId] = useState<string>('');
  const [connectedUsersCount, setConnectedUsersCount] = useState<number>(1);

  // UI States
  const [scanlines, setScanlines] = useState<boolean>(true);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Enumerate camera devices
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `카메라 디바이스 ${idx + 1}`,
        }));
      setAvailableDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }
    } catch {
      // Ignore if permission not granted yet
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Clean up peer connection
  const closePeer = useCallback((id: string) => {
    const pc = peerConnections.current.get(id);
    if (pc) {
      pc.close();
      peerConnections.current.delete(id);
    }
    setRemotePeers((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Initialize Socket.io connection
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketId(socket.id || '');
    });

    // Handle peer left
    socket.on('peer-left', ({ id }: { id: string }) => {
      closePeer(id);
      setConnectedUsersCount((prev) => Math.max(1, prev - 1));
    });

    return () => {
      socket.disconnect();
    };
  }, [closePeer]);

  // Handle incoming WebRTC signals
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    // Existing peers already in the room
    socket.on('existing-peers', async (peers: { id: string; label: string; hasCamera: boolean }[]) => {
      setConnectedUsersCount(peers.length + 1);

      // If we have local stream, initiate connection to existing peers
      if (!localStream) return;

      for (const peer of peers) {
        if (!peer.hasCamera) continue;
        createPeerAndOffer(peer.id, peer.label, localStream);
      }
    });

    // A new peer joined
    socket.on('peer-joined', ({ id, label, hasCamera }: { id: string; label: string; hasCamera: boolean }) => {
      setConnectedUsersCount((prev) => prev + 1);
      if (hasCamera) {
        setRemotePeers((prev) => {
          const next = new Map(prev);
          next.set(id, { id, label, hasCamera, stream: undefined });
          return next;
        });
      }
    });

    // When an offer is received from another peer
    socket.on('offer', async ({ sender, offer }: { sender: string; offer: RTCSessionDescriptionInit }) => {
      try {
        let pc = peerConnections.current.get(sender);
        if (!pc) {
          pc = createPeerConnection(sender);
        }

        // Add our local tracks if we have them
        if (localStream) {
          localStream.getTracks().forEach((track) => {
            pc!.addTrack(track, localStream);
          });
        }

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('answer', { target: sender, answer });
      } catch (err) {
        console.error('Error handling offer:', err);
      }
    });

    // When an answer is received
    socket.on('answer', async ({ sender, answer }: { sender: string; answer: RTCSessionDescriptionInit }) => {
      try {
        const pc = peerConnections.current.get(sender);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    });

    // When an ICE candidate is received
    socket.on('candidate', async ({ sender, candidate }: { sender: string; candidate: RTCIceCandidateInit }) => {
      try {
        const pc = peerConnections.current.get(sender);
        if (pc && candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    return () => {
      socket.off('existing-peers');
      socket.off('peer-joined');
      socket.off('offer');
      socket.off('answer');
      socket.off('candidate');
    };
  }, [localStream]);

  // Create PeerConnection instance
  const createPeerConnection = (targetId: string, peerLabel?: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current.set(targetId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('candidate', {
          target: targetId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setRemotePeers((prev) => {
        const next = new Map(prev);
        const existing = next.get(targetId);
        next.set(targetId, {
          id: targetId,
          label: existing?.label || peerLabel || `CAM-${targetId.slice(0, 4).toUpperCase()}`,
          hasCamera: true,
          stream: stream,
        });
        return next;
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeer(targetId);
      }
    };

    return pc;
  };

  // Create peer and send offer
  const createPeerAndOffer = async (targetId: string, peerLabel: string, stream: MediaStream) => {
    try {
      const pc = createPeerConnection(targetId, peerLabel);
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (socketRef.current) {
        socketRef.current.emit('offer', { target: targetId, offer });
      }
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  };

  // Start local camera (Matches the user's allowBtn action)
  const startCamera = async () => {
    setIsConnecting(true);
    setCameraError('');
    tacticalAudio.playClick(1000);

    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      setIsCameraActive(true);
      setIsConnecting(false);
      tacticalAudio.playLockOn();

      // Notify socket server
      if (socketRef.current) {
        socketRef.current.emit('join-panopticon', {
          label: `CAM-${(socketRef.current.id || 'LOCAL').slice(0, 4).toUpperCase()} [나]`,
          hasCamera: true,
        });
      }

      await refreshDevices();
    } catch (err: unknown) {
      console.error('Camera access error:', err);
      setIsConnecting(false);
      setIsCameraActive(false);
      setCameraError('카메라 액세스가 거부되었습니다.');
      tacticalAudio.playAlertSiren();
    }
  };

  // Stop local camera
  const stopCamera = () => {
    tacticalAudio.playClick(600);
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
    setIsCameraActive(false);

    if (socketRef.current) {
      socketRef.current.emit('update-camera-status', { hasCamera: false });
    }
  };

  // Switch camera device
  const handleDeviceChange = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (isCameraActive) {
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        });
        setLocalStream(stream);
        // Replace track in existing peer connections
        const newTrack = stream.getVideoTracks()[0];
        peerConnections.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (sender && newTrack) {
            sender.replaceTrack(newTrack);
          }
        });
      } catch (err) {
        console.error('Device switch error:', err);
      }
    }
  };

  // Take snapshot of a camera
  const handleSnapshot = (video: HTMLVideoElement, label: string) => {
    tacticalAudio.playShutter();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Watermark
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, canvas.height - 36, canvas.width, 36);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`[PANOPTICON] ${label} - ${new Date().toISOString()}`, 16, canvas.height - 12);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = `PANOPTICON_${label}_${Date.now()}.jpg`;
    a.click();
  };

  // Copy URL to share
  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    tacticalAudio.playClick(1200);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Collect all active camera feeds
  const remotePeersList = Array.from(remotePeers.values()).filter((p) => p.stream);
  const totalActiveCams = (isCameraActive && localStream ? 1 : 0) + remotePeersList.length;

  // Responsive Grid classes based on camera count
  const getGridClass = () => {
    if (totalActiveCams <= 1) return 'grid grid-cols-1 max-w-4xl mx-auto';
    if (totalActiveCams === 2) return 'grid grid-cols-1 md:grid-cols-2';
    if (totalActiveCams <= 4) return 'grid grid-cols-1 sm:grid-cols-2';
    if (totalActiveCams <= 6) return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
  };

  return (
    <div className="min-h-screen bg-black text-emerald-400 font-mono flex flex-col selection:bg-emerald-500 selection:text-black">
      {/* Top Header Navigation */}
      <header className="border-b border-emerald-900/80 bg-neutral-950 px-4 py-2.5 flex items-center justify-between gap-3 sticky top-0 z-40">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-7 h-7 border border-emerald-500/80 bg-emerald-950/40">
            <Camera className="w-4 h-4 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <h1 className="font-display font-bold text-sm sm:text-base tracking-wider text-emerald-300 flex items-center space-x-2">
              <span>[PANOPTICON]</span>
              <span className="text-neutral-300 font-normal">실시간 보안 감시망</span>
            </h1>
          </div>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center space-x-2 text-xs">
          {/* Active Camera Count */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 border border-emerald-900/80 bg-neutral-900/80 text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-neutral-400">실시간 감시 카메라:</span>
            <span className="text-emerald-300 font-bold">{totalActiveCams}대</span>
          </div>

          {/* Copy Link to Add More Cameras */}
          <button
            onClick={copyShareLink}
            className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 border border-emerald-800 hover:border-emerald-500 bg-neutral-900 hover:bg-emerald-950 text-emerald-300 text-[11px] transition-colors cursor-pointer"
            title="다른 사람 또는 다른 기기(스마트폰 등)와 공유하여 실시간 카메라 추가"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? '링크 복사됨!' : '참여 링크 복사'}</span>
          </button>

          {/* CRT Scanlines Toggle */}
          <button
            onClick={() => setScanlines(!scanlines)}
            title="감시 모니터 스캔라인 효과 토글"
            className={`p-1.5 border transition-colors cursor-pointer ${
              scanlines
                ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300'
                : 'border-neutral-800 text-neutral-600 hover:border-neutral-600'
            }`}
          >
            <Tv className="w-4 h-4" />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            title="전체화면"
            className="p-1.5 border border-neutral-800 hover:border-emerald-600 text-neutral-400 hover:text-emerald-300 transition-colors cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Stop / Start Local Camera Toggle */}
          {isCameraActive && (
            <button
              onClick={stopCamera}
              className="px-2.5 py-1 border border-red-800 hover:border-red-600 bg-red-950/40 text-red-400 text-[11px] flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <VideoOff className="w-3.5 h-3.5" />
              <span>카메라 끄기</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-4 flex flex-col justify-center">
        {/* If local camera is not active yet, show clear permission entry prompt */}
        {!isCameraActive ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <div className="max-w-md w-full border border-emerald-500/70 bg-neutral-950 p-6 shadow-2xl relative text-center">
              {/* Corner tech accents */}
              <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-emerald-400" />
              <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-emerald-400" />
              <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-emerald-400" />
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-emerald-400" />

              <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center border border-emerald-500/60 bg-emerald-950/40 text-emerald-400">
                <Camera className="w-6 h-6 animate-pulse" />
              </div>

              <h2 className="text-lg font-bold font-display text-emerald-400 tracking-wider mb-2">
                [PANOPTICON] 보안 감시망 연결
              </h2>
              <p className="text-xs text-neutral-300 font-mono mb-5 leading-relaxed">
                시스템 참여를 위해 카메라 액세스를 허용해 주세요.
                <br />
                <span className="text-neutral-500 text-[11px]">
                  카메라를 허용한 사용자들의 실시간 화면이 판옵티콘 감시망에 동기화됩니다.
                </span>
              </p>

              {/* Camera device picker if multiple devices exist */}
              {availableDevices.length > 1 && (
                <div className="mb-4 text-left">
                  <label className="block text-[11px] text-neutral-400 mb-1">카메라 디바이스 선택:</label>
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => handleDeviceChange(e.target.value)}
                    className="w-full bg-neutral-900 border border-emerald-900 px-2 py-1.5 text-xs text-emerald-300 focus:outline-none focus:border-emerald-500"
                  >
                    {availableDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Error Message */}
              {cameraError && (
                <div className="mb-4 p-2.5 border border-red-500/80 bg-red-950/30 text-red-400 text-xs flex items-center space-x-2 text-left">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{cameraError} 브라우저 주소창 권한 설정을 확인해 주세요.</span>
                </div>
              )}

              {/* Allow Button - Matches User Specification */}
              <button
                id="allowBtn"
                onClick={startCamera}
                disabled={isConnecting}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-black font-bold font-mono text-sm tracking-wide transition-all shadow-lg shadow-emerald-900/40 flex items-center justify-center space-x-2 cursor-pointer"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>카메라 연결 초기화 중...</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    <span>카메라 액세스 허용 및 감시 시작</span>
                  </>
                )}
              </button>

              {/* Notice about other connected cameras */}
              {remotePeersList.length > 0 && (
                <div className="mt-4 pt-3 border-t border-neutral-800 text-[11px] text-emerald-400/90 flex items-center justify-center space-x-1.5">
                  <Users className="w-3.5 h-3.5" />
                  <span>현재 {remotePeersList.length}개의 원격 카메라 피드가 대기 중입니다.</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* When camera is allowed: Pure Real-time Camera Wall */
          <div className="flex-1 flex flex-col gap-3">
            {/* If only local camera is active, show invite helper banner */}
            {totalActiveCams === 1 && (
              <div className="bg-neutral-950/80 border border-emerald-900/60 p-2.5 px-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center space-x-2 text-neutral-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>
                    내 실시간 카메라가 연결되었습니다. 다른 사람이나 다른 기기(스마트폰 등)에서 이 링크를 열면 해당 카메라 화면이 여기에 나란히 추가됩니다.
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={copyShareLink}
                    className="px-2.5 py-1 bg-emerald-900/60 hover:bg-emerald-800 border border-emerald-600 text-emerald-200 text-[11px] font-bold flex items-center space-x-1 transition-colors cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedLink ? '링크 복사됨!' : '참여 링크 복사'}</span>
                  </button>
                  <button
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="px-2.5 py-1 border border-neutral-700 hover:border-emerald-500 text-neutral-300 text-[11px] flex items-center space-x-1 transition-colors cursor-pointer"
                    title="새 창에서 열어 2번째 카메라 연결 테스트"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>새 탭에서 카메라 추가</span>
                  </button>
                </div>
              </div>
            )}

            {/* The Live Video Grid */}
            <div className={`flex-1 gap-3.5 ${getGridClass()}`}>
              {/* Local User Camera */}
              {isCameraActive && localStream && (
                <div className="aspect-video">
                  <LiveCameraTile
                    stream={localStream}
                    label={`CAM-01 [나]`}
                    isLocal={true}
                    scanlines={scanlines}
                    onSnapshot={handleSnapshot}
                    isMaximized={maximizedId === 'local'}
                    onToggleMaximize={() =>
                      setMaximizedId(maximizedId === 'local' ? null : 'local')
                    }
                  />
                </div>
              )}

              {/* Remote Participants' Live Cameras */}
              {remotePeersList.map((peer, idx) => (
                <div key={peer.id} className="aspect-video">
                  <LiveCameraTile
                    stream={peer.stream || null}
                    label={peer.label || `CAM-0${idx + 2} [원격]`}
                    isLocal={false}
                    scanlines={scanlines}
                    onSnapshot={handleSnapshot}
                    isMaximized={maximizedId === peer.id}
                    onToggleMaximize={() =>
                      setMaximizedId(maximizedId === peer.id ? null : peer.id)
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Minimal Watermark */}
      <footer className="border-t border-emerald-950 bg-black/90 px-4 py-1.5 text-[10px] text-neutral-600 flex items-center justify-between font-mono">
        <div>[PANOPTICON] LIVE SURVEILLANCE FEED SYSTEM</div>
        <div className="flex items-center space-x-2">
          <span>STUN: stun.l.google.com:19302</span>
          <span>•</span>
          <span>P2P WebRTC</span>
        </div>
      </footer>
    </div>
  );
}
