'use client';

import { useEffect, useMemo } from 'react';
import { APP_NAME } from './Logo';
import { shellHTML } from './shell';

type Viewer = { mode: 'local' | 'supabase'; name: string; email: string; admin: boolean };

/** The map app. The engine (atlas-engine.ts) renders into the shared shell markup. */
export default function Atlas({ viewer }: { viewer: Viewer }) {
  const html = useMemo(() => shellHTML(APP_NAME), []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    import('./atlas-engine').then(async (m) => {
      cleanup = await m.start(viewer);
    });
    return () => cleanup?.();
  }, [viewer]);

  return <div className="app" dangerouslySetInnerHTML={{ __html: html }} />;
}
