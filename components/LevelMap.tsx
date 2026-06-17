import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star, Lock, Play, ChevronLeft, Zap, Target, Layers } from 'lucide-react';
import { Level } from '../types';

interface LevelMapProps {
  levels: Level[];
  onSelectLevel: (level: Level) => void;
  onBack: () => void;
}

const LevelMap: React.FC<LevelMapProps> = ({ levels, onSelectLevel, onBack }) => {
  const [selectedLevelInfo, setSelectedLevelInfo] = useState<Level | null>(null);

  const stars = useMemo(() => {
    return [...Array(70)].map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 200,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.7 + 0.1,
      twinkleDelay: Math.random() * 6,
      twinkleDuration: 3 + Math.random() * 4
    }));
  }, []);

  const pathData = useMemo(() => {
    const n = levels.length;
    if (n === 0) return '';
    const totalHeight = n * 132 + 160;
    return Array.from({ length: n }, (_, i) => {
      const isEven = i % 2 === 0;
      const x = isEven ? 90.5 : 9.5;
      const y = ((50 + i * 132) / totalHeight) * 100;
      const prevX = i === 0 ? 50 : (i - 1) % 2 === 0 ? 90.5 : 9.5;
      const prevY = i === 0 ? 0 : ((50 + (i - 1) * 132) / totalHeight) * 100;
      const cpY1 = prevY + (y - prevY) * 0.5;
      const cpY2 = y - (y - prevY) * 0.5;
      return `C ${prevX} ${cpY1}, ${x} ${cpY2}, ${x} ${y}`;
    }).join(' ');
  }, [levels.length]);

  const currentLevelId = useMemo(
    () => levels.find(l => !l.completed)?.id ?? levels[levels.length - 1]?.id,
    [levels]
  );

  return (
    <div className="w-full h-screen bg-[#050505] text-white overflow-y-auto relative scroll-smooth scrollbar-hide">
      <div className="absolute inset-0 pointer-events-none">
        {stars.map(star => (
          <motion.div
            key={star.id}
            animate={{
              opacity: [star.opacity, star.opacity * 0.2, star.opacity],
              scale: [1, 1.2, 1]
            }}
            transition={{
              duration: star.twinkleDuration,
              repeat: Infinity,
              delay: star.twinkleDelay,
              ease: "easeInOut"
            }}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
            }}
          />
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12 relative z-10">
        <div className="flex items-center justify-between mb-16">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-white/5 backdrop-blur-md"
          >
            <ChevronLeft size={24} />
          </motion.button>
          <div className="text-center">
            <h1 className="text-5xl font-black tracking-tighter bg-gradient-to-b from-white via-white to-slate-500 text-transparent bg-clip-text drop-shadow-2xl">
              GALAXY MAP
            </h1>
            <p className="text-emerald-500 text-[10px] tracking-[0.4em] uppercase font-black mt-1">Sector: Gemini Core</p>
          </div>
          <div className="w-12 h-12" />
        </div>

        <div className="relative flex flex-col items-center gap-8 pb-48">
          <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <motion.path
              d={pathData ? `M 50 0 ${pathData}` : ''}
              fill="none"
              stroke="rgba(255, 255, 255, 0.5)"
              strokeWidth="0.5"
              strokeDasharray="1 2.5"
              strokeLinecap="round"
              animate={{ strokeDashoffset: [0, -3.5], opacity: [0.4, 0.7, 0.4] }}
              transition={{
                strokeDashoffset: { duration: 1, repeat: Infinity, ease: "linear" },
                opacity: { duration: 2, repeat: Infinity, ease: "easeInOut" }
              }}
            />
          </svg>

          {levels.map((level, index) => {
            const isEven = index % 2 === 0;
            const isCurrent = level.id === currentLevelId;
            return (
              <motion.div
                key={level.id}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-50px" }}
                className={`relative flex items-center w-full ${isEven ? 'justify-end pr-8' : 'justify-start pl-8'}`}
                style={{ height: '100px', contentVisibility: 'auto' }}
              >
                <div className={`flex items-center gap-6 ${isEven ? 'flex-row' : 'flex-row-reverse'}`}>
                  <div className={`flex flex-col ${isEven ? 'items-end' : 'items-start'} max-w-[120px]`}>
                    <span className="text-[8px] font-black text-emerald-500/50 uppercase tracking-widest mb-0.5">Level {level.id}</span>
                    <h3 className="text-sm font-black text-white leading-tight mb-1 truncate w-full text-center">{level.name}</h3>
                    <div className="flex items-center gap-0.5">
                      {[...Array(3)].map((_, i) => (
                        <Star
                          key={i}
                          size={12}
                          className={i < level.stars ? "text-yellow-400 fill-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.4)]" : "text-white/5"}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="relative">
                    {isCurrent && (
                      <motion.div
                        layoutId="player-avatar"
                        className="absolute -top-10 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center"
                      >
                        <div className="bg-emerald-500 text-black p-1 rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-bounce">
                          <Zap size={12} fill="currentColor" />
                        </div>
                        <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-emerald-500" />
                      </motion.div>
                    )}
                    <motion.button
                      whileHover={level.unlocked ? { scale: 1.1, rotate: 5 } : {}}
                      whileTap={level.unlocked ? { scale: 0.95 } : {}}
                      disabled={!level.unlocked}
                      onClick={() => setSelectedLevelInfo(level)}
                      className={`
                        relative w-16 h-16 rounded-[24px] flex items-center justify-center transition-all duration-500
                        ${level.unlocked
                          ? 'bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] border border-white/10 shadow-xl cursor-pointer'
                          : 'bg-[#0a0a0a] border border-white/5 opacity-40 cursor-not-allowed'}
                        ${level.completed ? 'border-emerald-500/50' : ''}
                        ${isCurrent ? 'border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.2)]' : ''}
                      `}
                    >
                      {!level.unlocked ? (
                        <Lock size={20} className="text-slate-700" />
                      ) : (
                        <div className="flex flex-col items-center">
                          <span className={`text-xl font-black ${level.completed ? 'text-emerald-400' : 'text-white'}`}>
                            {level.id}
                          </span>
                        </div>
                      )}
                      {level.unlocked && !level.completed && (
                        <div className="absolute -inset-2 rounded-[28px] border border-emerald-500/20 animate-pulse" />
                      )}
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {selectedLevelInfo && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLevelInfo(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#111] rounded-[40px] border border-white/10 overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className="text-xs font-black text-emerald-500 uppercase tracking-widest">Sector {selectedLevelInfo.id}</span>
                    <h2 className="text-4xl font-black text-white tracking-tighter">{selectedLevelInfo.name}</h2>
                  </div>
                  <div className="flex gap-1">
                    {[...Array(3)].map((_, i) => (
                      <Star
                        key={i}
                        size={20}
                        className={i < selectedLevelInfo.stars ? "text-yellow-400 fill-yellow-400" : "text-white/10"}
                      />
                    ))}
                  </div>
                </div>
                <p className="text-slate-400 text-lg mb-8 leading-relaxed">
                  {selectedLevelInfo.description}
                </p>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="flex items-center gap-2 text-slate-500 mb-1">
                      <Target size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Target</span>
                    </div>
                    <div className="text-xl font-black text-white">{selectedLevelInfo.targetScore.toLocaleString()}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="flex items-center gap-2 text-slate-500 mb-1">
                      <Layers size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Difficulty</span>
                    </div>
                    <div className="text-xl font-black text-white">{selectedLevelInfo.difficulty}/10</div>
                  </div>
                </div>
                {(selectedLevelInfo.timeLimit != null || selectedLevelInfo.targetCombo != null || selectedLevelInfo.allowBomb !== false || selectedLevelInfo.allowFire !== false) && (
                  <div className="flex flex-wrap items-center gap-3 mb-8 text-sm">
                    {selectedLevelInfo.timeLimit != null && (
                      <span className="bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-xl border border-amber-500/20 font-bold">
                        Time: {selectedLevelInfo.timeLimit}s
                      </span>
                    )}
                    {selectedLevelInfo.targetCombo != null && (
                      <span className="bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-xl border border-blue-500/20 font-bold">
                        Combo: {selectedLevelInfo.targetCombo}+
                      </span>
                    )}
                    {selectedLevelInfo.allowBomb !== false && (
                      <span className="bg-slate-500/10 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-500/20" title="Bomb">
                        💣 Bomb
                      </span>
                    )}
                    {selectedLevelInfo.allowFire !== false && (
                      <span className="bg-orange-500/10 text-orange-400 px-3 py-1.5 rounded-xl border border-orange-500/20" title="Fire">
                        🔥 Fire
                      </span>
                    )}
                  </div>
                )}
                <div className="flex gap-4">
                  <button
                    onClick={() => setSelectedLevelInfo(null)}
                    className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold transition-all"
                  >
                    BACK
                  </button>
                  <button
                    onClick={() => onSelectLevel(selectedLevelInfo)}
                    className="flex-[2] py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-lg transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                  >
                    <Play size={20} fill="currentColor" /> START MISSION
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-50">
        <div className="max-w-2xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
              <Zap size={24} />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-black tracking-[0.2em]">Total Stars</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-white">
                  {levels.reduce((acc, l) => acc + l.stars, 0)}
                </span>
                <span className="text-slate-600 font-bold">/ {levels.length * 3}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <p className="text-[10px] text-slate-500 uppercase font-black tracking-[0.2em] mb-1">Progress</p>
            <div className="flex items-center gap-3">
              <div className="w-32 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(levels.filter(l => l.completed).length / levels.length) * 100}%` }}
                  className="h-full bg-emerald-500"
                />
              </div>
              <span className="text-sm font-black text-white">
                {Math.round((levels.filter(l => l.completed).length / levels.length) * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LevelMap;
