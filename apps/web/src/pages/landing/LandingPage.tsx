import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

export function LandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.5;
    }
  }, []);

  return (
    <div className="bg-black text-white min-h-screen selection:bg-white selection:text-black overflow-hidden relative">
      <section className="min-h-screen relative overflow-hidden flex flex-col">
        {/* Looping background video: full opacity from frame 1, 0.5x speed */}
        <video
          ref={videoRef}
          src="https://designerstephen.github.io/public-assets/videos/observe-hero.mp4"
          className="absolute inset-0 w-full h-full object-cover object-bottom"
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
        />

        {/* Hero Content: Centered */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 text-center -translate-y-[8%]">
          {/* Headline with soft dark aura */}
          <h1
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-[5.25rem] font-serif-instrument tracking-tight leading-[1.08] max-w-6xl mb-10 select-none text-white"
            style={{
              textShadow: '0 0 72px rgba(0, 0, 0, 0.42), 0 4px 28px rgba(0, 0, 0, 0.28)',
            }}
          >
            Chronyx: Don&apos;t trust the timestamp, <em className="italic font-normal">verify it</em>
          </h1>

          {/* Large Centered Launch CTA button */}
          <div className="flex justify-center">
            <Link
              to="/overview"
              className="liquid-glass group rounded-full px-12 py-5 flex items-center gap-3.5 text-white text-lg sm:text-xl font-medium hover:bg-white/10 hover:scale-105 active:scale-95 transition-all duration-300"
              style={{
                textShadow: '0 0 24px rgba(0, 0, 0, 0.45)',
              }}
            >
              <span className="tracking-wide font-medium">Launch</span>
              <svg
                className="w-6 h-6 text-white group-hover:translate-x-1 transition-transform duration-200"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
