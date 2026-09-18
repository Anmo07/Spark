import React, { useState, useEffect } from 'react';
import {
  X,
  Palette,
  Sparkles,
  Sliders,
  Code,
  Layers,
  Check,
  RotateCcw,
  ExternalLink,
  HelpCircle,
  Eye,
} from 'lucide-react';

const PALETTES = [
  {
    id: 'cyber-neon',
    name: 'Cyber Neon',
    tag: 'Flagship 3D',
    bg: '#07080f',
    colors: ['#8b5cf6', '#06b6d4', '#ec4899'],
    desc: 'Deep obsidian with electric violet, glowing cyan and neon aura.',
  },
  {
    id: 'synthwave',
    name: 'Tokyo Synthwave',
    tag: 'Neon Sunset',
    bg: '#0a0714',
    colors: ['#f43f5e', '#d946ef', '#38bdf8'],
    desc: 'Midnight plum backdrop with hot fuchsia, magenta and neon amber.',
  },
  {
    id: 'matrix-emerald',
    name: 'Matrix Emerald',
    tag: 'Terminal Luxe',
    bg: '#060b08',
    colors: ['#10b981', '#34d399', '#06b6d4'],
    desc: 'Deep carbon with cyber jade, mint radiance and neon scanlines.',
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    tag: 'Cosmic Blue',
    bg: '#080d1a',
    colors: ['#3b82f6', '#06b6d4', '#6366f1'],
    desc: 'Cosmic navy obsidian with electric cobalt and ice cyan accents.',
  },
  {
    id: 'high-contrast',
    name: 'OLED Titanium',
    tag: 'Ultra Clean',
    bg: '#000000',
    colors: ['#ffffff', '#38bdf8', '#a78bfa'],
    desc: 'Pure pitch black with high-contrast chrome white and sky blue.',
  },
];

const SPLINE_PRESETS = [
  {
    id: 'kinetic-core',
    name: 'Spline Holographic Core',
    url: 'https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode',
    desc: 'Interactive 3D particle sphere responding to cursor coordinates.',
  },
  {
    id: 'tech-mesh',
    name: 'Spline Geometric Mesh',
    url: 'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode',
    desc: 'Futuristic geometric crystal with dynamic refraction.',
  },
  {
    id: 'canvas-3d',
    name: 'Interactive Canvas 3D Engine',
    url: '',
    desc: 'Zero-latency, 60fps geodesic 3D particle core with live mouse physics.',
  },
];

export default function ThemeStudioModal({
  isOpen,
  onClose,
  currentPalette,
  onSelectPalette,
  currentSplineUrl,
  onSelectSplineUrl,
  auroraEnabled,
  onToggleAurora,
  glassEnabled,
  onToggleGlass,
  shimmerEnabled,
  onToggleShimmer,
}) {
  const [activeTab, setActiveTab] = useState('palettes'); // 'palettes' | 'spline' | 'effects' | 'custom_code'
  const [customSplineUrl, setCustomSplineUrl] = useState(currentSplineUrl || '');
  const [customCss, setCustomCss] = useState(() => localStorage.getItem('spark_user_custom_css') || '');
  const [cssApplied, setCssApplied] = useState(false);

  useEffect(() => {
    setCustomSplineUrl(currentSplineUrl || '');
  }, [currentSplineUrl]);

  // Handle applying user's custom CSS
  const handleApplyCustomCss = () => {
    let styleTag = document.getElementById('spark-user-custom-css');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'spark-user-custom-css';
      document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = customCss;
    localStorage.setItem('spark_user_custom_css', customCss);
    setCssApplied(true);
    setTimeout(() => setCssApplied(false), 2000);
  };

  const handleResetCustomCss = () => {
    setCustomCss('');
    const styleTag = document.getElementById('spark-user-custom-css');
    if (styleTag) styleTag.innerHTML = '';
    localStorage.removeItem('spark_user_custom_css');
  };

  if (!isOpen) return null;

  return (
    <div className="theme-studio-backdrop" onClick={onClose}>
      <div className="theme-studio-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="studio-header">
          <div className="studio-title-wrap">
            <div className="studio-icon-box">
              <Palette size={18} />
            </div>
            <div>
              <div className="studio-title">UI & 3D Design Studio</div>
              <div className="studio-subtitle">Customize 3D Spline scenes, color themes, animations & custom code</div>
            </div>
          </div>
          <button className="studio-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="studio-tabs">
          <button
            className={`studio-tab-btn ${activeTab === 'palettes' ? 'active' : ''}`}
            onClick={() => setActiveTab('palettes')}
          >
            <Palette size={14} />
            <span>Color Palettes</span>
          </button>
          <button
            className={`studio-tab-btn ${activeTab === 'spline' ? 'active' : ''}`}
            onClick={() => setActiveTab('spline')}
          >
            <Layers size={14} />
            <span>3D Spline Scenes</span>
          </button>
          <button
            className={`studio-tab-btn ${activeTab === 'effects' ? 'active' : ''}`}
            onClick={() => setActiveTab('effects')}
          >
            <Sparkles size={14} />
            <span>Animations & FX</span>
          </button>
          <button
            className={`studio-tab-btn ${activeTab === 'custom_code' ? 'active' : ''}`}
            onClick={() => setActiveTab('custom_code')}
          >
            <Code size={14} />
            <span>Custom CSS / Files</span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="studio-body">
          {/* TAB 1: Palettes */}
          {activeTab === 'palettes' && (
            <div className="palettes-tab">
              <div className="studio-section-label">Select Color Theme</div>
              <div className="palettes-grid">
                {PALETTES.map((p) => {
                  const isSelected = currentPalette === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`palette-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => onSelectPalette(p.id)}
                    >
                      <div className="palette-card-header">
                        <div className="palette-name">{p.name}</div>
                        <span className="palette-tag">{p.tag}</span>
                      </div>
                      <p className="palette-desc">{p.desc}</p>
                      <div className="palette-swatch-row">
                        <span className="swatch-bg" style={{ background: p.bg }} />
                        {p.colors.map((c, idx) => (
                          <span
                            key={idx}
                            className="swatch-accent"
                            style={{ background: c, boxShadow: `0 0 10px ${c}60` }}
                          />
                        ))}
                        {isSelected && (
                          <div className="palette-check">
                            <Check size={14} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: Spline 3D Scenes */}
          {activeTab === 'spline' && (
            <div className="spline-tab">
              <div className="studio-section-label">Interactive 3D Spline Runtime</div>
              <p className="studio-hint">
                Choose a curated 3D scene or paste your own Spline scene URL exported from{' '}
                <a href="https://spline.design" target="_blank" rel="noreferrer" className="studio-link">
                  spline.design <ExternalLink size={11} style={{ display: 'inline' }} />
                </a>
              </p>

              <div className="spline-presets-list">
                {SPLINE_PRESETS.map((preset) => {
                  const isCurrent =
                    (preset.url === '' && !currentSplineUrl) || currentSplineUrl === preset.url;
                  return (
                    <div
                      key={preset.id}
                      className={`spline-preset-item ${isCurrent ? 'selected' : ''}`}
                      onClick={() => {
                        setCustomSplineUrl(preset.url);
                        onSelectSplineUrl(preset.url);
                      }}
                    >
                      <div className="preset-info">
                        <div className="preset-name">{preset.name}</div>
                        <div className="preset-desc">{preset.desc}</div>
                      </div>
                      {isCurrent && (
                        <div className="preset-active-badge">
                          <Check size={14} /> Active
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="custom-spline-input-box">
                <label className="input-label">Custom Spline Scene URL (.splinecode)</label>
                <div className="input-row">
                  <input
                    type="text"
                    className="studio-text-input"
                    placeholder="https://prod.spline.design/.../scene.splinecode"
                    value={customSplineUrl}
                    onChange={(e) => setCustomSplineUrl(e.target.value)}
                  />
                  <button
                    className="studio-btn primary"
                    onClick={() => onSelectSplineUrl(customSplineUrl)}
                  >
                    Apply Scene
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Animations & FX */}
          {activeTab === 'effects' && (
            <div className="effects-tab">
              <div className="studio-section-label">Animation & Visual Effects</div>

              <div className="effect-toggle-item">
                <div className="effect-info">
                  <div className="effect-title">🌌 Ambient Aurora Shifting</div>
                  <div className="effect-desc">Smooth moving fluid aurora gradient in the workspace background</div>
                </div>
                <button
                  className={`toggle-switch ${auroraEnabled ? 'on' : 'off'}`}
                  onClick={onToggleAurora}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>

              <div className="effect-toggle-item">
                <div className="effect-info">
                  <div className="effect-title">🪟 Glassmorphism Frost Blur</div>
                  <div className="effect-desc">Backdrop blur and specular reflection borders on panels</div>
                </div>
                <button
                  className={`toggle-switch ${glassEnabled ? 'on' : 'off'}`}
                  onClick={onToggleGlass}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>

              <div className="effect-toggle-item">
                <div className="effect-info">
                  <div className="effect-title">✨ Micro-Shimmer Light Sweep</div>
                  <div className="effect-desc">Diagonal sheen reflection over buttons, active cards and badges</div>
                </div>
                <button
                  className={`toggle-switch ${shimmerEnabled ? 'on' : 'off'}`}
                  onClick={onToggleShimmer}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: Custom CSS & File Intake */}
          {activeTab === 'custom_code' && (
            <div className="custom-code-tab">
              <div className="studio-section-label">Direct Custom HTML, CSS & JS Intake</div>

              <div className="custom-intake-notice">
                <HelpCircle size={15} className="notice-icon" />
                <div>
                  <strong>Can you provide custom HTML/CSS/JS files?</strong>
                  <p>
                    Yes, absolutely! You can:
                  </p>
                  <ul className="notice-list">
                    <li>Paste custom CSS directly in the editor below to apply live style overrides instantly.</li>
                    <li>Or ask me in chat to apply any custom HTML, CSS, or JS files you have. I can adapt them directly into the React IDE components or static viewer!</li>
                  </ul>
                </div>
              </div>

              <label className="input-label" style={{ marginTop: 12 }}>
                Live Custom CSS Overrides (Saved to Browser Storage)
              </label>
              <textarea
                className="studio-code-area"
                rows={6}
                placeholder={`/* Example custom styling */\n.ide-titlebar { border-bottom: 2px solid #8b5cf6 !important; }\n.sidebar-explorer { font-family: 'JetBrains Mono', monospace; }`}
                value={customCss}
                onChange={(e) => setCustomCss(e.target.value)}
              />

              <div className="studio-action-row">
                <button
                  className={`studio-btn primary ${cssApplied ? 'success' : ''}`}
                  onClick={handleApplyCustomCss}
                >
                  {cssApplied ? '✓ Applied Live!' : 'Apply Custom CSS'}
                </button>
                <button className="studio-btn secondary" onClick={handleResetCustomCss}>
                  <RotateCcw size={13} /> Reset
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="studio-footer">
          <div className="footer-status">
            Theme active: <span className="highlight-text">{currentPalette}</span>
          </div>
          <button className="studio-btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
