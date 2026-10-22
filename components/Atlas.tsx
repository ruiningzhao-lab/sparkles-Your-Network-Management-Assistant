'use client';

import { useEffect, useRef, useState } from 'react';
import { APP_NAME, Star } from './Logo';

type Viewer = { mode: 'local' | 'supabase'; name: string; email: string; admin: boolean };

/** The map app shell. The engine (atlas-engine.ts) renders into these elements. */
export default function Atlas({ viewer }: { viewer: Viewer }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    import('./atlas-engine').then(async (m) => {
      cleanup = await m.start(viewer);
    });
    return () => cleanup?.();
  }, [viewer]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const initials = (viewer.name || viewer.email || 'You').split(/[\s@.]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <svg id="map" role="img" aria-label="World map of your network" />

      <div className="top">
        <div className="brandcol">
          <div className="brand float">
            <Star /> {APP_NAME}
          </div>
          {viewer.mode === 'local' && <span className="modepill">Local mode</span>}
        </div>
        <div className="center">
          <form className="prompt float" id="askForm">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4z" fill="currentColor" />
              <circle cx="19" cy="18" r="2" fill="currentColor" />
            </svg>
            <input id="askIn" placeholder="What do you want to do? Sparkles will find the people." autoComplete="off" aria-label="What do you want to do?" />
            <button className="btn go" type="submit">
              Map it
            </button>
          </form>
          <div className="filters">
            <div className="seg float" role="group" aria-label="Circles" id="modes" />
            <div id="layers" style={{ display: 'flex', gap: 6 }} />
            <div id="lensSlot" />
          </div>
        </div>
        <div className="usermenu" ref={menuRef}>
          <button aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <span className="me">{initials || 'Y'}</span>
            <span className="lg">{viewer.name?.split(' ')[0] || 'Account'}</span>
          </button>
          {menu && (
            <div className="menu float" role="menu">
              {viewer.email && <small>{viewer.email}</small>}
              {viewer.admin && viewer.mode === 'supabase' && (
                <a href="/admin" role="menuitem">
                  Invite people
                </a>
              )}
              {viewer.mode === 'supabase' ? (
                <form action="/auth/signout" method="post">
                  <button type="submit" role="menuitem">
                    Sign out
                  </button>
                </form>
              ) : (
                <small>Local mode: add Supabase keys to invite people.</small>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bottom">
        <div className="brow">
          <div className="stats float" id="stats" />
          <div className="zoombox">
            <button id="zin" aria-label="Zoom in">+</button>
            <button id="zout" aria-label="Zoom out">−</button>
            <button id="zhome" aria-label="Show the whole world" title="Whole world">⌂</button>
          </div>
        </div>
        <div className="strip" id="strip" aria-label="Maps and ideas" />
      </div>

      <aside className="panel float" id="panel">
        <button className="handle" id="handle" aria-label="Expand panel">
          <i />
        </button>
        <div className="tabs" role="tablist" id="tabs" />
        <div className="pbody" id="pbody" />
      </aside>
      <input type="file" id="csvIn" accept=".csv,text/csv" hidden />
      <datalist id="cityList" />
      <div className="tip" id="tip" hidden />
      <div id="layer" />
    </>
  );
}
