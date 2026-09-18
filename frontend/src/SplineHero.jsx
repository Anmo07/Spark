import React from 'react';
import { Sparkles, Terminal, FilePlus, Palette, Bot, Play, ShieldCheck, Cpu } from 'lucide-react';
import SplineScene from './SplineScene';

export default function SplineHero({
  onPromptChat,
  onCreateFile,
  onToggleTerminal,
  onOpenThemeStudio,
  splineSceneUrl,
  palette,
}) {
  return (
    <div className="spline-hero-wrapper">
      {/* Ambient background glow */}
      <div className="hero-ambient-glow" />

      {/* Main 3D Container */}
      <div className="hero-3d-stage">
        <SplineScene
          sceneUrl={splineSceneUrl}
          mode="hero"
          interactive={true}
          palette={palette}
        />
      </div>

      {/* Overlay Content */}
      <div className="hero-content">
        <div className="hero-badge">
          <Sparkles size={13} className="hero-sparkle-icon" />
          <span>SPARK NEXUS // AGENTIC 3D IDE</span>
          <span className="hero-badge-dot" />
        </div>

        <h1 className="hero-title">
          Autonomous Multi-Agent <br />
          <span className="hero-title-gradient">Software Sandbox</span>
        </h1>

        <p className="hero-subtitle">
          Orchestrate Master, Supervisor, Designer, Coder & Reviewer agents with interactive PTY execution and live 3D visual workspace.
        </p>

        {/* Quick Launch Cards */}
        <div className="hero-actions-grid">
          <button
            className="hero-action-card primary"
            onClick={() =>
              onPromptChat?.(
                'Design and build a high-performance modern interactive web app with sleek animations and responsive layout.'
              )
            }
          >
            <div className="hero-card-icon-wrap">
              <Bot size={18} />
            </div>
            <div className="hero-card-body">
              <div className="hero-card-title">Prompt Master Agent</div>
              <div className="hero-card-desc">Generate a complete multi-file project with AI</div>
            </div>
            <div className="card-shimmer" />
          </button>

          <button className="hero-action-card" onClick={onCreateFile}>
            <div className="hero-card-icon-wrap">
              <FilePlus size={18} />
            </div>
            <div className="hero-card-body">
              <div className="hero-card-title">New File / Module</div>
              <div className="hero-card-desc">Create HTML, CSS, JS, Python or config</div>
            </div>
            <div className="card-shimmer" />
          </button>

          <button className="hero-action-card" onClick={onToggleTerminal}>
            <div className="hero-card-icon-wrap">
              <Terminal size={18} />
            </div>
            <div className="hero-card-body">
              <div className="hero-card-title">Interactive Terminal</div>
              <div className="hero-card-desc">Full zsh PTY shell with background runner</div>
            </div>
            <div className="card-shimmer" />
          </button>

          <button className="hero-action-card" onClick={onOpenThemeStudio}>
            <div className="hero-card-icon-wrap">
              <Palette size={18} />
            </div>
            <div className="hero-card-body">
              <div className="hero-card-title">UI & 3D Studio</div>
              <div className="hero-card-desc">Switch 3D scenes, color palettes & custom CSS</div>
            </div>
            <div className="card-shimmer" />
          </button>
        </div>

        {/* Real-time System Telemetry */}
        <div className="hero-telemetry-row">
          <div className="telemetry-item">
            <Cpu size={12} className="telemetry-icon" />
            <span>Ollama: qwen2.5-coder</span>
          </div>
          <div className="telemetry-divider">•</div>
          <div className="telemetry-item">
            <ShieldCheck size={12} className="telemetry-icon" />
            <span>HITL Roadmap Guard</span>
          </div>
          <div className="telemetry-divider">•</div>
          <div className="telemetry-item">
            <Play size={12} className="telemetry-icon" />
            <span>Live Auto-Preview</span>
          </div>
        </div>
      </div>
    </div>
  );
}
