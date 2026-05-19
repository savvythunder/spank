import { useState, useEffect, useRef, useCallback } from 'react';
import { Power, Activity, Volume2, VolumeX, Zap, TrendingUp, BarChart2, ChevronDown, ChevronUp, Gauge, Target, Flame, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { AUDIO_FILES, type AudioFile } from '@/audioManifest';

interface HitRecord {
  id: string;
  timestamp: number;
  magnitude: number;
  soundName: string;
  soundCategory: string;
}

interface UserConfig {
  sensitivity: number;
  selectedCategory: string;
  playbackSpeed: number;
  volumeScaling: boolean;
  fastMode: boolean;
  isMuted: boolean;
}

const CONFIG_KEY = 'spankweb_config';
const DECAY_HALF_LIFE = 30;
const COMBO_WINDOW_MS = 10_000;
const COMBO_THRESHOLD = 3;

const DEFAULT_CONFIG: UserConfig = {
  sensitivity: 3.0,
  selectedCategory: 'all',
  playbackSpeed: 1.0,
  volumeScaling: true,
  fastMode: false,
  isMuted: false,
};

function loadConfig(): UserConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_CONFIG;
}

export default function MotionTrigger() {
  const sounds = AUDIO_FILES;

  const [isActive, setIsActive] = useState(false);
  const [sensitivity, setSensitivity] = useState(() => [loadConfig().sensitivity]);
  const [selectedCategory, setSelectedCategory] = useState(() => loadConfig().selectedCategory);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => [loadConfig().playbackSpeed]);
  const [volumeScaling, setVolumeScaling] = useState(() => loadConfig().volumeScaling);
  const [fastMode, setFastMode] = useState(() => loadConfig().fastMode);
  const [isMuted, setIsMuted] = useState(() => loadConfig().isMuted);

  const [calibrating, setCalibrating] = useState(false);

  const [hits, setHits] = useState(0);
  const [hardestSlap, setHardestSlap] = useState(0);
  const [totalMagnitude, setTotalMagnitude] = useState(0);
  const [recentHits, setRecentHits] = useState<HitRecord[]>([]);
  const [currentMagnitude, setCurrentMagnitude] = useState(0);
  const [peakMagnitude, setPeakMagnitude] = useState(0);
  const [lastFlash, setLastFlash] = useState<{ name: string; category: string } | null>(null);
  const [comboFlash, setComboFlash] = useState<{ count: number; key: number } | null>(null);

  const audioBufferCache = useRef<Record<string, AudioBuffer>>({});
  const lastHitTime = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const slapScore = useRef(0);
  const lastSlapTime = useRef(0);
  const hitTimestamps = useRef<number[]>([]);
  const deckRef = useRef<Map<string, AudioFile[]>>(new Map());
  const lastPlayedUrl = useRef<Map<string, string>>(new Map());

  const { toast } = useToast();

  const cooldownMs = fastMode ? 350 : 1000;

  // Persist config whenever settings change
  useEffect(() => {
    try {
      const config: UserConfig = {
        sensitivity: sensitivity[0],
        selectedCategory,
        playbackSpeed: playbackSpeed[0],
        volumeScaling,
        fastMode,
        isMuted,
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {}
  }, [sensitivity, selectedCategory, playbackSpeed, volumeScaling, fastMode, isMuted]);

  const drawFromDeck = useCallback((key: string, pool: AudioFile[]): AudioFile => {
    let deck = deckRef.current.get(key);
    if (!deck || deck.length === 0) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const last = lastPlayedUrl.current.get(key);
      if (last && shuffled.length > 1 && shuffled[shuffled.length - 1].download_url === last) {
        const swapIdx = Math.floor(Math.random() * (shuffled.length - 1));
        const tmp = shuffled[shuffled.length - 1];
        shuffled[shuffled.length - 1] = shuffled[swapIdx];
        shuffled[swapIdx] = tmp;
      }
      deck = shuffled;
    }
    const pick = deck.pop()!;
    deckRef.current.set(key, deck);
    lastPlayedUrl.current.set(key, pick.download_url);
    return pick;
  }, []);

  const initAudioContext = () => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }
  };

  const playSound = useCallback(async (soundFile: AudioFile, magnitude: number) => {
    if (isMuted) return;
    initAudioContext();
    const ctx = audioContext.current;
    if (!ctx) return;

    try {
      let buffer = audioBufferCache.current[soundFile.download_url];
      if (!buffer) {
        const res = await fetch(soundFile.download_url);
        const arrayBuffer = await res.arrayBuffer();
        buffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferCache.current[soundFile.download_url] = buffer;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackSpeed[0];

      if (volumeScaling) {
        const gainNode = ctx.createGain();
        const threshold = sensitivity[0];
        const t = Math.min(1, Math.log(1 + Math.max(0, magnitude - threshold) * 10) / Math.log(101));
        gainNode.gain.value = 0.2 + t * 0.8;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
      } else {
        source.connect(ctx.destination);
      }

      source.start();
      setLastFlash({ name: soundFile.name, category: soundFile.category });
      setTimeout(() => setLastFlash(null), 300);
    } catch (err) {
      console.error('Failed to play sound', err);
    }
  }, [playbackSpeed, volumeScaling, sensitivity, isMuted]);

  const triggerHit = useCallback((magnitude: number) => {
    const now = Date.now();
    if (now - lastHitTime.current < cooldownMs) return;
    lastHitTime.current = now;

    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate(80);

    // Combo detection — rolling window
    hitTimestamps.current.push(now);
    hitTimestamps.current = hitTimestamps.current.filter(t => now - t <= COMBO_WINDOW_MS);
    const comboCount = hitTimestamps.current.length;
    if (comboCount >= COMBO_THRESHOLD) {
      setComboFlash({ count: comboCount, key: now });
      setTimeout(() => setComboFlash(null), 900);
    }

    // Escalation score
    const elapsed = (now - lastSlapTime.current) / 1000;
    slapScore.current *= Math.pow(0.5, elapsed / DECAY_HALF_LIFE);
    slapScore.current += 1.0;
    lastSlapTime.current = now;

    let filteredSounds = sounds;
    if (selectedCategory !== 'all') {
      filteredSounds = sounds.filter(s => s.category === selectedCategory);
    }

    let soundToPlay: AudioFile | null = null;
    const isEscalation = selectedCategory === 'sexy' || selectedCategory === 'lizard';

    if (filteredSounds.length > 0) {
      if (isEscalation) {
        const N = filteredSounds.length;
        const cooldownSec = cooldownMs / 1000;
        const ssMax = 1.0 / (1.0 - Math.pow(0.5, cooldownSec / DECAY_HALF_LIFE));
        const scale = (ssMax - 1) / Math.log(N + 1);
        const idx = Math.min(
          Math.floor(N * (1.0 - Math.exp(-(slapScore.current - 1) / scale))),
          N - 1
        );
        soundToPlay = filteredSounds[idx];
      } else {
        soundToPlay = drawFromDeck(selectedCategory, filteredSounds);
      }
      playSound(soundToPlay, magnitude);
    }

    setHits(h => h + 1);
    setHardestSlap(prev => Math.max(prev, magnitude));
    setTotalMagnitude(prev => prev + magnitude);
    setRecentHits(prev => [
      { id: Math.random().toString(36).substr(2, 9), timestamp: now, magnitude, soundName: soundToPlay?.name || 'Unknown', soundCategory: soundToPlay?.category || '' },
      ...prev,
    ].slice(0, 5));
  }, [selectedCategory, sounds, cooldownMs, playSound, drawFromDeck]);

  const handleDeviceMotion = useCallback((event: DeviceMotionEvent) => {
    if (!isActive) return;
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc) return;
    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;
    const mag = Math.sqrt(x * x + y * y + z * z);
    setCurrentMagnitude(prev => prev * 0.8 + mag * 0.2);
    setPeakMagnitude(prev => (mag > prev ? mag : prev * 0.99));
    if (mag > sensitivity[0]) triggerHit(mag);
  }, [isActive, sensitivity, triggerHit]);

  useEffect(() => {
    if (isActive) {
      window.addEventListener('devicemotion', handleDeviceMotion);
    } else {
      window.removeEventListener('devicemotion', handleDeviceMotion);
      setCurrentMagnitude(0);
      setPeakMagnitude(0);
    }
    return () => window.removeEventListener('devicemotion', handleDeviceMotion);
  }, [isActive, handleDeviceMotion]);

  const togglePower = async () => {
    if (!isActive) {
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        try {
          const state = await (DeviceMotionEvent as any).requestPermission();
          if (state !== 'granted') {
            toast({ title: 'Permission Denied', description: 'Motion permission is required to detect hits.', variant: 'destructive' });
            return;
          }
        } catch (e) {
          console.error(e);
        }
      }
      initAudioContext();
    } else {
      setHits(0);
      setHardestSlap(0);
      setTotalMagnitude(0);
      setRecentHits([]);
      hitTimestamps.current = [];
    }
    setIsActive(prev => !prev);
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (next) {
      audioContext.current?.suspend();
    } else {
      audioContext.current?.resume();
    }
  };

  const startCalibration = async () => {
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const state = await (DeviceMotionEvent as any).requestPermission();
        if (state !== 'granted') {
          toast({ title: 'Permission Denied', description: 'Motion permission needed for calibration.', variant: 'destructive' });
          return;
        }
      } catch (e) {
        console.error(e);
      }
    }

    setCalibrating(true);
    const samples: number[] = [];

    const listener = (event: DeviceMotionEvent) => {
      const acc = event.acceleration || event.accelerationIncludingGravity;
      if (!acc) return;
      samples.push(Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2));
    };

    window.addEventListener('devicemotion', listener);

    setTimeout(() => {
      window.removeEventListener('devicemotion', listener);
      setCalibrating(false);
      if (samples.length > 0) {
        const maxAmbient = Math.max(...samples);
        const newThreshold = parseFloat(Math.max(0.5, maxAmbient * 2.0).toFixed(1));
        setSensitivity([newThreshold]);
        toast({ title: 'Calibrated', description: `Threshold set to ${newThreshold}G based on ambient motion.` });
      } else {
        toast({ title: 'No sensor data', description: 'Device motion sensor may not be available.', variant: 'destructive' });
      }
    }, 2000);
  };

  const handleManualSlap = () => triggerHit(sensitivity[0] + 1);

  const handleFastModeToggle = (checked: boolean) => {
    setFastMode(checked);
    if (checked && sensitivity[0] < 2.0) setSensitivity([3.0]);
  };

  const getDisplayName = (filename: string, category: string): string => {
    if (category !== 'pain') return filename.replace(/\.[^/.]+$/, '');
    return filename.replace(/\.[^/.]+$/, '').replace(/^\d+_/, '').replace(/_/g, ' ');
  };

  const meterPercent = Math.min(100, (currentMagnitude / 15) * 100);
  const peakPercent = Math.min(100, (peakMagnitude / 15) * 100);
  const avgMagnitude = hits > 0 ? totalMagnitude / hits : 0;
  const categories = ['all', ...Array.from(new Set(sounds.map(s => s.category)))];
  const selectedCategoryCount = selectedCategory === 'all' ? sounds.length : sounds.filter(s => s.category === selectedCategory).length;
  const isEscalation = selectedCategory === 'sexy' || selectedCategory === 'lizard';

  let escalationPercent = 0;
  if (isEscalation && selectedCategoryCount > 0) {
    const N = selectedCategoryCount;
    const cMs = fastMode ? 350 : 1000;
    const ssMax = 1.0 / (1.0 - Math.pow(0.5, (cMs / 1000) / DECAY_HALF_LIFE));
    const scale = (ssMax - 1) / Math.log(N + 1);
    const now = Date.now();
    const elapsed = (now - lastSlapTime.current) / 1000;
    const currentScore = slapScore.current * Math.pow(0.5, elapsed / DECAY_HALF_LIFE);
    escalationPercent = Math.min(100, Math.max(0, (currentScore / ssMax) * 100));
  }

  return (
    <div className="relative min-h-[100dvh] bg-background text-foreground overflow-hidden">
      <div className="absolute inset-0 pointer-events-none animate-radial-pulse" />
      <div className="absolute inset-0 pointer-events-none scanline opacity-[0.03]" />

      {/* Sound name flash */}
      <AnimatePresence>
        {lastFlash && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center border-4 border-primary"
          >
            <h1 className="text-[10vw] font-black text-primary drop-shadow-[0_0_20px_rgba(255,0,255,0.8)] uppercase bg-background/80 px-8 py-4 rounded text-center">
              {getDisplayName(lastFlash.name, lastFlash.category)}
            </h1>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Combo flash */}
      <AnimatePresence>
        {comboFlash && (
          <motion.div
            key={comboFlash.key}
            initial={{ opacity: 1, y: 0, scale: 1.1 }}
            animate={{ opacity: 0, y: -20, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            className="fixed bottom-36 left-0 right-0 pointer-events-none z-40 flex justify-center"
          >
            <div className="flex items-center gap-2 bg-background/85 px-6 py-3 rounded-full border-2 border-yellow-400 shadow-[0_0_24px_rgba(250,204,21,0.5)]">
              <Flame className="w-5 h-5 text-yellow-400" />
              <span className="text-yellow-400 font-black text-xl uppercase tracking-widest">
                Combo x{comboFlash.count}
              </span>
              <Flame className="w-5 h-5 text-yellow-400" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.main
        className="relative z-10 flex-1 container max-w-lg mx-auto p-6 flex flex-col gap-5 pb-20"
        animate={lastFlash ? { x: [-5, 5, -5, 5, 0], y: [-5, 5, -5, 5, 0] } : {}}
        transition={{ duration: 0.2 }}
      >
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-black uppercase tracking-wider text-xl">
            <Activity className="w-6 h-6" />
            <span>SpankWeb</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              className={`w-10 h-10 rounded-full transition-all ${isMuted ? 'border-muted-foreground/30 text-muted-foreground' : 'border-primary/50 text-primary hover:bg-primary/20'}`}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>
            <Button
              size="icon"
              variant={isActive ? 'default' : 'outline'}
              onClick={togglePower}
              data-testid="power-btn"
              className={`w-14 h-14 rounded-full transition-all duration-300 ${isActive ? 'bg-primary text-primary-foreground shadow-[0_0_20px_rgba(255,0,255,0.6)] scale-110' : 'border-primary/50 text-primary hover:bg-primary/20'}`}
            >
              <Power className="w-6 h-6" />
            </Button>
          </div>
        </header>

        {/* Hit counter */}
        <div className="flex flex-col items-center justify-center py-4">
          <motion.div
            key={hits}
            initial={{ scale: 1.3, color: 'var(--primary)', textShadow: '0 0 20px hsl(var(--primary))' }}
            animate={{ scale: 1, color: 'var(--foreground)', textShadow: '0 0 0px transparent' }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="text-[10rem] leading-none font-black tabular-nums tracking-tighter"
          >
            {hits.toString().padStart(3, '0')}
          </motion.div>
          <div className="text-muted-foreground lowercase tracking-normal text-xs font-bold -mt-2">total impacts</div>
        </div>

        {/* Motion meter */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span>Motion</span>
            <span className={currentMagnitude > sensitivity[0] * 0.6 ? 'text-primary' : ''}>
              {currentMagnitude.toFixed(1)} G
            </span>
          </div>
          <div className="h-6 bg-secondary/50 rounded-full overflow-hidden border border-border relative">
            <motion.div
              className={`h-full meter-gradient ${currentMagnitude > 0 ? 'shadow-[0_0_10px_rgba(255,0,255,0.5)]' : ''}`}
              animate={{ width: `${meterPercent}%` }}
              transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
            />
            <motion.div
              className="absolute top-0 bottom-0 w-0.5 bg-primary/80 z-10"
              animate={{ left: `${peakPercent}%` }}
              transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
            />
          </div>
          <div className="flex justify-between text-[10px] uppercase text-muted-foreground/60 font-mono px-1">
            <span>Low</span>
            <span>Medium</span>
            <span>High</span>
          </div>
        </div>

        {/* Session stats */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono text-muted-foreground bg-secondary/30 p-2 rounded-lg border border-border/50">
          <div className="flex flex-col items-center">
            <span className="uppercase text-[10px] opacity-70 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Peak</span>
            <span className="text-foreground">{hardestSlap.toFixed(1)}G</span>
          </div>
          <div className="flex flex-col items-center border-l border-r border-border/50">
            <span className="uppercase text-[10px] opacity-70 flex items-center gap-1"><Activity className="w-3 h-3" /> Avg</span>
            <span className="text-foreground">{avgMagnitude.toFixed(1)}G</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="uppercase text-[10px] opacity-70 flex items-center gap-1"><BarChart2 className="w-3 h-3" /> Hits</span>
            <span className="text-foreground">{hits}</span>
          </div>
        </div>

        {/* Controls card */}
        <Card className="border-primary/30 bg-card/50 backdrop-blur p-4">
          <div className="space-y-6">

            {/* Threshold + calibrate */}
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm font-bold uppercase tracking-wider">
                <Activity className="w-4 h-4 text-primary" />
                <div className="flex-1 flex items-center gap-4">
                  <span>Threshold</span>
                  <div className="h-[1px] flex-1 bg-border/50" />
                  <span className="text-primary text-base">{sensitivity[0].toFixed(1)}</span>
                </div>
              </div>
              <Slider value={sensitivity} onValueChange={setSensitivity} min={0.5} max={10.0} step={0.1} />
              <div className="flex items-center justify-between px-1">
                <div className="flex justify-between text-[10px] uppercase text-muted-foreground/60 font-mono flex-1">
                  <span>Low</span>
                  <span>Med</span>
                  <span>High</span>
                </div>
                <button
                  onClick={startCalibration}
                  disabled={calibrating}
                  className="ml-4 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors disabled:opacity-40 shrink-0"
                >
                  {calibrating
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> 2s...</>
                    : <><Target className="w-3 h-3" /> Calibrate</>}
                </button>
              </div>
            </div>

            {/* Advanced panel */}
            <div className="pt-2 border-t border-border/50">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between text-sm font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                data-testid="advanced-toggle"
              >
                <span className="flex items-center gap-2"><Gauge className="w-4 h-4" /> Advanced</span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-4 space-y-6 pb-2">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center text-xs font-bold uppercase">
                          <span>Speed</span>
                          <span className="text-primary">{playbackSpeed[0].toFixed(2)}x</span>
                        </div>
                        <Slider value={playbackSpeed} onValueChange={setPlaybackSpeed} min={0.5} max={2.0} step={0.05} />
                        <div className="text-[10px] text-muted-foreground text-center">
                          &lt; 1.0 deeper &middot; &gt; 1.0 higher pitch
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold uppercase">Volume Scaling</div>
                          <div className="text-[10px] text-muted-foreground">Louder on harder hits</div>
                        </div>
                        <Switch checked={volumeScaling} onCheckedChange={setVolumeScaling} data-testid="volume-switch" />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold uppercase">Fast Mode</div>
                          <div className="text-[10px] text-muted-foreground">Shorter cooldown, higher sensitivity</div>
                        </div>
                        <Switch checked={fastMode} onCheckedChange={handleFastModeToggle} data-testid="fastmode-switch" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Audio category */}
            <div className="space-y-3 pt-4 border-t border-border/50">
              <label className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-primary" /> Audio Category
              </label>
              <div className="flex overflow-x-auto pb-2 gap-2 snap-x scrollbar-hide -mx-2 px-2">
                {categories.map((cat, i) => (
                  <motion.button
                    key={cat}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => setSelectedCategory(cat)}
                    className={`shrink-0 snap-start px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all border ${
                      selectedCategory === cat
                        ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_10px_rgba(255,0,255,0.4)]'
                        : 'bg-secondary/50 text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {cat}
                  </motion.button>
                ))}
              </div>
              <div className="bg-background/50 border border-border/50 rounded-lg p-3 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div className="font-black text-lg uppercase tracking-widest text-primary/90">{selectedCategory}</div>
                  <div className="text-xs font-mono text-muted-foreground bg-secondary/50 px-2 py-1 rounded">{selectedCategoryCount} clips</div>
                </div>
                {isEscalation && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-bold uppercase text-muted-foreground">
                      <span>Intensity</span>
                      <span className="text-primary">{Math.round(escalationPercent)}%</span>
                    </div>
                    <div className="h-1.5 bg-secondary/50 rounded-full overflow-hidden border border-border">
                      <div
                        className="h-full bg-primary transition-all duration-300 shadow-[0_0_8px_rgba(255,0,255,0.6)]"
                        style={{ width: `${escalationPercent}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-center text-muted-foreground/60 uppercase pt-1">
                      Slap more to escalate / 30s decay
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </Card>

        {/* Force Slap button */}
        <Button
          onClick={handleManualSlap}
          variant="outline"
          className="h-24 text-2xl font-black uppercase tracking-tight border-2 border-primary/50 text-primary bg-gradient-to-t from-primary/10 to-transparent hover:bg-primary hover:text-primary-foreground transition-all active:scale-95 animate-glow-pulse"
        >
          <Zap className="w-6 h-6 mr-2 animate-pulse" /> Force Slap
        </Button>

        {/* Hit log */}
        {recentHits.length > 0 && (
          <div className="space-y-3 mt-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-2">Recent Logs</h3>
            <div className="space-y-2">
              <AnimatePresence>
                {recentHits.map(hit => (
                  <motion.div
                    key={hit.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex justify-between items-center text-[10px] font-mono bg-secondary/30 p-2 rounded border border-border/50"
                  >
                    <span className="text-muted-foreground/70">{new Date(hit.timestamp).toISOString().split('T')[1].slice(0, -1)}</span>
                    <span className="text-primary/80 truncate max-w-[150px] uppercase">{getDisplayName(hit.soundName, hit.soundCategory)}</span>
                    <span className="text-foreground/80">{hit.magnitude.toFixed(2)} G</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

      </motion.main>
    </div>
  );
}
