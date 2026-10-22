import { icon, NAV } from './icons';

/** The app frame the map engine renders into. Shared by the Next.js page and the claude.ai build. */
export function shellHTML(appName: string) {
  const nav = NAV.map((n) => `<button class="rail-item" data-tab="${n.tab}" aria-current="false">${icon(n.icon, 22)}<span>${n.label}</span></button>`).join('');
  const mark = appName.trim().charAt(0).toUpperCase() || 'S';
  return `
<svg id="map" role="img" aria-label="World map of your network"></svg>
<nav class="rail" aria-label="Main">
  <div class="rail-brand" title="${appName}" aria-hidden="true">${mark}</div>
  <div class="rail-nav">${nav}</div>
  <button class="rail-add" data-act="add" title="Add a person" aria-label="Add a person">${icon('plus', 22)}</button>
  <div class="rail-foot" data-acct></div>
</nav>
<header class="top">
  <div class="brand-m"><span>${appName}</span></div>
  <div class="center">
    <form class="prompt" id="askForm" role="search">
      <input id="askIn" placeholder="What do you want to do? Sparkles finds the people." autocomplete="off" aria-label="Ask Sparkles what you want to do">
      <button class="btn go" type="submit">Map it</button>
    </form>
    <div class="filters">
      <div class="seg" role="group" aria-label="Circles" id="modes"></div>
      <div id="layers" class="layers"></div>
      <div id="lensSlot"></div>
    </div>
  </div>
  <div class="top-acct" data-acct></div>
</header>
<div class="mapctl">
  <div class="stats" id="stats" aria-live="polite"></div>
  <div class="zoombox" role="group" aria-label="Map zoom">
    <button id="zin" aria-label="Zoom in" title="Zoom in">${icon('plus', 18)}</button>
    <button id="zout" aria-label="Zoom out" title="Zoom out">${icon('minus', 18)}</button>
    <button id="zhome" aria-label="Show the whole world" title="Whole world">${icon('globe', 18)}</button>
  </div>
</div>
<div class="strip" id="strip" aria-label="Your maps"></div>
<aside class="panel" id="panel" aria-label="Details">
  <button class="handle" id="handle" aria-label="Expand panel"><i></i></button>
  <div class="tabs" role="tablist" id="tabs"></div>
  <div class="pbody" id="pbody"></div>
</aside>
<input type="file" id="csvIn" accept=".csv,text/csv" hidden>
<datalist id="cityList"></datalist>
<div class="tip" id="tip" hidden></div>
<div id="layer"></div>`;
}
