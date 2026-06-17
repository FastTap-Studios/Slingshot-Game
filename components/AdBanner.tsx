/**
 * Banner ad for web (Google AdSense). Place at top so it doesn't cover the slingshot.
 * For native mobile (Capacitor) you would use @capacitor-community/admob instead.
 */

import React, { useEffect, useRef } from 'react';

const BANNER_HEIGHT = 50; // Standard banner height; responsive ads may vary slightly

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

interface AdBannerProps {
  /** AdSense client ID (e.g. ca-pub-xxxxxxxxxxxxxxxx). Omit to show placeholder only. */
  adClient?: string;
  /** AdSense slot ID. Required if adClient is set. */
  adSlot?: string;
  /** Test mode: visar testannonser, klick/visningar räknas inte. Sätt till true vid utveckling. */
  testMode?: boolean;
  /** Set to false to hide the banner area entirely (e.g. for paid/no-ads). */
  visible?: boolean;
}

const AdBanner: React.FC<AdBannerProps> = ({
  adClient,
  adSlot,
  testMode = false,
  visible = true,
}) => {
  const insRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!adClient || !adSlot || !insRef.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      console.warn('AdSense push failed', e);
    }
  }, [adClient, adSlot, testMode]);

  if (!visible) return null;

  if (!adClient || !adSlot) {
    return (
      <div
        className="w-full bg-[#1a1a1a] border-b border-[#333] flex items-center justify-center shrink-0"
        style={{ minHeight: BANNER_HEIGHT }}
        aria-hidden
      >
        <span className="text-[10px] text-[#555]">Ad space</span>
      </div>
    );
  }

  return (
    <div
      className="w-full flex items-center justify-center shrink-0 overflow-hidden bg-[#1a1a1a] border-b border-[#333]"
      style={{ minHeight: BANNER_HEIGHT }}
    >
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block', minHeight: BANNER_HEIGHT }}
        data-ad-client={adClient}
        data-ad-slot={adSlot}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
        {...(testMode ? { dataAdTest: 'on' } : {})}
      />
    </div>
  );
};

export default AdBanner;
