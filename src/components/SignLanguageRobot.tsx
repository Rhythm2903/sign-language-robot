// src/components/SignLanguageRobot.tsx
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  BookOpen, Languages, RefreshCw, Sparkles, Send,
  CheckCircle2, AlertCircle, Trophy, Target, TrendingUp, ChevronLeft,
  ChevronRight, BarChart2, Star, Zap, X
} from 'lucide-react';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { evaluateTargetSignScore, classifyStaticSign, Landmark } from '../lib/signClassifier';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface SessionStats {
  totalAttempts: number;
  successfulSigns: number;
  currentStreak: number;
  bestStreak: number;
  signsCompleted: string[];
  averageAccuracy: number;
  totalAccuracySum: number;
}

// ─── Full ASL Dictionary (A–Z + PEACE) ──────────────────────────────────────
const SIGN_DICTIONARY_IMAGES: Record<string, string> = {
  "ASL_A": "https://upload.wikimedia.org/wikipedia/commons/2/27/Sign_language_A.svg",
  "ASL_B": "https://upload.wikimedia.org/wikipedia/commons/1/18/Sign_language_B.svg",
  "ASL_C": "https://upload.wikimedia.org/wikipedia/commons/e/e3/Sign_language_C.svg",
  "ASL_D": "https://upload.wikimedia.org/wikipedia/commons/2/24/Sign_language_D.svg",
  "ASL_E": "https://upload.wikimedia.org/wikipedia/commons/0/0e/Sign_language_E.svg",
  "ASL_F": "https://upload.wikimedia.org/wikipedia/commons/c/c2/Sign_language_F.svg",
  "ASL_G": "https://upload.wikimedia.org/wikipedia/commons/6/61/Sign_language_G.svg",
  "ASL_H": "https://upload.wikimedia.org/wikipedia/commons/3/37/Sign_language_H.svg",
  "ASL_I": "https://upload.wikimedia.org/wikipedia/commons/6/6e/Sign_language_I.svg",
  "ASL_K": "https://upload.wikimedia.org/wikipedia/commons/7/7c/Sign_language_K.svg",
  "ASL_L": "https://upload.wikimedia.org/wikipedia/commons/d/d2/Sign_language_L.svg",
  "ASL_M": "https://upload.wikimedia.org/wikipedia/commons/5/5a/Sign_language_M.svg",
  "ASL_N": "https://upload.wikimedia.org/wikipedia/commons/1/18/Sign_language_N.svg",
  "ASL_O": "https://upload.wikimedia.org/wikipedia/commons/b/b7/Sign_language_O.svg",
  "ASL_R": "https://upload.wikimedia.org/wikipedia/commons/0/0f/Sign_language_R.svg",
  "ASL_S": "https://upload.wikimedia.org/wikipedia/commons/a/af/Sign_language_S.svg",
  "ASL_T": "https://upload.wikimedia.org/wikipedia/commons/5/59/Sign_language_T.svg",
  "ASL_U": "https://upload.wikimedia.org/wikipedia/commons/8/80/Sign_language_U.svg",
  "ASL_V": "https://upload.wikimedia.org/wikipedia/commons/d/d0/Sign_language_V.svg",
  "ASL_W": "https://upload.wikimedia.org/wikipedia/commons/1/15/Sign_language_W.svg",
  "ASL_X": "https://upload.wikimedia.org/wikipedia/commons/d/d8/Sign_language_X.svg",
  "ASL_Y": "https://upload.wikimedia.org/wikipedia/commons/b/b2/Sign_language_Y.svg",
  "ASL_Z": "https://upload.wikimedia.org/wikipedia/commons/d/d1/Sign_language_Z.svg",
  "PEACE_SIGN": "https://upload.wikimedia.org/wikipedia/commons/d/d0/Sign_language_V.svg",
};

const ALL_SIGNS = Object.keys(SIGN_DICTIONARY_IMAGES);

const SIGN_LABELS: Record<string, string> = {
  "PEACE_SIGN": "Peace / V",
  "ASL_V": "Letter V / Peace",
};
function signLabel(key: string): string {
  return SIGN_LABELS[key] ?? key.replace("ASL_", "Letter ");
}

const SIGN_IMAGE_SIZES = {
  sm: { className: 'h-9 w-9', width: 36, height: 36 },
  md: { className: 'h-10 w-10', width: 40, height: 40 },
  lg: { className: 'h-32 w-auto max-w-full', width: 128, height: 128 },
} as const;

function SignReferenceImage({
  signKey,
  size = 'md',
}: {
  signKey: string;
  size?: keyof typeof SIGN_IMAGE_SIZES;
}) {
  const src = SIGN_DICTIONARY_IMAGES[signKey];
  if (!src) return null;
  const { className, width, height } = SIGN_IMAGE_SIZES[size];
  return (
    <Image
      src={src}
      alt={signLabel(signKey)}
      width={width}
      height={height}
      className={`${className} object-contain`}
      unoptimized
    />
  );
}

// Map raw classifier output ("B", "PEACE") → dictionary key for image lookup
function classifiedToKey(raw: string): string | null {
  if (!raw || raw === 'Scanning...' || raw === 'No hand detected') return null;
  if (SIGN_DICTIONARY_IMAGES[`ASL_${raw}`]) return `ASL_${raw}`;
  if (raw === 'PEACE') return 'PEACE_SIGN';
  if (SIGN_DICTIONARY_IMAGES[raw]) return raw;
  return null;
}

// Gradient color based on accuracy score
function accuracyColor(score: number): string {
  if (score >= 90) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}
function accuracyBorderColor(score: number): string {
  if (score >= 90) return 'border-emerald-500/40 bg-emerald-500/10';
  if (score >= 60) return 'border-amber-500/40 bg-amber-500/10';
  return 'border-red-500/30 bg-red-500/10';
}

// ─── Scrolls messages to bottom ─────────────────────────────────────────────
function useChatScroll(dep: Message[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep]);
  return ref;
}

export default function SignLanguageRobot() {
  const [isMounted, setIsMounted] = useState(false);
  const [mode, setMode] = useState<'translation' | 'learning'>('translation');
  const [detectedSign, setDetectedSign] = useState('Initializing...');
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [currentChallengeSign, setCurrentChallengeSign] = useState('ASL_A');
  const [accuracyPercentage, setAccuracyPercentage] = useState(0);
  const [tutorFeedbackText, setTutorFeedbackText] = useState('Present your hand to the camera.');

  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  // Translation mode: accumulate detected signs
  const [translationBuffer, setTranslationBuffer] = useState<string[]>([]);
  const [lastAddedSign, setLastAddedSign] = useState('');
  const lastSignTime = useRef(0);

  // Session stats
  const [stats, setStats] = useState<SessionStats>({
    totalAttempts: 0,
    successfulSigns: 0,
    currentStreak: 0,
    bestStreak: 0,
    signsCompleted: [],
    averageAccuracy: 0,
    totalAccuracySum: 0,
  });

  // Auto-advance toggle
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [perfectHoldTimer, setPerfectHoldTimer] = useState(0);
  const perfectHoldRef = useRef(0);
  const perfectHoldInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const chatScrollRef = useChatScroll(messages);

  const modeRef = useRef(mode);
  const currentChallengeSignRef = useRef(currentChallengeSign);
  const accuracyPercentageRef = useRef(accuracyPercentage);
  const lastAddedSignRef = useRef(lastAddedSign);

  useEffect(() => {
    modeRef.current = mode;
    currentChallengeSignRef.current = currentChallengeSign;
    accuracyPercentageRef.current = accuracyPercentage;
    lastAddedSignRef.current = lastAddedSign;
  }, [mode, currentChallengeSign, accuracyPercentage, lastAddedSign]);

  const computeTrackingCoordinates = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !canvas || !landmarker || video.paused || video.ended) {
      requestAnimationFrame(computeTrackingCoordinates);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) { requestAnimationFrame(computeTrackingCoordinates); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const payload = landmarker.detectForVideo(video, performance.now());

    if (payload.landmarks?.length > 0) {
      const lm = payload.landmarks[0];
      const handMeta = payload.handedness?.[0]?.[0];
      const isLeft = handMeta
        ? handMeta.displayName === 'Left' || handMeta.categoryName === 'Left'
        : false;

      const accuracy = accuracyPercentageRef.current;

      // Draw skeleton connections — color based on accuracy
      const skelColor = accuracy >= 90
        ? 'rgba(16,185,129,0.7)'   // emerald for high accuracy
        : accuracy >= 60
          ? 'rgba(245,158,11,0.6)' // amber for medium
          : 'rgba(59,130,246,0.6)';// blue for low

      const CONNECTIONS = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [0,9],[9,10],[10,11],[11,12],
        [0,13],[13,14],[14,15],[15,16],
        [0,17],[17,18],[18,19],[19,20],
        [5,9],[9,13],[13,17],
      ];

      ctx.strokeStyle = skelColor;
      ctx.lineWidth = 2;
      for (const [a, b] of CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
        ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
        ctx.stroke();
      }

      // Draw nodes with glow — color matches skeleton
      const nodeColor = accuracy >= 90 ? '#34d399' : accuracy >= 60 ? '#fbbf24' : '#60a5fa';
      const nodeShadow = accuracy >= 90 ? '#10b981' : accuracy >= 60 ? '#f59e0b' : '#3b82f6';
      lm.forEach((node: Landmark, i: number) => {
        const isFingerTip = [4,8,12,16,20].includes(i);
        ctx.beginPath();
        ctx.arc(node.x * canvas.width, node.y * canvas.height, isFingerTip ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.shadowColor = nodeShadow;
        ctx.shadowBlur = isFingerTip ? 8 : 4;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      const classified = classifyStaticSign(lm, isLeft);
      setDetectedSign(classified || 'Scanning...');

      const result = evaluateTargetSignScore(lm, currentChallengeSignRef.current, isLeft);
      setAccuracyPercentage(result.score);
      setTutorFeedbackText(result.feedback);

      // Translation buffer: add stable sign every 2s
      if (modeRef.current === 'translation' && classified && classified !== 'Scanning...') {
        const now = Date.now();
        if (classified !== lastAddedSignRef.current && now - lastSignTime.current > 2000) {
          lastSignTime.current = now;
          setLastAddedSign(classified);
          setTranslationBuffer(prev => [...prev.slice(-19), classified]);
        }
      }
    } else {
      setDetectedSign('No hand detected');
      setAccuracyPercentage(0);
      setTutorFeedbackText('Bring your hand into the camera frame.');
    }

    requestAnimationFrame(computeTrackingCoordinates);
  }, []);

  const initializeCameraStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setDetectedSign('Camera not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video) return;

      video.srcObject = stream;

      const startTracking = () => {
        if (canvas && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        void video.play().catch((err) => {
          console.error(err);
          setDetectedSign('Could not start camera playback.');
        });
        computeTrackingCoordinates();
      };

      video.addEventListener('loadeddata', startTracking, { once: true });
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        startTracking();
      }
    } catch (err) {
      console.error(err);
      setDetectedSign('Camera permission denied or unavailable.');
    }
  }, [computeTrackingCoordinates]);

  const handleAutoAdvance = useCallback(() => {
    const idx = ALL_SIGNS.indexOf(currentChallengeSign);
    const nextSign = ALL_SIGNS[(idx + 1) % ALL_SIGNS.length];
    setCurrentChallengeSign(nextSign);
    setAccuracyPercentage(0);
    setStats(prev => {
      const newStreak = prev.currentStreak + 1;
      return {
        ...prev,
        totalAttempts: prev.totalAttempts + 1,
        successfulSigns: prev.successfulSigns + 1,
        currentStreak: newStreak,
        bestStreak: Math.max(prev.bestStreak, newStreak),
        signsCompleted: [...new Set([...prev.signsCompleted, currentChallengeSign])],
        totalAccuracySum: prev.totalAccuracySum + 100,
        averageAccuracy: Math.round((prev.totalAccuracySum + 100) / (prev.totalAttempts + 1)),
      };
    });
  }, [currentChallengeSign]);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!isMounted) return;
    let isCurrent = true;
    const videoElement = videoRef.current;

    async function loadVisionModels() {
      try {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const modelOptions = {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU" as const,
          },
          runningMode: "VIDEO" as const,
          numHands: 1,
        };

        let landmarker;
        try {
          landmarker = await HandLandmarker.createFromOptions(vision, modelOptions);
        } catch {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            ...modelOptions,
            baseOptions: { ...modelOptions.baseOptions, delegate: "CPU" },
          });
        }

        if (isCurrent) {
          landmarkerRef.current = landmarker;
          setIsModelLoaded(true);
          setDetectedSign('System Online. Show your hand.');
          void initializeCameraStream();
        }
      } catch (err) {
        console.error(err);
        setDetectedSign('WASM Engine Load Error');
      }
    }

    void loadVisionModels();
    return () => {
      isCurrent = false;
      const stream = videoElement?.srcObject;
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (videoElement) videoElement.srcObject = null;
    };
  }, [isMounted, initializeCameraStream]);

  // Perfect hold → auto advance
  useEffect(() => {
    if (mode !== 'learning' || !autoAdvance) return;

    if (accuracyPercentage === 100) {
      if (!perfectHoldInterval.current) {
        perfectHoldRef.current = 0;
        perfectHoldInterval.current = setInterval(() => {
          perfectHoldRef.current += 100;
          setPerfectHoldTimer(perfectHoldRef.current);
          if (perfectHoldRef.current >= 1500) {
            clearInterval(perfectHoldInterval.current!);
            perfectHoldInterval.current = null;
            setPerfectHoldTimer(0);
            handleAutoAdvance();
          }
        }, 100);
      }
    } else {
      if (perfectHoldInterval.current) {
        clearInterval(perfectHoldInterval.current);
        perfectHoldInterval.current = null;
      }
      setPerfectHoldTimer(0);
      perfectHoldRef.current = 0;
    }

    return () => {
      if (perfectHoldInterval.current) clearInterval(perfectHoldInterval.current);
    };
  }, [accuracyPercentage, mode, autoAdvance, handleAutoAdvance]);

  // Parse AI response — set first sign as challenge, return all refs for rendering
  const parseNextSignTarget = (text: string) => {
    const matches = [...text.matchAll(/\{([A-Z_]+)\}/g)];
    if (matches.length > 0 && SIGN_DICTIONARY_IMAGES[matches[0][1]]) {
      setCurrentChallengeSign(matches[0][1]);
      setAccuracyPercentage(0);
    }
  };

  // Render chat message content with inline sign reference images
  const renderMessageContent = (content: string) => {
    const parts = content.split(/(\{[A-Z_]+\})/g);
    return parts.map((part, i) => {
      const match = part.match(/^\{([A-Z_]+)\}$/);
      if (match && SIGN_DICTIONARY_IMAGES[match[1]]) {
        const key = match[1];
        return (
          <span key={i} className="inline-flex flex-col items-center mx-1 align-middle">
            <span className="bg-white rounded-lg p-0.5 inline-block">
              <SignReferenceImage signKey={key} size="md" />
            </span>
            <span className="text-[9px] text-blue-400 font-bold">{signLabel(key)}</span>
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const executeAiTurn = async (prompt: string) => {
    if (isLoadingAI) return;
    setIsLoadingAI(true);

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt, timestamp: Date.now() };
    const history = [...messages, userMsg];
    setMessages(history);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          contextMode: mode,
          performanceScore: `${accuracyPercentage}% Match — ${tutorFeedbackText}`,
          targetSign: currentChallengeSign,
          sessionStats: stats,
        }),
      });
      const data = (await res.json()) as { text?: string };
      if (!res.ok) {
        throw new Error(data.text ?? 'API request failed');
      }
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text ?? 'No response from AI.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);
      if (data.text) parseNextSignTarget(data.text);
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Network error — could not reach AI backend.',
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoadingAI(false);
    }
  };

  const submitTutorEvaluation = () => {
    const prompt = `[Sign Attempt: ${currentChallengeSign.replace('ASL_', '')} | Accuracy: ${accuracyPercentage}% | Feedback: ${tutorFeedbackText} | Streak: ${stats.currentStreak}]`;
    executeAiTurn(prompt);
    setStats(prev => {
      const accurate = accuracyPercentage >= 80;
      const newStreak = accurate ? prev.currentStreak + 1 : 0;
      const newSum = prev.totalAccuracySum + accuracyPercentage;
      const newAttempts = prev.totalAttempts + 1;
      return {
        ...prev,
        totalAttempts: newAttempts,
        successfulSigns: prev.successfulSigns + (accurate ? 1 : 0),
        currentStreak: newStreak,
        bestStreak: Math.max(prev.bestStreak, newStreak),
        signsCompleted: accurate ? [...new Set([...prev.signsCompleted, currentChallengeSign])] : prev.signsCompleted,
        totalAccuracySum: newSum,
        averageAccuracy: Math.round(newSum / newAttempts),
      };
    });
  };

  const navigateSign = (dir: 'prev' | 'next') => {
    const idx = ALL_SIGNS.indexOf(currentChallengeSign);
    const newIdx = dir === 'next'
      ? (idx + 1) % ALL_SIGNS.length
      : (idx - 1 + ALL_SIGNS.length) % ALL_SIGNS.length;
    setCurrentChallengeSign(ALL_SIGNS[newIdx]);
    setAccuracyPercentage(0);
  };

  const sendTranslationToAI = () => {
    if (!translationBuffer.length) return;
    const prompt = `Translate these detected ASL signs into a natural sentence: [${translationBuffer.join(', ')}]`;
    executeAiTurn(prompt);
    setTranslationBuffer([]);
    setLastAddedSign('');
  };

  if (!isMounted) {
    return (
      <div className="flex min-h-screen bg-slate-900 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-slate-400 text-sm">Initializing workspace...</p>
        </div>
      </div>
    );
  }

  const holdProgress = (perfectHoldTimer / 1500) * 100;
  const signIdx = ALL_SIGNS.indexOf(currentChallengeSign);

  return (
    <div className="flex flex-col min-h-screen bg-[#0b0f1a] text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight leading-none">ASL Robot</h1>
            <p className="text-[10px] text-slate-500 leading-none mt-0.5">AI Sign Language Assistant</p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 gap-1">
          <button
            onClick={() => setMode('translation')}
            className={`flex items-center px-4 py-2 rounded-lg text-xs font-semibold transition-all ${mode === 'translation' ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' : 'text-slate-400 hover:text-white'}`}
          >
            <Languages className="w-3.5 h-3.5 mr-1.5" /> Live Translation
          </button>
          <button
            onClick={() => setMode('learning')}
            className={`flex items-center px-4 py-2 rounded-lg text-xs font-semibold transition-all ${mode === 'learning' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' : 'text-slate-400 hover:text-white'}`}
          >
            <BookOpen className="w-3.5 h-3.5 mr-1.5" /> Learning Hub
          </button>
        </div>

        {/* Stats badge */}
        <div className="flex items-center gap-3">
          {stats.currentStreak > 1 && (
            <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-amber-400">{stats.currentStreak} streak</span>
            </div>
          )}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
            <Trophy className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-semibold text-slate-300">{stats.signsCompleted.length}/{ALL_SIGNS.length}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 p-5 grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

        {/* ── Left: Camera + Detection ── */}
        <div className="lg:col-span-2 flex flex-col gap-4">

          {/* Camera card */}
          <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
            <div className="relative bg-black aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
              />
              <canvas
                ref={canvasRef}
                width={640} height={480}
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1] z-10"
              />

              {/* Loading overlay */}
              {!isModelLoaded && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 gap-3">
                  <RefreshCw className="w-7 h-7 animate-spin text-blue-500" />
                  <p className="text-xs text-slate-400">Loading MediaPipe WASM engine...</p>
                </div>
              )}

              {/* Detection badge overlay */}
              {isModelLoaded && (
                <div className="absolute top-3 left-3 z-20">
                  <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur border border-slate-700 rounded-xl px-3 py-2 text-xs">
                    <div className={`w-2 h-2 rounded-full ${detectedSign === 'No hand detected' ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
                    <span className="text-slate-400">Detected:</span>
                    <span className="font-bold text-blue-400 ml-0.5">{detectedSign}</span>
                  </div>
                </div>
              )}

              {/* Detected sign image preview in translation mode */}
              {mode === 'translation' && (() => {
                const key = classifiedToKey(detectedSign);
                return key ? (
                  <div className="absolute top-3 right-3 z-20 bg-slate-950/80 backdrop-blur border border-slate-700 rounded-xl p-1.5 flex flex-col items-center gap-0.5">
                    <div className="bg-white rounded-lg p-0.5">
                      <SignReferenceImage signKey={key} size="sm" />
                    </div>
                    <span className="text-[9px] text-emerald-400 font-bold">{signLabel(key)}</span>
                  </div>
                ) : null;
              })()}
              {mode === 'learning' && autoAdvance && holdProgress > 0 && (
                <div className="absolute bottom-3 right-3 z-20">
                  <div className="w-12 h-12 relative">
                    <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="#1e293b" strokeWidth="4" />
                      <circle
                        cx="24" cy="24" r="20" fill="none"
                        stroke="#10b981" strokeWidth="4"
                        strokeDasharray={`${2 * Math.PI * 20}`}
                        strokeDashoffset={`${2 * Math.PI * 20 * (1 - holdProgress / 100)}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Translation buffer bar */}
            {mode === 'translation' && (
              <div className="p-3 border-t border-slate-800 flex items-center gap-3">
                <div className="flex-1 flex flex-wrap gap-1 min-h-[28px]">
                  {translationBuffer.length === 0
                    ? <span className="text-xs text-slate-600 italic">Signs will appear here as you gesture...</span>
                    : translationBuffer.map((s, i) => (
                      <span key={i} className="bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs font-bold px-2 py-0.5 rounded-lg">{s}</span>
                    ))
                  }
                </div>
                {translationBuffer.length > 0 && (
                  <button
                    onClick={sendTranslationToAI}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                  >
                    <Languages className="w-3.5 h-3.5" /> Translate
                  </button>
                )}
                {translationBuffer.length > 0 && (
                  <button onClick={() => { setTranslationBuffer([]); setLastAddedSign(''); }} className="text-slate-500 hover:text-slate-300 transition">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Stats row (learning mode) */}
          {mode === 'learning' && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Attempts', value: stats.totalAttempts, icon: <Target className="w-3.5 h-3.5" />, color: 'text-blue-400' },
                { label: 'Successful', value: stats.successfulSigns, icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-emerald-400' },
                { label: 'Best Streak', value: stats.bestStreak, icon: <Zap className="w-3.5 h-3.5" />, color: 'text-amber-400' },
                { label: 'Avg Accuracy', value: `${stats.averageAccuracy}%`, icon: <BarChart2 className="w-3.5 h-3.5" />, color: 'text-purple-400' },
              ].map(s => (
                <div key={s.label} className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                  <div className={`flex items-center justify-center gap-1 mb-1 ${s.color}`}>{s.icon}<span className="text-[10px] uppercase tracking-wide font-semibold">{s.label}</span></div>
                  <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right Column ── */}
        <div className="flex flex-col gap-4">

          {/* Learning mode: sign challenge card */}
          {mode === 'learning' && (
            <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Target Sign</h3>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-600">{signIdx + 1}/{ALL_SIGNS.length}</span>
                  <button
                    onClick={() => setAutoAdvance(a => !a)}
                    title="Auto-advance when perfect"
                    className={`ml-2 text-[10px] px-2 py-0.5 rounded-lg border font-semibold transition ${autoAdvance ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                  >
                    {autoAdvance ? 'Auto ✓' : 'Auto'}
                  </button>
                </div>
              </div>

              {/* Sign name + nav */}
              <div className="flex items-center justify-between">
                <button onClick={() => navigateSign('prev')} className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center hover:bg-slate-800 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center">
                  <div className="text-2xl font-black text-emerald-400">{signLabel(currentChallengeSign)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{currentChallengeSign}</div>
                </div>
                <button onClick={() => navigateSign('next')} className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center hover:bg-slate-800 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Reference image */}
              <div className="bg-white rounded-xl flex items-center justify-center min-h-[140px] overflow-hidden">
                {SIGN_DICTIONARY_IMAGES[currentChallengeSign] ? (
                  <SignReferenceImage signKey={currentChallengeSign} size="lg" />
                ) : (
                  <span className="text-slate-400 text-xs">No reference image</span>
                )}
              </div>

              {/* Accuracy bar */}
              <div className={`rounded-xl border p-3 ${accuracyBorderColor(accuracyPercentage)}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${accuracyColor(accuracyPercentage)}`}>
                    {accuracyPercentage >= 90
                      ? <CheckCircle2 className="w-4 h-4" />
                      : <AlertCircle className="w-4 h-4" />
                    }
                    <span>{accuracyPercentage}% Match</span>
                  </div>
                  {stats.signsCompleted.includes(currentChallengeSign) && (
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  )}
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${accuracyPercentage >= 90 ? 'bg-emerald-500' : accuracyPercentage >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${accuracyPercentage}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400 italic mt-1.5 text-center leading-snug">{tutorFeedbackText}</p>
              </div>

              {/* Sign progress dots */}
              <div className="flex flex-wrap gap-1 justify-center max-h-16 overflow-y-auto">
                {ALL_SIGNS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setCurrentChallengeSign(s); setAccuracyPercentage(0); }}
                    title={signLabel(s)}
                    className={`w-6 h-6 rounded text-[9px] font-bold transition-all ${
                      s === currentChallengeSign
                        ? 'bg-blue-600 text-white scale-110 shadow-md shadow-blue-600/30'
                        : stats.signsCompleted.includes(s)
                          ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                    }`}
                  >
                    {s.replace('ASL_', '').replace('PEACE_SIGN', '✌')}
                  </button>
                ))}
              </div>

              <button
                onClick={submitTutorEvaluation}
                disabled={isLoadingAI}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs py-3 rounded-xl transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2"
              >
                <TrendingUp className="w-4 h-4" />
                Submit Attempt & Get Feedback
              </button>
            </div>
          )}

          {/* Chat panel */}
          <div className="bg-slate-950 rounded-2xl border border-slate-800 flex flex-col" style={{ height: mode === 'learning' ? '340px' : '600px' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                  <Sparkles className="w-3 h-3 text-blue-400" />
                </div>
                <span className="text-xs font-semibold text-slate-300">ARIA — AI Tutor</span>
              </div>
              <div className={`w-2 h-2 rounded-full ${isLoadingAI ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            </div>

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
                  <div className="w-10 h-10 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-blue-400" />
                  </div>
                  <p className="text-xs text-slate-500 italic leading-relaxed">
                    {mode === 'learning'
                      ? "Ask ARIA for tips: \"Teach me ASL_L\" or submit your attempt above for instant AI feedback."
                      : "Gesture signs on camera — they'll auto-collect above. Hit Translate for a natural sentence, or ask me anything about ASL."}
                  </p>
                </div>
              )}

              {messages.map(m => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-bl-sm'
                  }`}>
                    {m.role === 'assistant' ? renderMessageContent(m.content) : m.content}
                  </div>
                </div>
              ))}

              {isLoadingAI && (
                <div className="flex justify-start">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2">
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    <span className="text-xs text-slate-400">ARIA is thinking...</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-800 p-3">
              <form
                onSubmit={e => { e.preventDefault(); if (chatInput.trim() && !isLoadingAI) { executeAiTurn(chatInput.trim()); setChatInput(''); } }}
                className="flex gap-2"
              >
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder={mode === 'learning' ? "Ask ARIA for a lesson or tip..." : "Ask anything about ASL..."}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-600 transition"
                />
                <button
                  type="submit"
                  disabled={isLoadingAI || !chatInput.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white p-2.5 rounded-xl transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>

              {/* Quick prompts */}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {(mode === 'learning'
                  ? [`Tips for ${signLabel(currentChallengeSign)}`, 'Give me a lesson plan', 'What\'s next to learn?']
                  : ['How does ASL work?', 'Teach me common phrases', 'Explain fingerspelling']
                ).map(q => (
                  <button
                    key={q}
                    onClick={() => { executeAiTurn(q); }}
                    disabled={isLoadingAI}
                    className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 px-2 py-1 rounded-lg transition disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
