import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function useInstallState() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const iosSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !standalone;

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    setDeferred(null);
  };

  return { standalone, iosSafari, canPromptInstall: deferred !== null, promptInstall };
}
