/* ═══════════════════════════════════════════════════════
   PROJECT ARGUS — app.js
   ═══════════════════════════════════════════════════════ */

'use strict';

const PREFERS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

/* ─── Data ───────────────────────────────────────────────────────────── */

const PIPELINE_STEPS = [
  {
    id: 1, emoji: '📁', label: 'Downlink Buffer', tech: 'fsnotify / Go', color: 'emerald',
    desc: 'Raw satellite tile dropped into /downlink_buffer/. The Go watcher detects the inode event within microseconds via fsnotify — no polling, no CPU waste.',
    detail: "Go's goroutine scheduler makes it trivial to watch thousands of files concurrently at near-zero CPU cost. fsnotify wraps inotify on Linux for kernel-level change notifications."
  },
  {
    id: 2, emoji: '🪣', label: 'MinIO Upload', tech: 'S3-Compatible', color: 'cyan',
    desc: 'FPutObject streams the raw tile directly into the satellite-raw bucket. The object key is a UUID + timestamp to guarantee idempotent event replay.',
    detail: "MinIO's erasure-coding gives 99.999% durability on a single node — full production parity without the AWS bill. The Go SDK supports streaming multipart uploads."
  },
  {
    id: 3, emoji: '⚡', label: 'Redpanda Event', tech: 'Kafka-compatible', color: 'violet',
    desc: 'A JSON event is produced to the eo-events topic. Redpanda\'s single-binary architecture eliminates ZooKeeper, cutting median produce latency by 10×.',
    detail: 'Redpanda is written in C++ using the Seastar async I/O framework. It is wire-compatible with Kafka 3.x — any Kafka client library works without modification.'
  },
  {
    id: 4, emoji: '🧠', label: 'ViT Inference', tech: 'Python / timm', color: 'amber',
    desc: 'The Python worker consumes the event, fetches the raw image from MinIO, resizes to 224×224, and runs a forward pass through vit_base_patch16_224.',
    detail: 'The CLS token — a 768-dim float32 vector — is extracted and L2-normalized. Cosine search against 874 reference embeddings runs in ~3ms on CPU (single matrix-vector multiply).'
  },
  {
    id: 5, emoji: '📍', label: 'GPS Prediction', tech: 'Cosine Similarity', color: 'rose',
    desc: 'Top-5 tile matches are selected by cosine score. A softmax-temperature-weighted mean of their GPS centroids yields the final lat/lon estimate.',
    detail: 'Average localization error on the Mumbai/Navi Mumbai corpus is ≈1.2 km at 10m GSD, degrading gracefully to ≈4 km on cloud-occluded or featureless tiles.'
  },
  {
    id: 6, emoji: '🗄️', label: 'PostGIS Write', tech: 'PostgreSQL + PostGIS', color: 'teal',
    desc: 'The result text is INSERT-ed into seopc_metadata. The Go TUI polls this table every 100ms, streaming new rows to the terminal dashboard in real-time.',
    detail: 'PostGIS enables future spatial queries — bounding-box filtering, proximity alerts, and trajectory reconstruction over time — without schema migrations.'
  }
];

const COMPONENTS = [
  {
    dir: 'satellite/', lang: 'Go', emoji: '📡', color: 'emerald',
    role: 'File Watcher & Kafka Producer',
    badges: ['fsnotify', 'sarama', 'MinIO SDK'],
    desc: 'Lightweight, always-on daemon. Goroutine-per-file watcher with zero-copy upload streaming to MinIO and Kafka event production.'
  },
  {
    dir: 'processor/', lang: 'Python', emoji: '🧠', color: 'amber',
    role: 'ViT Inference Worker',
    badges: ['timm', 'confluent-kafka', 'psycopg2', 'numpy'],
    desc: 'Consumes EO events, runs ViT-Base/16, performs cosine geo-search against 874 tile embeddings, writes results to PostGIS.'
  },
  {
    dir: 'dashboard/', lang: 'Go', emoji: '📟', color: 'cyan',
    role: 'Bubbletea TUI Dashboard',
    badges: ['bubbletea', 'lipgloss', 'pgx'],
    desc: 'Polls PostGIS every 100ms. Renders live scene count, p95 latency, and detection rows in a beautiful terminal UI.'
  },
  {
    dir: 'gui/', lang: 'C', emoji: '🖥️', color: 'violet',
    role: 'Raylib Image Viewer',
    badges: ['raylib', 'C11'],
    desc: 'Hot-reloads latest_processed.jpg on file mod-time change. Sub-millisecond frame times. Renders GPS crosshair overlay.'
  },
  {
    dir: 'cv/', lang: 'Python', emoji: '🔬', color: 'rose',
    role: 'Offline Embedding Generator',
    badges: ['timm', 'Pillow', 'numpy'],
    desc: 'One-shot script to build embeddings.npy from the Sentinel-2 tile corpus. Run once, commit the artifacts, never run again.'
  },
  {
    dir: 'observability/', lang: 'YAML', emoji: '📊', color: 'teal',
    role: 'Prometheus + Grafana',
    badges: ['Prometheus', 'Grafana'],
    desc: 'Scrapes metrics from all services. Pre-built dashboards for latency histograms, throughput graphs, and system health.'
  }
];

const STATUS_MESSAGES = [
  'ALL SYSTEMS NOMINAL',
  'REDPANDA CLUSTER HEALTHY',
  'POSTGIS REPLICATION ACTIVE',
  '874 TILE EMBEDDINGS LOADED',
  'ViT-BASE/16 INFERENCE READY',
  'MINIO BUCKET ONLINE',
  'KAFKA CONSUMER LAG: 0ms',
  'DASHBOARD POLLING ACTIVE'
];

const BADGE_COLORS = {
  emerald: 'badge-emerald',
  cyan:    'badge-cyan',
  violet:  'badge-violet',
  amber:   'badge-amber',
  rose:    'badge-rose',
  teal:    'badge-teal'
};

const STEP_BG = {
  emerald: 'rgba(16,185,129,0.12)',
  cyan:    'rgba(6,182,212,0.12)',
  violet:  'rgba(139,92,246,0.12)',
  amber:   'rgba(245,158,11,0.12)',
  rose:    'rgba(244,63,94,0.12)',
  teal:    'rgba(20,184,166,0.12)'
};
const STEP_COLOR = {
  emerald: '#10b981', cyan: '#06b6d4', violet: '#8b5cf6',
  amber: '#f59e0b', rose: '#f43f5e', teal: '#14b8a6'
};
const STEP_BORDER = {
  emerald: 'rgba(16,185,129,0.3)',
  cyan:    'rgba(6,182,212,0.3)',
  violet:  'rgba(139,92,246,0.3)',
  amber:   'rgba(245,158,11,0.3)',
  rose:    'rgba(244,63,94,0.3)',
  teal:    'rgba(20,184,166,0.3)'
};

/* ─── Custom Cursor ──────────────────────────────────────────────────── */
(function() {
  const dot  = document.getElementById('cursorDot');
  const ring = document.getElementById('cursorRing');
  if (!dot || !ring || PREFERS_REDUCED_MOTION || IS_COARSE_POINTER) {
    if (dot) dot.style.display = 'none';
    if (ring) ring.style.display = 'none';
    return;
  }

  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let rx = mx;
  let ry = my;
  let mouseFrame = null;

  document.addEventListener('mousemove', e => {
    if (mouseFrame) return;
    mouseFrame = requestAnimationFrame(() => {
      mx = e.clientX;
      my = e.clientY;
      mouseFrame = null;
    });
  }, { passive: true });

  function animate() {
    dot.style.left  = mx + 'px';
    dot.style.top   = my + 'px';
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(animate);
  }
  animate();
  document.addEventListener('mouseenter', () => { dot.style.opacity='1'; ring.style.opacity='1'; });
  document.addEventListener('mouseleave', () => { dot.style.opacity='0'; ring.style.opacity='0'; });
  document.querySelectorAll('a,button').forEach(el => {
    el.addEventListener('mouseenter', () => { ring.style.width='40px'; ring.style.height='40px'; ring.style.borderColor='rgba(16,185,129,0.7)'; });
    el.addEventListener('mouseleave', () => { ring.style.width='28px'; ring.style.height='28px'; ring.style.borderColor='rgba(16,185,129,0.5)'; });
  });
})();

/* ─── Topbar scroll effect ───────────────────────────────────────────── */
(() => {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;

  let rafScheduled = false;
  window.addEventListener('scroll', () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      topbar.style.background = window.scrollY > 20 ? 'rgba(2,6,23,0.95)' : 'rgba(2,6,23,0.85)';
      rafScheduled = false;
    });
  }, { passive: true });
})();

/* ─── Hamburger / Sidebar ────────────────────────────────────────────── */
document.getElementById('hamburger').addEventListener('click', () => {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.classList.toggle('open');
});
document.getElementById('sidebar').addEventListener('click', e => {
  if (e.target.classList.contains('nav-link')) {
    document.getElementById('sidebar').classList.remove('open');
  }
});

/* ─── Status ticker ──────────────────────────────────────────────────── */
(function() {
  let i = 0;
  const el = document.getElementById('tickerText');
  if (!el) return;
  setInterval(() => {
    if (document.hidden) return;
    i = (i + 1) % STATUS_MESSAGES.length;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.textContent = STATUS_MESSAGES[i];
    el.style.animation = '';
  }, 3000);
})();

/* ─── Scroll reveal ──────────────────────────────────────────────────── */
(function() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -60px 0px' });
  if (!PREFERS_REDUCED_MOTION) {
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  }
})();

/* ─── Active nav link ────────────────────────────────────────────────── */
(function() {
  const sections = document.querySelectorAll('.section[id]');
  const links    = document.querySelectorAll('.nav-link');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.classList.toggle('active', l.dataset.section === e.target.id));
      }
    });
  }, { rootMargin: '-40% 0px -50% 0px' });
  sections.forEach(s => obs.observe(s));
})();

/* ─── Architecture SVG diagram ───────────────────────────────────────── */
(function() {
  const nodes = [
    { id:'buf',      x:30,  y:135, w:120, h:55, label:['Downlink','Buffer'], sub:'./downlink_buffer', color:'#10b981' },
    { id:'sat',      x:195, y:75,  w:120, h:55, label:['Satellite','Service'], sub:'Go — fsnotify', color:'#06b6d4' },
    { id:'minio_r',  x:195, y:200, w:120, h:55, label:['MinIO Raw'], sub:'satellite-raw', color:'#06b6d4' },
    { id:'redpanda', x:365, y:75,  w:120, h:55, label:['Redpanda'], sub:'eo-events topic', color:'#8b5cf6' },
    { id:'proc',     x:365, y:200, w:120, h:55, label:['Processor','Worker'], sub:'Python — ViT', color:'#f59e0b' },
    { id:'postgis',  x:535, y:120, w:120, h:55, label:['PostGIS'], sub:'seopc_metadata', color:'#14b8a6' },
    { id:'minio_p',  x:535, y:225, w:120, h:55, label:['MinIO','Processed'], sub:'satellite-processed', color:'#06b6d4' },
    { id:'dash',     x:705, y:75,  w:120, h:55, label:['TUI','Dashboard'], sub:'Go — Bubbletea', color:'#10b981' },
    { id:'gui',      x:705, y:200, w:120, h:55, label:['Raylib GUI'], sub:'Sovereign View', color:'#8b5cf6' }
  ];
  const edges = [
    ['buf','sat'],['buf','minio_r'],
    ['sat','redpanda'],['sat','minio_r'],
    ['minio_r','proc'],['redpanda','proc'],
    ['proc','postgis'],['proc','minio_p'],
    ['postgis','dash'],['minio_p','gui']
  ];

  const find = id => nodes.find(n => n.id === id);
  const cx   = n => n.x + n.w / 2;
  const cy   = n => n.y + n.h / 2;

  const svg = document.getElementById('archSvg');
  if (!svg) return;
  let html  = '';

  // defs
  html += '<defs>';
  html += '<marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#475569"/></marker>';
  nodes.forEach(n => {
    const [r,g,b] = hexToRgb(n.color);
    html += `<filter id="gf-${n.id}"><feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="rgb(${r},${g},${b})" flood-opacity="0.25"/></filter>`;
  });
  html += '</defs>';

  // edges
  edges.forEach(([a,b]) => {
    const na = find(a), nb = find(b);
    const x1 = cx(na), y1 = cy(na), x2 = cx(nb), y2 = cy(nb);
    html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1e293b" stroke-width="1.5" stroke-dasharray="5 3" marker-end="url(#arr)"/>`;
  });

  // nodes
  nodes.forEach(n => {
    const [r,g,b] = hexToRgb(n.color);
    html += `
      <g class="arch-node" style="cursor:default">
        <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10"
          fill="#0a0f1e" stroke="${n.color}" stroke-width="1.5" opacity=".97"
          filter="url(#gf-${n.id})"/>
        <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10"
          fill="rgb(${r},${g},${b})" opacity=".06"/>`;
    if (n.label.length === 1) {
      html += `<text x="${cx(n)}" y="${n.y+24}" text-anchor="middle" fill="${n.color}"
        font-size="11.5" font-family="Share Tech Mono, monospace" font-weight="700">${n.label[0]}</text>`;
    } else {
      html += `<text x="${cx(n)}" y="${n.y+20}" text-anchor="middle" fill="${n.color}"
        font-size="11.5" font-family="Share Tech Mono, monospace" font-weight="700">${n.label[0]}</text>`;
      html += `<text x="${cx(n)}" y="${n.y+33}" text-anchor="middle" fill="${n.color}"
        font-size="11.5" font-family="Share Tech Mono, monospace" font-weight="700">${n.label[1]}</text>`;
    }
    html += `<text x="${cx(n)}" y="${n.y+49}" text-anchor="middle" fill="#475569"
      font-size="9" font-family="Share Tech Mono, monospace">${n.sub}</text>`;
    html += `</g>`;
  });

  svg.innerHTML = html;

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return [r,g,b];
  }
})();

/* ─── Workflow Stepper ───────────────────────────────────────────────── */
(function() {
  let active = 0;
  let autoPlay = false;
  let autoTimer = null;
  const dotsEl   = document.getElementById('stepperDots');
  const content  = document.getElementById('stepContent');
  const prevBtn  = document.getElementById('stepPrev');
  const nextBtn  = document.getElementById('stepNext');
  const autoBtn  = document.getElementById('stepAuto');
  const resetBtn = document.getElementById('stepReset');
  if (!dotsEl || !content || !prevBtn || !nextBtn || !autoBtn || !resetBtn) return;

  function renderDots() {
    dotsEl.innerHTML = PIPELINE_STEPS.map((s,i) => {
      let cls = 'step-dot';
      if (i === active) cls += ' active';
      else if (i < active) cls += ' done';
      const c = STEP_COLOR[s.color];
      const bg = i === active ? c : (i < active ? c : '');
      const style = i === active
        ? `style="background:${c};border-color:transparent;color:#fff;"`
        : i < active
          ? `style="background:${c};border-color:transparent;color:#fff;opacity:.6;"`
          : '';
      return `<button class="${cls}" ${style} data-idx="${i}" title="${s.label}">
        ${i < active ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20,6 9,17 4,12"/></svg>` : s.id}
      </button>`;
    }).join('');
    dotsEl.querySelectorAll('.step-dot').forEach(b => {
      b.addEventListener('click', () => { goTo(parseInt(b.dataset.idx)); });
    });
  }

  function renderContent() {
    const s = PIPELINE_STEPS[active];
    const c = STEP_COLOR[s.color];
    const bg = STEP_BG[s.color];
    const border = STEP_BORDER[s.color];
    content.style.background = bg;
    content.style.border = `1px solid ${border}`;
    content.innerHTML = `
      <div class="step-header">
        <div class="step-icon-wrap" style="background:${bg};border:1px solid ${border}">
          <span style="font-size:22px">${s.emoji}</span>
        </div>
        <div class="step-title-wrap">
          <div class="step-title">${s.label}</div>
          <span class="badge ${BADGE_COLORS[s.color]}">${s.tech}</span>
        </div>
      </div>
      <p class="step-desc">${s.desc}</p>
      <div class="step-detail">${s.detail}</div>
    `;
    // re-trigger animation
    content.style.animation = 'none';
    void content.offsetWidth;
    content.style.animation = '';
  }

  function goTo(idx) {
    active = Math.max(0, Math.min(PIPELINE_STEPS.length - 1, idx));
    renderDots();
    renderContent();
    prevBtn.disabled = active === 0;
    nextBtn.disabled = active === PIPELINE_STEPS.length - 1;
  }

  function toggleAuto() {
    autoPlay = !autoPlay;
    autoBtn.classList.toggle('playing', autoPlay);
    autoBtn.innerHTML = autoPlay
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> PAUSE`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> AUTO`;
    if (autoPlay) {
      autoTimer = setInterval(() => {
        if (document.hidden) return;
        if (active < PIPELINE_STEPS.length - 1) goTo(active + 1);
        else { goTo(0); }
      }, 2400);
    } else {
      clearInterval(autoTimer);
    }
  }

  prevBtn.addEventListener('click', () => goTo(active - 1));
  nextBtn.addEventListener('click', () => goTo(active + 1));
  autoBtn.addEventListener('click', toggleAuto);
  resetBtn.addEventListener('click', () => { goTo(0); });

  goTo(0);
})();

/* ─── Component cards ────────────────────────────────────────────────── */
(function() {
  const grid = document.getElementById('componentGrid');
  if (!grid) return;
  grid.innerHTML = COMPONENTS.map(c => `
    <div class="comp-card color-${c.color}">
      <div class="comp-icon-wrap" style="background:${STEP_BG[c.color]};border:1px solid ${STEP_BORDER[c.color]}">
        <span>${c.emoji}</span>
      </div>
      <div class="comp-dir">${c.dir}</div>
      <div class="comp-role">[${c.lang}] ${c.role}</div>
      <div class="comp-desc">${c.desc}</div>
      <div class="comp-badges">
        ${c.badges.map(b => `<span class="badge ${BADGE_COLORS[c.color]}">${b}</span>`).join('')}
      </div>
    </div>
  `).join('');
})();

/* ─── Telemetry charts ───────────────────────────────────────────────── */
(function() {
  const N = 16;
  let live = true;
  let telemetryVisible = true;

  function randBetween(a, b) { return a + Math.random() * (b - a); }

  function genData() {
    return Array.from({length: N}, (_,i) => ({
      t: `${i*30}s`,
      latency:    Math.round(randBetween(75, 200)),
      throughput: +randBetween(3, 12).toFixed(1)
    }));
  }

  let data = genData();

  const telemetrySection = document.getElementById('telemetry');
  if (telemetrySection) {
    const visibilityObserver = new IntersectionObserver(entries => {
      telemetryVisible = entries.some(entry => entry.isIntersecting);
    }, { threshold: 0.15 });
    visibilityObserver.observe(telemetrySection);
  }

  const chartDefaults = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 220, easing: 'easeOutQuart' },
    plugins: { legend: { display: false }, tooltip: {
      backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1,
      titleColor: '#94a3b8', bodyColor: '#e2e8f0',
      titleFont: { family: 'Share Tech Mono', size: 11 },
      bodyFont: { family: 'Share Tech Mono', size: 12 }
    }},
    scales: {
      x: { grid: { color: '#1e293b' }, ticks: { color: '#475569', font: { family: 'Share Tech Mono', size: 10 }, maxTicksLimit: 8 } },
      y: { grid: { color: '#1e293b' }, ticks: { color: '#475569', font: { family: 'Share Tech Mono', size: 10 } } }
    }
  };

  // Latency chart
  const latencyCanvas = document.getElementById('latencyChart');
  const throughputCanvas = document.getElementById('throughputChart');
  if (!latencyCanvas || !throughputCanvas || !window.Chart) return;

  const latCtx = latencyCanvas.getContext('2d');
  const grad1 = latCtx.createLinearGradient(0, 0, 0, 160);
  grad1.addColorStop(0,   'rgba(6,182,212,0.3)');
  grad1.addColorStop(1,   'rgba(6,182,212,0)');

  const latChart = new Chart(latCtx, {
    type: 'line',
    data: {
      labels: data.map(d => d.t),
      datasets: [{
        data: data.map(d => d.latency),
        borderColor: '#06b6d4', borderWidth: 2,
        backgroundColor: grad1, fill: true,
        tension: 0.4, pointRadius: 2, pointHoverRadius: 5,
        pointBackgroundColor: '#06b6d4'
      }]
    },
    options: { ...chartDefaults }
  });

  // Throughput chart
  const tpCtx = throughputCanvas.getContext('2d');
  const tpChart = new Chart(tpCtx, {
    type: 'bar',
    data: {
      labels: data.slice(-10).map(d => d.t),
      datasets: [{
        data: data.slice(-10).map(d => d.throughput),
        backgroundColor: 'rgba(16,185,129,0.65)',
        borderColor: '#10b981', borderWidth: 1,
        borderRadius: 4, borderSkipped: false
      }]
    },
    options: { ...chartDefaults }
  });

  let tick = N;
  function updateCharts() {
    if (!live || document.hidden || !telemetryVisible) return;
    const newPoint = {
      t: `${tick * 30}s`,
      latency:    Math.round(randBetween(75, 200)),
      throughput: +randBetween(3, 12).toFixed(1)
    };
    data.push(newPoint);
    data.shift();
    tick++;

    // Update KPIs
    const latest = data[data.length - 1];
    document.getElementById('kpiLatency').textContent    = `${latest.latency}ms`;
    document.getElementById('kpiThroughput').textContent = `${latest.throughput} img/s`;
    const avgConf = (0.82 + Math.random() * 0.15);
    document.getElementById('kpiConfidence').textContent = `${(avgConf*100).toFixed(1)}%`;
    const tileEl = document.getElementById('kpiTiles');
    if (tileEl) {
      const current = Number(tileEl.textContent.replace(/,/g, '')) || 12847;
      tileEl.textContent = (current + Math.round(randBetween(1, 4))).toLocaleString();
    }

    // Update latency chart
    latChart.data.labels            = data.map(d => d.t);
    latChart.data.datasets[0].data  = data.map(d => d.latency);
    latChart.update('none');

    // Update throughput chart (last 10)
    const last10 = data.slice(-10);
    tpChart.data.labels           = last10.map(d => d.t);
    tpChart.data.datasets[0].data = last10.map(d => d.throughput);
    tpChart.update('none');
  }

  setInterval(updateCharts, 2000);

  // Live toggle
  const liveBtn = document.getElementById('liveToggle');
  if (!liveBtn) return;
  liveBtn.addEventListener('click', () => {
    live = !live;
    liveBtn.classList.toggle('active', live);
    liveBtn.innerHTML = `<span class="live-dot"></span> ${live ? 'LIVE' : 'PAUSED'}`;
  });

  // init KPIs
  updateCharts();
})();

/* ─── Sovereign View terrain canvas ─────────────────────────────────── */
(function() {
  const canvas = document.getElementById('terrainCanvas');
  const gui    = document.getElementById('sovereignGui');
  if (!canvas || !gui) return;

  const ctx    = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');
  const staticCtx = staticCanvas.getContext('2d');
  let guiVisible = true;

  // Crosshair position (% of container)
  const CX_PCT = 0.52, CY_PCT = 0.46;

  let scanY   = 0;
  let frameId = null;
  let lastTs = 0;
  let W = 0, H = 0;

  // Pre-generated terrain data (seeded random for stability)
  const seededRand = (() => {
    let s = 42;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  })();

  const BUILDINGS = Array.from({length:28}, () => ({
    x: seededRand(), y: seededRand(),
    w: 0.03 + seededRand()*0.045,
    h: 0.025 + seededRand()*0.035,
    bright: 0.4 + seededRand()*0.5
  }));
  const ROADS = [
    { pts: [[0.1,0.55],[0.3,0.52],[0.5,0.54],[0.75,0.49],[1,0.51]] },
    { pts: [[0,0.32],[1,0.37]] },
    { pts: [[0.42,0],[0.45,1]] },
    { pts: [[0.7,0],[0.68,0.45],[0.72,1]] }
  ];

  function resize() {
    const rect = gui.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.round(rect.width * dpr);
    H = Math.round(rect.height * dpr);
    canvas.width  = W;
    canvas.height = H;
    staticCanvas.width = W;
    staticCanvas.height = H;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    drawStaticTerrain();
    drawFrame();
  }

  function drawStaticTerrain() {
    if (!W || !H) return;

    // Background gradient
    const bg = staticCtx.createRadialGradient(W*0.5, H*0.5, 0, W*0.5, H*0.5, W*0.7);
    bg.addColorStop(0,   '#0d4a2a');
    bg.addColorStop(0.5, '#0a3820');
    bg.addColorStop(1,   '#061508');
    staticCtx.fillStyle = bg;
    staticCtx.fillRect(0, 0, W, H);

    // Grid
    staticCtx.strokeStyle = 'rgba(30,73,42,0.4)';
    staticCtx.lineWidth   = 0.5;
    const gSize = W / 16;
    for (let x = 0; x <= W; x += gSize) {
      staticCtx.beginPath(); staticCtx.moveTo(x,0); staticCtx.lineTo(x,H); staticCtx.stroke();
    }
    for (let y = 0; y <= H; y += gSize) {
      staticCtx.beginPath(); staticCtx.moveTo(0,y); staticCtx.lineTo(W,y); staticCtx.stroke();
    }

    // Roads
    staticCtx.strokeStyle = 'rgba(20,60,35,0.7)';
    staticCtx.lineWidth   = W * 0.004;
    ROADS.forEach(road => {
      staticCtx.beginPath();
      road.pts.forEach(([px,py], i) => {
        if (i===0) staticCtx.moveTo(px*W, py*H);
        else staticCtx.lineTo(px*W, py*H);
      });
      staticCtx.stroke();
    });

    // Buildings
    BUILDINGS.forEach(b => {
      const alpha = b.bright;
      staticCtx.fillStyle   = `rgba(10,50,25,${alpha})`;
      staticCtx.strokeStyle = `rgba(20,80,40,${alpha*0.8})`;
      staticCtx.lineWidth   = 0.5;
      staticCtx.fillRect(b.x*W, b.y*H, b.w*W, b.h*H);
      staticCtx.strokeRect(b.x*W, b.y*H, b.w*W, b.h*H);
    });

    // Water body (Bombay coast proxy)
    const water = staticCtx.createRadialGradient(W*0.78, H*0.77, 0, W*0.78, H*0.77, W*0.2);
    water.addColorStop(0, 'rgba(10,35,60,0.85)');
    water.addColorStop(1, 'rgba(10,35,60,0)');
    staticCtx.fillStyle = water;
    staticCtx.beginPath();
    staticCtx.ellipse(W*0.78, H*0.78, W*0.17, H*0.15, -0.2, 0, Math.PI*2);
    staticCtx.fill();
  }

  function drawFrame() {
    if (!W || !H) return;
    ctx.drawImage(staticCanvas, 0, 0);

    // Scan line
    ctx.fillStyle = 'rgba(16,185,129,0.09)';
    ctx.fillRect(0, scanY, W, 2);
  }

  function animate(ts) {
    if (!frameId) return;
    if (ts - lastTs < 33) {
      frameId = requestAnimationFrame(animate);
      return;
    }
    lastTs = ts;
    scanY = (scanY + (H / 180)) % H;
    drawFrame();
    frameId = requestAnimationFrame(animate);
  }

  function setAnimationState() {
    const shouldAnimate = guiVisible && !document.hidden && !PREFERS_REDUCED_MOTION;
    if (shouldAnimate && !frameId) {
      frameId = requestAnimationFrame(animate);
    }
    if (!shouldAnimate && frameId) {
      cancelAnimationFrame(frameId);
      frameId = null;
      drawFrame();
    }
  }

  // Position crosshair
  function positionCrosshair() {
    const wrap = document.getElementById('crosshairWrap');
    if (!wrap) return;
    const rect = gui.getBoundingClientRect();
    wrap.style.left = (CX_PCT * 100) + '%';
    wrap.style.top  = (CY_PCT * 100) + '%';
  }

  const ro = new ResizeObserver(() => { resize(); positionCrosshair(); });
  ro.observe(gui);

  const visibilityObserver = new IntersectionObserver(entries => {
    guiVisible = entries.some(entry => entry.isIntersecting);
    setAnimationState();
  }, { threshold: 0.2 });
  visibilityObserver.observe(gui);

  document.addEventListener('visibilitychange', setAnimationState);

  resize();
  positionCrosshair();
  setAnimationState();

  // Subtle coord drift animation
  let phase = 0;
  setInterval(() => {
    if (!guiVisible || document.hidden) return;
    phase += 0.05;
    const lat = (19.0760 + Math.sin(phase)*0.0002).toFixed(4);
    const lon = (72.8777 + Math.cos(phase*1.3)*0.0001).toFixed(4);
    const conf= (93.4 + Math.sin(phase*2)*0.8).toFixed(1);
    document.getElementById('hudLat').textContent  = `LAT ${lat}°N`;
    document.getElementById('hudLon').textContent  = `LON ${lon}°E`;
    document.getElementById('hudConf').textContent = `CONF ${conf}%`;
  }, 1600);
})();

/* ─── Copy buttons ───────────────────────────────────────────────────── */
(function() {
  const CODE_MAP = {
    clone: document.getElementById('code-clone')?.innerText || '',
    feed:  document.getElementById('code-feed')?.innerText  || '',
    down:  document.getElementById('code-down')?.innerText  || ''
  };

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key  = btn.dataset.code;
      const text = CODE_MAP[key] || '';
      navigator.clipboard.writeText(text).catch(() => {});
      btn.classList.add('copied');
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg><span>COPIED</span>`;
      setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 2000);
    });
  });
})();

/* ─── Nav smooth scroll ──────────────────────────────────────────────── */
document.querySelectorAll('.nav-link, a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('#')) {
      e.preventDefault();
      const target = document.getElementById(href.slice(1));
      if (target) {
        const offset = 72;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    }
  }, { passive: false });
});
