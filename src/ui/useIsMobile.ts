import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 640px)';

// Reactive viewport-width check. 640px catches all phone-portrait widths
// (iPhone ~390, Android ~360-412) while leaving tablets and landscape phones
// on the desktop layout. Updates on orientation change / resize.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => { mq.removeEventListener('change', handler); };
  }, []);
  return isMobile;
}
