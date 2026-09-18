import React from 'react';
import { Sparkles, Terminal, FilePlus, Bot, Play, Cpu, ShieldCheck, ArrowRight } from 'lucide-react';

const STARTER_PROMPTS = [
  'Build a modern responsive dashboard with dark and light themes',
  'Create a lightweight REST API with SQLite storage and tests',
  'Build an interactive markdown preview tool in vanilla JS',
  'Write a modular Python automation script with error handling',
];

export default function WorkspaceWelcome({
  onPromptChat,
  onCreateFile,
  onToggleTerminal,
}) {
  return (
    <div className="workspace-welcome-wrapper">
      <div className="welcome-inner">
        {/* Header Branding */}
        <div className="welcome-header">
          <div className="welcome-brand-badge">
            <Sparkles size={14} className="welcome-badge-icon" />
            <span>Multi-Agent Sandbox</span>
          </div>
          <h1 className="welcome-title">Spark IDE</h1>
          <p className="welcome-tagline">
            Autonomous AI engineering workspace with real-time reactive agents, full PTY terminal execution, and live preview.
          </p>
        </div>

        {/* Quick Action Cards Grid */}
        <div className="welcome-actions-grid">
          <button
            className="welcome-card primary"
            onClick={() =>
              onPromptChat?.(
                'Build a high-performance web application with clean architecture, responsive styling, and modern UI.'
              )
            }
          >
            <div className="welcome-card-header">
              <div className="welcome-icon-box">
                <Bot size={18} />
              </div>
              <span className="card-key-badge">Chat</span>
            </div>
            <div className="welcome-card-title">Prompt Master Agent</div>
            <div className="welcome-card-desc">
              Orchestrate Supervisor, Designer, Coder & Reviewer to build your feature.
            </div>
          </button>

          <button className="welcome-card" onClick={onCreateFile}>
            <div className="welcome-card-header">
              <div className="welcome-icon-box">
                <FilePlus size={18} />
              </div>
              <span className="card-key-badge">New</span>
            </div>
            <div className="welcome-card-title">Create New File</div>
            <div className="welcome-card-desc">
              Add a Python, JavaScript, HTML, CSS, or configuration file to the sandbox.
            </div>
          </button>

          <button className="welcome-card" onClick={onToggleTerminal}>
            <div className="welcome-card-header">
              <div className="welcome-icon-box">
                <Terminal size={18} />
              </div>
              <span className="card-key-badge">Terminal</span>
            </div>
            <div className="welcome-card-title">Interactive Terminal</div>
            <div className="welcome-card-desc">
              Open the interactive zsh PTY shell to run scripts, package managers, and servers.
            </div>
          </button>
        </div>

        {/* Suggested Quick Prompts */}
        <div className="welcome-prompts-section">
          <div className="section-label">Quick Prompts</div>
          <div className="prompt-chips-wrap">
            {STARTER_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                className="prompt-chip"
                onClick={() => onPromptChat?.(prompt)}
              >
                <span>{prompt}</span>
                <ArrowRight size={12} className="chip-arrow" />
              </button>
            ))}
          </div>
        </div>

        {/* Telemetry Footer */}
        <div className="welcome-footer-row">
          <div className="footer-status-pill">
            <span className="status-live-dot" />
            <span>Ollama AI: qwen2.5-coder</span>
          </div>
          <div className="footer-status-pill">
            <ShieldCheck size={12} />
            <span>HITL Roadmap Safety</span>
          </div>
          <div className="footer-status-pill">
            <Play size={12} />
            <span>Live Auto-Preview</span>
          </div>
        </div>
      </div>
    </div>
  );
}
