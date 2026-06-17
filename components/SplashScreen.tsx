import React, { useEffect } from 'react';
import { motion } from 'motion/react';

interface SplashScreenProps {
  onFinish: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 3500);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex flex-col items-center justify-center overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0, 1, 0],
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
            }}
            transition={{
              duration: 2 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 2,
            }}
            className="absolute w-1 h-1 bg-white rounded-full"
          />
        ))}
      </div>

      <div className="relative flex flex-col items-center">
        <motion.div
          initial={{ y: 100, opacity: 0, scale: 0.5 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{
            type: 'spring',
            damping: 12,
            stiffness: 100,
            duration: 1,
          }}
          className="relative z-10"
        >
          <div className="relative">
            <motion.div
              animate={{
                rotate: [0, 360],
                scale: [1, 1.1, 1],
              }}
              transition={{
                duration: 10,
                repeat: Infinity,
                ease: 'linear',
              }}
              className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full"
            />
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white via-emerald-400 to-emerald-900 italic">
              COSMIC
            </h1>
          </div>
        </motion.div>

        <motion.div
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="mt-[-10px] z-20"
        >
          <h2 className="text-4xl md:text-6xl font-black tracking-[0.3em] text-white uppercase">
            SLINGSHOT
          </h2>
        </motion.div>

        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="h-1 w-48 bg-emerald-500 mt-4 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.5)]"
        />
      </div>

      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[
          { color: '#ef4444', delay: 1.0, path: { x: [-100, 200, 150, 1200], y: [200, 300, 250, -200] } },
          { color: '#3b82f6', delay: 1.1, path: { x: [1200, 800, 850, -200], y: [100, 400, 350, 1000] } },
          { color: '#10b981', delay: 1.2, path: { x: [-100, 400, 380, 1200], y: [800, 500, 520, 300] } },
          { color: '#f59e0b', delay: 1.3, path: { x: [1200, 600, 620, -200], y: [800, 200, 220, 500] } },
          { color: '#a855f7', delay: 1.4, path: { x: [500, 500, 520, 500], y: [-100, 400, 380, 1200] } },
          { color: '#ec4899', delay: 1.5, path: { x: [-100, 300, 320, 1200], y: [100, 600, 580, 400] } },
          { color: '#06b6d4', delay: 1.6, path: { x: [1200, 200, 250, -200], y: [500, 100, 120, 800] } },
          { color: '#84cc16', delay: 1.7, path: { x: [200, 800, 780, 100], y: [1200, 400, 420, -200] } },
          { color: '#f97316', delay: 1.8, path: { x: [-200, 500, 480, 1200], y: [400, 400, 420, 400] } },
          { color: '#6366f1', delay: 1.9, path: { x: [1200, 400, 420, -200], y: [200, 800, 780, 100] } },
          { color: '#14b8a6', delay: 2.0, path: { x: [-100, 1000, 980, 1200], y: [600, 200, 220, 0] } },
          { color: '#f43f5e', delay: 2.1, path: { x: [600, 600, 620, 600], y: [1200, 300, 320, -100] } },
        ].map((ball, i) => (
          <motion.div
            key={i}
            initial={{
              x: ball.path.x[0],
              y: ball.path.y[0],
              opacity: 0,
              scale: 0.5,
            }}
            animate={{
              x: ball.path.x,
              y: ball.path.y,
              opacity: [0, 1, 1, 1, 0],
              scale: [0.5, 1.2, 0.8, 1.1, 0.5],
              rotate: [0, 180, 360, 540],
            }}
            transition={{
              delay: ball.delay,
              duration: 2.0,
              ease: 'easeInOut',
              times: [0, 0.2, 0.5, 0.8, 1],
            }}
            className="absolute w-12 h-12 md:w-16 md:h-16 rounded-full blur-[1px] shadow-2xl"
            style={{
              backgroundColor: ball.color,
              boxShadow: `0 0 30px ${ball.color}AA`,
              border: '3px solid rgba(255,255,255,0.4)',
            }}
          >
            <div className="absolute top-2 left-2 w-4 h-4 bg-white/50 rounded-full blur-[1px]" />
            <div className="absolute bottom-2 right-3 w-2 h-2 bg-white/20 rounded-full blur-[2px]" />
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-12 flex flex-col items-center gap-2"
      >
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
              className="w-2 h-2 bg-emerald-500 rounded-full"
            />
          ))}
        </div>
        <span className="text-emerald-500/50 text-[10px] font-black uppercase tracking-[0.4em]">
          Initializing Systems
        </span>
      </motion.div>
    </div>
  );
};

export default SplashScreen;

