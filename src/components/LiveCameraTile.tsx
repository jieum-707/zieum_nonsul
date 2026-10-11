import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Camera, FlipHorizontal, Eye } from 'lucide-react';

interface Props {
  stream: MediaStream | null;
  label: string;
  isLocal?: boolean;
  scanlines?: boolean;
  onSnapshot?: (video: HTMLVideoElement, label: string) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export const LiveCameraTile: React.FC<Props> = ({
  stream,
  label,
  isLocal = false,
  scanlines = true,
  onSnapshot,
  isMaximized = false,
  onToggleMaximize,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isMirrored, setIsMirrored] = useState<boolean>(isLocal);
  const [timeStr, setTimeStr] = useState<string>('');
  const [resolution, setResolution] = useState<string>('연결 중...');

  // Bind stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  // Update timecode
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const ms = String(Math.floor(now.getMilliseconds() / 100)).padStart(2, '0');
      setTimeStr(`${h}:${m}:${s}.${ms}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 100);
    return () => clearInterval(interval);
  }, []);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setResolution(`${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
    }
  };

  const handleCapture = () => {
    if (videoRef.current && onSnapshot) {
      onSnapshot(videoRef.current, label);
    }
  };

  return (
    <div
      className={`relative bg-neutral-950 border border-emerald-900/80 rounded-none overflow-hidden flex flex-col group transition-all ${
        isMaximized
          ? 'fixed inset-2 z-50 shadow-2xl border-emerald-500'
          : 'h-full w-full shadow-lg hover:border-emerald-500/80'
      }`}
    >
      {/* Top HUD Watermark */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-1.5 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center space-x-2 text-[11px] font-mono text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-bold tracking-wider">{label}</span>
          {isLocal && (
            <span className="text-[10px] px-1 py-0.2 bg-emerald-950/80 border border-emerald-600 text-emerald-300">
              ME (본인)
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2 text-[11px] font-mono text-neutral-400">
          <span className="text-emerald-400 font-semibold">{timeStr}</span>
        </div>
      </div>

      {/* Main Video Element */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-[200px]">
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal} // mute local to avoid echo
            onLoadedMetadata={handleLoadedMetadata}
            className={`w-full h-full object-cover transition-transform duration-200 ${
              isMirrored ? '-scale-x-100' : 'scale-x-100'
            }`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-neutral-600 space-y-2 p-4">
            <Eye className="w-8 h-8 text-neutral-700 animate-pulse" />
            <span className="text-xs font-mono">카메라 신호 대기 중...</span>
          </div>
        )}

        {/* Scanlines Overlay */}
        {scanlines && (
          <div className="absolute inset-0 pointer-events-none scanline-overlay opacity-25 z-10" />
        )}

        {/* Corner Crosshairs */}
        <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-emerald-500/60 pointer-events-none" />
        <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-emerald-500/60 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-emerald-500/60 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-emerald-500/60 pointer-events-none" />
      </div>

      {/* Bottom HUD & Action Controls */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900/95 border-t border-emerald-950 text-[11px] font-mono text-neutral-400">
        <div className="flex items-center space-x-2">
          <span className="text-emerald-500">LIVE</span>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-400 text-[10px]">{resolution}</span>
        </div>

        <div className="flex items-center space-x-1">
          {/* Flip Mirror */}
          <button
            onClick={() => setIsMirrored(!isMirrored)}
            title="좌우 반전"
            className="p-1 hover:text-emerald-400 hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
          </button>

          {/* Snapshot capture */}
          {onSnapshot && (
            <button
              onClick={handleCapture}
              title="이 카메라 스냅샷 캡처"
              className="p-1 hover:text-emerald-400 hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Maximize */}
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              title={isMaximized ? '원래 크기로 복귀' : '전체화면 확대'}
              className="p-1 hover:text-emerald-400 hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
