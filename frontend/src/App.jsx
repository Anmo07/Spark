import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Zap,
  FolderOpen,
  FolderClosed,
  FileCode2,
  FileText,
  RefreshCw,
  X,
  Code2,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Send,
  MoreHorizontal,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Download,
  TerminalSquare,
  Bot,
  User,
  Activity,
  CheckCircle2,
  ListChecks,
  Play,
  Square,
  ExternalLink,
  Globe,
  Eye,
  RotateCw,
  GitBranch,
  GitCompare,
  Contrast,
} from 'lucide-react';
import SourceControl from './SourceControl';
import './App.css';


/* =========================================================================
   Constants
   ========================================================================= */

const API_BASE = '';
const WS_EVENTS_URL =
  (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
  window.location.host +
  '/ws/events';
const WS_TERMINAL_URL =
  (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
  window.location.host +
  '/ws/terminal';

/* =========================================================================
   Utility
   ========================================================================= */

const EXT_LANG_MAP = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', json: 'json', html: 'html', css: 'css', md: 'markdown',
  sh: 'shell', yaml: 'yaml', yml: 'yaml', toml: 'toml', sql: 'sql', txt: 'plaintext',
};

function langFromPath(filepath) {
  const ext = filepath.split('.').pop()?.toLowerCase() || '';
  return EXT_LANG_MAP[ext] || 'plaintext';
}

/* =========================================================================
   ContextMenu — floating dropdown
   ========================================================================= */

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" style={{ top: y, left: x }}>
      {items.map((item, i) => (
        <div
          key={i}
          className="context-menu-item"
          onClick={() => { item.action(); onClose(); }}
        >
          {item.icon && <item.icon size={13} />}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
   FileTreeNode — recursive tree item with context menu
   ========================================================================= */

function FileTreeNode({
  node, depth = 0, parentPath = '', activeFile,
  onFileClick, onContextMenu, onCreateFile, onCreateFolder, onRename, onDelete, onDownload,
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const isDir = node.type === 'directory';
  const isActive = !isDir && fullPath === activeFile;

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, fullPath, isDir);
  };

  if (isDir) {
    return (
      <>
        <div
          className="tree-item directory"
          style={{ paddingLeft: 14 + depth * 16 }}
          onClick={() => setExpanded((e) => !e)}
          onContextMenu={handleContextMenu}
        >
          {expanded ? <ChevronDown className="icon" size={14} /> : <ChevronRight className="icon" size={14} />}
          {expanded ? <FolderOpen className="icon" size={15} /> : <FolderClosed className="icon" size={15} />}
          <span className="tree-item-name" title={fullPath}>{node.name}</span>
          
          <div className="tree-hover-actions">
            <button
              className="tree-action-btn"
              title="New File in this folder"
              onClick={(e) => { e.stopPropagation(); onCreateFile?.(fullPath); }}
            >
              <FilePlus size={12} />
            </button>
            <button
              className="tree-action-btn"
              title="New Folder in this folder"
              onClick={(e) => { e.stopPropagation(); onCreateFolder?.(fullPath); }}
            >
              <FolderPlus size={12} />
            </button>
            <button
              className="tree-action-btn"
              title="Rename folder"
              onClick={(e) => { e.stopPropagation(); onRename?.(fullPath); }}
            >
              <Pencil size={12} />
            </button>
            <button
              className="tree-action-btn delete"
              title="Delete folder"
              onClick={(e) => { e.stopPropagation(); onDelete?.(fullPath); }}
            >
              <Trash2 size={12} />
            </button>
            <button
              className="tree-more-btn"
              title="More options"
              onClick={(e) => { e.stopPropagation(); onContextMenu(e, fullPath, true); }}
            >
              <MoreHorizontal size={13} />
            </button>
          </div>
        </div>
        {expanded && node.children?.map((child) => (
          <FileTreeNode
            key={child.name}
            node={child}
            depth={depth + 1}
            parentPath={fullPath}
            activeFile={activeFile}
            onFileClick={onFileClick}
            onContextMenu={onContextMenu}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
            onDownload={onDownload}
          />
        ))}
      </>
    );
  }

  const IconComponent = /\.(py|js|jsx|ts|tsx)$/.test(node.name) ? FileCode2 : FileText;

  return (
    <div
      className={`tree-item file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: 14 + depth * 16 }}
      onClick={() => onFileClick(fullPath)}
      onContextMenu={handleContextMenu}
    >
      <IconComponent className="icon" size={14} />
      <span className="tree-item-name" title={fullPath}>{node.name}</span>
      <div className="tree-hover-actions">
        <button
          className="tree-action-btn"
          title="Rename file"
          onClick={(e) => { e.stopPropagation(); onRename?.(fullPath); }}
        >
          <Pencil size={12} />
        </button>
        <button
          className="tree-action-btn delete"
          title="Delete file"
          onClick={(e) => { e.stopPropagation(); onDelete?.(fullPath); }}
        >
          <Trash2 size={12} />
        </button>
        <button
          className="tree-action-btn"
          title="Download file"
          onClick={(e) => { e.stopPropagation(); onDownload?.(fullPath); }}
        >
          <Download size={12} />
        </button>
        <button
          className="tree-more-btn"
          title="More options"
          onClick={(e) => { e.stopPropagation(); onContextMenu(e, fullPath, false); }}
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   RoadmapCard — Human-in-the-Loop approval card
   ========================================================================= */

function RoadmapCard({ msg, onApprove, onFeedback, disabled }) {
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isApproved = msg.status === 'approved';

  const handleApprove = async () => {
    if (submitting || disabled) return;
    setSubmitting(true);
    try {
      await onApprove();
    } finally {
      setSubmitting(false);
    }
  };

  const handleFeedback = async () => {
    if (!feedback.trim() || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onFeedback(feedback.trim());
      setFeedback('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`roadmap-card ${isApproved ? 'approved' : 'pending'}`}>
      <div className="roadmap-header">
        <div className="roadmap-title">
          <ListChecks size={16} />
          <span>Architectural Roadmap</span>
        </div>
        <span className={`roadmap-status-pill ${isApproved ? 'approved' : 'pending'}`}>
          {isApproved ? '✓ Approved & Executing' : '⏳ Awaiting Approval'}
        </span>
      </div>

      {msg.content && <p className="roadmap-intro">{msg.content}</p>}

      {msg.roadmap?.plan_overview && (
        <div className="roadmap-overview">
          <span className="roadmap-section-title">Overview</span>
          <p>{msg.roadmap.plan_overview}</p>
        </div>
      )}

      {msg.roadmap?.steps && msg.roadmap.steps.length > 0 && (
        <div className="roadmap-steps-container">
          <span className="roadmap-section-title">Execution Steps</span>
          <div className="roadmap-steps-list">
            {msg.roadmap.steps.map((st, idx) => (
              <div key={idx} className="roadmap-step-item">
                <div className="roadmap-step-head">
                  <span className="step-num">Step {st.step_number || idx + 1}</span>
                  <span className={`step-role-tag role-${st.assigned_role}`}>
                    {st.assigned_role}
                  </span>
                </div>
                <div className="step-inst">{st.instructions}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {msg.roadmap?.estimated_files && msg.roadmap.estimated_files.length > 0 && (
        <div className="roadmap-files-container">
          <span className="roadmap-section-title">Estimated Files</span>
          <div className="roadmap-files-pills">
            {msg.roadmap.estimated_files.map((file, idx) => (
              <span key={idx} className="roadmap-file-pill">
                <FileCode2 size={12} />
                <span>{file}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {!isApproved && (
        <div className="roadmap-actions-bar">
          <button
            className="roadmap-proceed-btn"
            onClick={handleApprove}
            disabled={submitting || disabled}
            title="Approve plan and resume execution"
          >
            <CheckCircle2 size={16} />
            <span>Proceed</span>
          </button>

          <div className="roadmap-feedback-form">
            <input
              type="text"
              className="roadmap-feedback-input"
              placeholder="Custom instructions (e.g. Change database to PostgreSQL)..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleFeedback();
                }
              }}
              disabled={submitting || disabled}
            />
            <button
              className="roadmap-update-btn"
              onClick={handleFeedback}
              disabled={submitting || disabled || !feedback.trim()}
            >
              Update Plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   ChatMessage — single chat bubble, file pill, roadmap card, or final summary
   ========================================================================= */

function ChatMessage({ msg, onOpenFile, onApproveRoadmap, onFeedbackRoadmap, disabled }) {
  if (msg.type === 'system_event') {
    return (
      <div className="chat-system-event">
        <Activity size={12} />
        <span>{msg.content}</span>
      </div>
    );
  }

  // Objective 3.1: Live File Pill in chat stream
  if (msg.type === 'file_pill') {
    return (
      <div
        className="chat-file-pill"
        onClick={() => onOpenFile?.(msg.path)}
        title={`Click to open ${msg.path} in editor`}
      >
        <CheckCircle2 size={14} className="pill-check-icon" />
        <span className="pill-action">Created</span>
        <code className="pill-filename">{msg.path}</code>
        <span className="pill-hint">Open</span>
      </div>
    );
  }

  // Objective 2: Human-in-the-Loop Roadmap Plan Card
  if (msg.type === 'roadmap') {
    return (
      <RoadmapCard
        msg={msg}
        onApprove={onApproveRoadmap}
        onFeedback={onFeedbackRoadmap}
        disabled={disabled}
      />
    );
  }

  // Objective 3.2: Final Summary
  if (msg.type === 'final_summary') {
    return (
      <div className="chat-bubble assistant final-summary-bubble">
        <div className="chat-bubble-icon">
          <Sparkles size={15} className="summary-sparkle-icon" />
        </div>
        <div className="chat-bubble-content">
          <div className="summary-header-badge">
            <CheckCircle2 size={14} />
            <span>Execution Completed</span>
          </div>
          <pre className="chat-text">{msg.content}</pre>
          {msg.files && msg.files.length > 0 && (
            <div className="summary-files-section">
              <div className="summary-files-label">Created & Modified Files:</div>
              <div className="summary-files-list">
                {msg.files.map((file, i) => (
                  <button
                    key={i}
                    className="summary-file-btn"
                    onClick={() => onOpenFile?.(file)}
                    title={`Open ${file} in Monaco Editor`}
                  >
                    <FileCode2 size={13} />
                    <span>{file}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isUser = msg.sender === 'user';

  return (
    <div className={`chat-bubble ${isUser ? 'user' : 'assistant'}`}>
      <div className="chat-bubble-icon">
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className="chat-bubble-content">
        <pre className="chat-text">{msg.content}</pre>
        {msg.sub_tasks && msg.sub_tasks.length > 0 && (
          <div className="chat-subtasks">
            {msg.sub_tasks.map((st, i) => (
              <div key={i} className="chat-subtask-item">
                <Zap size={10} /> {st}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/* =========================================================================
   TerminalPane — xterm.js panel
   ========================================================================= */

const TerminalPane = forwardRef(function TerminalPane(
  { visible, isRunning, runningFile, previewInfo, theme = 'high-contrast' },
  ref
) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const pendingCommandsRef = useRef([]);

  const getTerminalTheme = useCallback((t) => {
    return t === 'high-contrast' ? {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#38bdf8',
      selectionBackground: 'rgba(56, 189, 248, 0.45)',
      black: '#000000',
      red: '#ff4d6d',
      green: '#00f59b',
      yellow: '#ffd166',
      blue: '#38bdf8',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#ffffff',
    } : {
      background: '#0a0a0f',
      foreground: '#e4e4ed',
      cursor: '#3b82f6',
      selectionBackground: 'rgba(59, 130, 246, 0.3)',
      black: '#1e1e28',
      red: '#f43f5e',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#e4e4ed',
    };
  }, []);

  useImperativeHandle(ref, () => ({
    sendCommand: (cmd) => {
      const formatted = cmd.trim() + '\r';
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(formatted);
      } else {
        pendingCommandsRef.current.push(formatted);
      }
      termRef.current?.focus();
    },
    sendRaw: (data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    },
    stopProcess: () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send('\x03');
      }
    },
    focus: () => {
      termRef.current?.focus();
    },
    fit: () => {
      fitAddonRef.current?.fit();
    },
  }));

  // Update theme dynamically when toggled
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getTerminalTheme(theme);
    }
  }, [theme, getTerminalTheme]);

  useEffect(() => {
    if (!containerRef.current) return;

    // If terminal is already initialized, just re-fit on visibility change
    if (termRef.current) {
      if (visible) {
        setTimeout(() => {
          fitAddonRef.current?.fit();
          termRef.current?.focus();
        }, 80);
      }
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Menlo', monospace",
      theme: getTerminalTheme(theme),
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const ws = new WebSocket(WS_TERMINAL_URL);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
      }
      // Flush any queued commands
      if (pendingCommandsRef.current.length > 0) {
        const queued = [...pendingCommandsRef.current];
        pendingCommandsRef.current = [];
        setTimeout(() => {
          queued.forEach((c) => ws.send(c));
        }, 300);
      }
    };

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(evt.data));
      } else {
        term.write(evt.data);
      }
    };

    ws.onclose = () => term.write('\r\n\x1b[31m[Terminal disconnected]\x1b[0m\r\n');

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [visible]);

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TerminalSquare size={13} />
          <span>Terminal</span>
        </div>
        {isRunning && runningFile && (
          <div className="terminal-header-status">
            <span className="terminal-running-indicator">
              <span className="terminal-running-dot" />
              Running: <code>{runningFile}</code>
            </span>
            {previewInfo && (
              <a
                href={previewInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="terminal-preview-link"
                title={`Open preview: ${previewInfo.url}`}
              >
                <Globe size={11} />
                <span>{previewInfo.label}</span>
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        )}
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
});

/* =========================================================================
   App — Main IDE
   ========================================================================= */

export default function App() {
  // --- Explorer state ---
  const [tree, setTree] = useState(null);
  const [treeLoading, setTreeLoading] = useState(false);

  // --- Editor state ---
  const [openFiles, setOpenFiles] = useState([]);
  const [activeTab, setActiveTab] = useState(null);

  // --- Phase 4 Source Control & Diff state ---
  const [sidebarView, setSidebarView] = useState('explorer'); // 'explorer' | 'source_control'
  const [gitChangesCount, setGitChangesCount] = useState(0);
  const [diffView, setDiffView] = useState(null); // { path: string, original: string, modified: string } | null

  // --- Theme state (High Contrast Dark vs Standard Dark) ---
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('spark_theme') || 'high-contrast';
  });

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'high-contrast' ? 'dark' : 'high-contrast';
      localStorage.setItem('spark_theme', next);
      return next;
    });
  }, []);

  // --- Chat state ---
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // --- WebSocket events state ---
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);

  // --- Terminal state ---
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const resizingRef = useRef(false);

  // --- Context menu state ---
  const [ctxMenu, setCtxMenu] = useState(null);

  // --- Runner & Preview state ---
  const [isRunning, setIsRunning] = useState(false);
  const [runningFile, setRunningFile] = useState(null);
  const [previewInfo, setPreviewInfo] = useState(null);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const terminalRef = useRef(null);

  const getRunConfigForFile = useCallback((file) => {
    if (!file) return null;
    const path = file.path;
    const content = file.content || '';
    const ext = path.split('.').pop()?.toLowerCase();

    if (ext === 'html' || ext === 'htm') {
      const port = 3000;
      return {
        type: 'web',
        cmd: `pkill -f "http.server ${port}" 2>/dev/null; python3 -m http.server ${port}`,
        port,
        url: `http://localhost:${port}/${path}`,
        label: `localhost:${port}/${path}`,
      };
    }

    if (ext === 'py') {
      const portMatch =
        content.match(/(?:port|PORT)\s*[=:]\s*(\d{2,5})/) ||
        content.match(/localhost:(\d{2,5})/) ||
        content.match(/127\.0\.0\.1:(\d{2,5})/);
      const isServer = /uvicorn|flask|fastapi|http\.server|socketserver|app\.run/i.test(content);
      const port = portMatch ? parseInt(portMatch[1], 10) : (isServer ? 5000 : null);

      return {
        type: port ? 'web' : 'script',
        cmd: `python3 "${path}"`,
        port,
        url: port ? `http://localhost:${port}` : null,
        label: port ? `localhost:${port}` : null,
      };
    }

    if (ext === 'js' || ext === 'mjs' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') {
      const portMatch =
        content.match(/(?:port|PORT)\s*[=:]\s*(\d{2,5})/) ||
        content.match(/localhost:(\d{2,5})/);
      const isServer = /express|listen|createServer|fastify|koa/i.test(content);
      const port = portMatch ? parseInt(portMatch[1], 10) : (isServer ? 3000 : null);
      return {
        type: port ? 'web' : 'script',
        cmd: `node "${path}"`,
        port,
        url: port ? `http://localhost:${port}` : null,
        label: port ? `localhost:${port}` : null,
      };
    }

    if (ext === 'sh') {
      return {
        type: 'script',
        cmd: `bash "${path}"`,
        port: null,
        url: null,
        label: null,
      };
    }

    return {
      type: 'script',
      cmd: `echo "Executed ${path}"`,
      port: null,
      url: null,
      label: null,
    };
  }, []);

  const handleRun = useCallback(() => {
    const file = openFiles.find((f) => f.path === activeTab);
    if (!file) return;

    const config = getRunConfigForFile(file);
    if (!config) return;

    // Ensure terminal is visible so user sees the process running in the terminal
    setTerminalVisible(true);

    // Send command to the terminal process
    terminalRef.current?.sendCommand(config.cmd);

    setIsRunning(true);
    setRunningFile(file.path);

    if (config.url) {
      setPreviewInfo({
        url: config.url,
        label: config.label,
        port: config.port,
        filePath: file.path,
      });
      setShowLivePreview(true);
    } else {
      setPreviewInfo(null);
      setShowLivePreview(false);
    }
  }, [openFiles, activeTab, getRunConfigForFile]);

  const handleStop = useCallback(() => {
    terminalRef.current?.stopProcess();
    if (previewInfo?.port === 3000) {
      terminalRef.current?.sendCommand('pkill -f "http.server 3000" 2>/dev/null');
    }
    setIsRunning(false);
    setRunningFile(null);
  }, [previewInfo]);

  // ==========================
  // Fetch file tree
  // ==========================
  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/workspace/tree`);
      if (res.ok) setTree(await res.json());
    } catch (err) {
      console.error('Failed to fetch tree:', err);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  // ==========================
  // Phase 4: Git & File operations
  // ==========================
  const fetchGitStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/git/status`);
      if (res.ok) {
        const data = await res.json();
        setGitChangesCount((data.changes || []).length);
      }
    } catch (err) {
      console.error('Failed to fetch git status:', err);
    }
  }, []);

  useEffect(() => {
    fetchGitStatus();
  }, [fetchGitStatus]);

  const openDiffView = useCallback(async (filepath) => {
    try {
      // 1. Fetch original content at HEAD
      const origRes = await fetch(`${API_BASE}/git/original?path=${encodeURIComponent(filepath)}`);
      let origContent = '';
      if (origRes.ok) {
        const origData = await origRes.json();
        origContent = origData.content ?? '';
      }

      // 2. Fetch current modified content (from openFiles or disk)
      let modContent = '';
      const existing = openFiles.find((f) => f.path === filepath);
      if (existing) {
        modContent = existing.content;
      } else {
        const fileRes = await fetch(`${API_BASE}/workspace/file?path=${encodeURIComponent(filepath)}`);
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          modContent = fileData.content ?? '';
        }
      }

      setDiffView({
        path: filepath,
        original: origContent,
        modified: modContent,
      });
    } catch (err) {
      console.error('Failed to open diff view:', err);
    }
  }, [openFiles]);

  const downloadWorkspaceZip = useCallback(() => {
    const link = document.createElement('a');
    link.href = `${API_BASE}/workspace/export`;
    link.download = 'spark_workspace.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const openFile = useCallback(async (filepath) => {
    setDiffView(null);
    const existing = openFiles.find((f) => f.path === filepath);
    if (existing) { setActiveTab(filepath); return; }

    try {
      const res = await fetch(`${API_BASE}/workspace/file?path=${encodeURIComponent(filepath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOpenFiles((prev) => [...prev, { path: filepath, content: data.content, dirty: false }]);
      setActiveTab(filepath);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [openFiles]);

  const closeTab = useCallback((filepath, e) => {
    e?.stopPropagation();
    setOpenFiles((prev) => prev.filter((f) => f.path !== filepath));
    if (activeTab === filepath) {
      setActiveTab((prev) => {
        const remaining = openFiles.filter((f) => f.path !== filepath);
        return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
      });
    }
  }, [activeTab, openFiles]);

  const onEditorChange = useCallback((value) => {
    if (!activeTab) return;
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === activeTab ? { ...f, content: value, dirty: true } : f))
    );
  }, [activeTab]);

  const saveActiveFile = useCallback(async () => {
    const file = openFiles.find((f) => f.path === activeTab);
    if (!file || !file.dirty) return;
    try {
      await fetch(`${API_BASE}/workspace/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, content: file.content }),
      });
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === activeTab ? { ...f, dirty: false } : f))
      );
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [activeTab, openFiles]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveActiveFile(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveFile]);

  // ==========================
  // Workspace CRUD
  // ==========================
  const createNewFile = useCallback(async (dirPath) => {
    const promptMsg = dirPath ? `New file name inside "${dirPath}":` : 'New file name (e.g. index.js):';
    const name = window.prompt(promptMsg);
    if (!name) return;
    const filePath = dirPath ? `${dirPath}/${name}` : name;
    try {
      await fetch(`${API_BASE}/workspace/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: '' }),
      });
      await fetchTree();
      openFile(filePath);
    } catch (err) { console.error('Create file failed:', err); }
  }, [fetchTree, openFile]);

  const createNewFolder = useCallback(async (dirPath) => {
    const promptMsg = dirPath ? `New folder name inside "${dirPath}":` : 'New folder name:';
    const name = window.prompt(promptMsg);
    if (!name) return;
    const folderPath = dirPath ? `${dirPath}/${name}` : name;
    try {
      await fetch(`${API_BASE}/workspace/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
      });
      await fetchTree();
    } catch (err) { console.error('Create folder failed:', err); }
  }, [fetchTree]);

  const renameItem = useCallback(async (oldPath) => {
    const oldName = oldPath.split('/').pop();
    const newName = window.prompt('Rename to:', oldName);
    if (!newName || newName === oldName) return;
    const parts = oldPath.split('/');
    parts[parts.length - 1] = newName;
    const newPath = parts.join('/');
    try {
      await fetch(`${API_BASE}/workspace/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
      });
      // Update open tabs if the renamed file is open
      setOpenFiles((prev) => prev.map((f) => f.path === oldPath ? { ...f, path: newPath } : f));
      if (activeTab === oldPath) setActiveTab(newPath);
      await fetchTree();
    } catch (err) { console.error('Rename failed:', err); }
  }, [fetchTree, activeTab]);

  const deleteItem = useCallback(async (itemPath) => {
    if (!window.confirm(`Delete "${itemPath}"?`)) return;
    try {
      await fetch(`${API_BASE}/workspace/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath }),
      });
      setOpenFiles((prev) => prev.filter((f) => f.path !== itemPath && !f.path.startsWith(`${itemPath}/`)));
      if (activeTab === itemPath || activeTab?.startsWith(`${itemPath}/`)) setActiveTab(null);
      await fetchTree();
    } catch (err) { console.error('Delete failed:', err); }
  }, [fetchTree, activeTab]);

  const downloadFile = useCallback(async (filepath) => {
    try {
      const res = await fetch(`${API_BASE}/workspace/file?path=${encodeURIComponent(filepath)}`);
      const data = await res.json();
      const blob = new Blob([data.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filepath.split('/').pop();
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Download failed:', err); }
  }, []);

  // Context menu handler
  const handleTreeContextMenu = useCallback((e, path, isDir) => {
    const items = [];
    if (isDir) {
      items.push({ label: 'New File', icon: FilePlus, action: () => createNewFile(path) });
      items.push({ label: 'New Folder', icon: FolderPlus, action: () => createNewFolder(path) });
    }
    items.push({ label: 'Rename', icon: Pencil, action: () => renameItem(path) });
    items.push({ label: 'Delete', icon: Trash2, action: () => deleteItem(path) });
    if (!isDir) {
      items.push({ label: 'Download', icon: Download, action: () => downloadFile(path) });
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [createNewFile, createNewFolder, renameItem, deleteItem, downloadFile]);

  // ==========================
  // Objective 2: Human-in-the-Loop Roadmap Actions
  // ==========================
  const approveRoadmap = useCallback(async () => {
    setChatLoading(true);
    try {
      const res = await fetch(`${API_BASE}/roadmap/approve`, { method: 'POST' });
      const data = await res.json();
      setMessages((prev) => [
        ...prev.map((m) => (m.type === 'roadmap' ? { ...m, status: 'approved' } : m)),
        { type: 'system_event', content: data.content || 'Roadmap approved! Starting execution...' }
      ]);
    } catch (err) {
      console.error('Failed to approve roadmap:', err);
    } finally {
      setChatLoading(false);
    }
  }, []);

  const feedbackRoadmap = useCallback(async (feedbackText) => {
    setChatLoading(true);
    setMessages((prev) => [
      ...prev,
      { type: 'chat', sender: 'user', content: feedbackText }
    ]);
    try {
      const res = await fetch(`${API_BASE}/roadmap/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedbackText }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          type: 'roadmap',
          content: data.content,
          roadmap: data.roadmap,
          status: data.status || 'awaiting_approval',
        }
      ]);
    } catch (err) {
      console.error('Failed to update roadmap:', err);
    } finally {
      setChatLoading(false);
    }
  }, []);

  // ==========================
  // Chat with Master Agent
  // ==========================
  const sendChat = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatLoading) return;

    setMessages((prev) => [...prev, { type: 'chat', sender: 'user', content: prompt }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();

      if (data.type === 'roadmap') {
        setMessages((prev) => [
          ...prev,
          {
            type: 'roadmap',
            content: data.content,
            roadmap: data.roadmap,
            status: data.status || 'awaiting_approval',
          }
        ]);
      } else if (data.type === 'chat') {
        setMessages((prev) => [...prev, { type: 'chat', sender: 'assistant', content: data.content }]);
      } else {
        setMessages((prev) => [...prev, {
          type: 'system_event',
          content: data.content,
          sub_tasks: data.sub_tasks,
        }]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { type: 'chat', sender: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading]);

  // ==========================
  // WebSocket connection
  // ==========================
  useEffect(() => {
    let reconnectTimer;

    function connect() {
      const ws = new WebSocket(WS_EVENTS_URL);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => { setWsConnected(false); reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data);

          // 1. Objective 1.2: Real-time file sync
          if (event.type === 'fs_update') {
            fetchTree();
            fetchGitStatus();
            return;
          }

          // Phase 4: Git status update
          if (event.type === 'git_update') {
            fetchTree();
            fetchGitStatus();
            return;
          }

          // 2. Objective 3.1: Live File Pill in Chat stream
          if (event.type === 'file_written') {
            setMessages((prev) => [...prev, {
              type: 'file_pill',
              path: event.path,
              action: event.action || 'created',
            }]);
            fetchTree();
            return;
          }

          // 3. Objective 3.2: Final Summary
          if (event.type === 'final_summary') {
            setMessages((prev) => [...prev, {
              type: 'final_summary',
              content: event.content,
              files: event.files || [],
            }]);
            fetchTree();
            return;
          }

          // 4. Objective 2: Roadmap approval status broadcast
          if (event.type === 'roadmap_status') {
            setMessages((prev) =>
              prev.map((m) =>
                m.type === 'roadmap' ? { ...m, status: event.status } : m
              )
            );
            return;
          }

          // 5. Standard Blackboard events
          const role = event.role || event.agent_role || 'system';
          const status = event.status || '';

          if (role !== 'user') {
            let label = `${role}`;
            if (status.includes('pending_')) label += ` → ${status.replace('pending_', '')}`;
            else if (status === 'task_completed') label += ' ✓ task completed';
            else label += ` (${status})`;

            setMessages((prev) => [...prev, {
              type: 'system_event',
              content: label,
            }]);
          }

          // Refresh tree when coder finishes or task is completed
          if (status === 'pending_reviewer' || status === 'task_completed') {
            fetchTree();
          }
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => { clearTimeout(reconnectTimer); wsRef.current?.close(); };
  }, [fetchTree]);


  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ==========================
  // Terminal resize drag
  // ==========================
  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    resizingRef.current = true;
    const startY = e.clientY;
    const startH = terminalHeight;

    const onMove = (me) => {
      const delta = startY - me.clientY;
      setTerminalHeight(Math.max(100, Math.min(window.innerHeight * 0.5, startH + delta)));
    };
    const onUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  // Derived
  const activeFile = openFiles.find((f) => f.path === activeTab);

  // ======================================================================
  // RENDER
  // ======================================================================
  return (
    <div
      className={`ide-shell ${theme === 'high-contrast' ? 'theme-high-contrast' : ''}`}
      data-theme={theme}
    >
      {/* ======================== Title Bar ======================== */}
      <div className="ide-titlebar">
        <div className="spark-logo">
          <Sparkles size={16} />
          SPARK IDE
        </div>
        <span className="text-secondary" style={{ fontSize: 12 }}>
          Multi-Agent Software Sandbox
        </span>
        <div style={{ flex: 1 }} />
        <button
          className={`theme-toggle-btn ${theme === 'high-contrast' ? 'active' : ''}`}
          onClick={toggleTheme}
          title={theme === 'high-contrast' ? 'Switch to Standard Dark theme' : 'Switch to High Contrast Dark theme'}
        >
          <Contrast size={13} />
          <span className="theme-toggle-label">{theme === 'high-contrast' ? 'High Contrast' : 'Standard Dark'}</span>
        </button>
        <button
          className="terminal-toggle-btn"
          onClick={() => setTerminalVisible((v) => !v)}
          title="Toggle Terminal"
        >
          <TerminalSquare size={14} />
        </button>
        <div className="ws-status">
          <div className={`ws-dot ${wsConnected ? 'connected' : ''}`} />
          {wsConnected ? 'Live' : 'Offline'}
        </div>
      </div>

      {/* ======================== Body ======================== */}
      <div className="ide-body">
        {/* ---------- Left: File Explorer ---------- */}
        <div className="sidebar-explorer">
          {/* View Switcher: Explorer vs Source Control */}
          <div className="sidebar-view-tabs">
            <button
              className={`sidebar-tab-btn ${sidebarView === 'explorer' ? 'active' : ''}`}
              onClick={() => setSidebarView('explorer')}
              title="File Explorer"
            >
              <FolderOpen size={13} />
              <span>Explorer</span>
            </button>
            <button
              className={`sidebar-tab-btn ${sidebarView === 'source_control' ? 'active' : ''}`}
              onClick={() => {
                setSidebarView('source_control');
                fetchGitStatus();
              }}
              title="Source Control"
            >
              <GitBranch size={13} />
              <span>Source Control</span>
              {gitChangesCount > 0 && (
                <span className="sidebar-badge">{gitChangesCount}</span>
              )}
            </button>
          </div>

          {sidebarView === 'explorer' ? (
            <>
              <div className="sidebar-header">
                <span>Explorer</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="refresh-btn" onClick={() => createNewFile('')} title="New File">
                    <FilePlus size={13} />
                  </button>
                  <button className="refresh-btn" onClick={() => createNewFolder('')} title="New Folder">
                    <FolderPlus size={13} />
                  </button>
                  <button className="refresh-btn" onClick={downloadWorkspaceZip} title="Download Project (ZIP)">
                    <Download size={13} />
                  </button>
                  <button className="refresh-btn" onClick={fetchTree} title="Refresh">
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>
              <div className="file-tree">
                {treeLoading && (
                  <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
                )}
                {tree && tree.children?.map((child) => (
                  <FileTreeNode
                    key={child.name}
                    node={child}
                    depth={0}
                    parentPath=""
                    activeFile={activeTab}
                    onFileClick={openFile}
                    onContextMenu={handleTreeContextMenu}
                    onCreateFile={createNewFile}
                    onCreateFolder={createNewFolder}
                    onRename={renameItem}
                    onDelete={deleteItem}
                    onDownload={downloadFile}
                  />
                ))}
                {tree && (!tree.children || tree.children.length === 0) && (
                  <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                    Workspace is empty.<br />Use the chat to generate code.
                  </div>
                )}
              </div>
            </>
          ) : (
            <SourceControl
              onFileClick={openDiffView}
              activeDiffPath={diffView?.path}
              onStatusUpdate={setGitChangesCount}
            />
          )}
        </div>

        {/* ---------- Center: Editor + Terminal ---------- */}
        <div className="editor-terminal-area">
          <div className="editor-area">
            <div className="editor-tabs-bar">
              <div className="editor-tabs">
                {openFiles.map((f) => (
                  <div
                    key={f.path}
                    className={`editor-tab ${f.path === activeTab && !diffView ? 'active' : ''}`}
                    onClick={() => {
                      setActiveTab(f.path);
                      setDiffView(null);
                    }}
                  >
                    <FileCode2 size={13} style={{ opacity: 0.6 }} />
                    <span>{f.dirty && '● '}{f.path.split('/').pop()}</span>
                    <button className="close-btn" onClick={(e) => closeTab(f.path, e)}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Marked Location: Run Button & Localhost Preview Link */}
              <div className="editor-toolbar-actions">
                {previewInfo && (
                  <div className="preview-pill-group">
                    <a
                      href={previewInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="editor-preview-link"
                      title={`Open preview in new tab: ${previewInfo.url}`}
                    >
                      <span className="preview-live-dot" />
                      <Globe size={13} />
                      <span className="preview-url-text">{previewInfo.label}</span>
                      <ExternalLink size={12} />
                    </a>
                    <button
                      className={`preview-toggle-btn ${showLivePreview ? 'active' : ''}`}
                      onClick={() => setShowLivePreview((v) => !v)}
                      title={showLivePreview ? 'Hide in-editor live preview' : 'Show in-editor live preview'}
                    >
                      <Eye size={13} />
                      <span>{showLivePreview ? 'Code' : 'Preview'}</span>
                    </button>
                  </div>
                )}

                <button
                  className={`editor-run-btn ${isRunning ? 'running' : ''}`}
                  onClick={isRunning ? handleStop : handleRun}
                  disabled={!activeFile || !!diffView}
                  title={
                    activeFile
                      ? (isRunning ? `Stop running ${activeFile.path}` : `Run ${activeFile.path} in terminal`)
                      : 'Open a file to run'
                  }
                >
                  {isRunning ? (
                    <>
                      <Square size={12} fill="currentColor" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Play size={12} fill="currentColor" />
                      <span>Run</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {diffView ? (
              <div className="diff-editor-container">
                <div className="diff-header-bar">
                  <div className="diff-title">
                    <GitCompare size={14} style={{ color: 'var(--accent-blue)' }} />
                    <span className="diff-filename">{diffView.path}</span>
                    <span className="diff-badge">HEAD ↔ Working Copy</span>
                  </div>
                  <div className="diff-actions">
                    <button
                      className="diff-action-btn"
                      onClick={() => {
                        const target = diffView.path;
                        setDiffView(null);
                        openFile(target);
                      }}
                      title="Open file in regular editor"
                    >
                      <Code2 size={13} />
                      <span>Edit File</span>
                    </button>
                    <button
                      className="diff-close-btn"
                      onClick={() => setDiffView(null)}
                      title="Close Diff"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="diff-monaco-wrapper">
                  <DiffEditor
                    theme={theme === 'high-contrast' ? 'hc-black' : 'vs-dark'}
                    original={diffView.original}
                    modified={diffView.modified}
                    language={langFromPath(diffView.path)}
                    options={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Menlo', monospace",
                      fontLigatures: true,
                      readOnly: true,
                      renderSideBySide: true,
                      automaticLayout: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                    }}
                  />
                </div>
              </div>
            ) : activeFile ? (
              <div className="editor-content-split">
                <div className={`monaco-wrapper ${showLivePreview && previewInfo ? 'half-width' : ''}`}>
                  <Editor
                    theme={theme === 'high-contrast' ? 'hc-black' : 'vs-dark'}
                    language={langFromPath(activeFile.path)}
                    value={activeFile.content}
                    onChange={onEditorChange}
                    options={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Menlo', monospace",
                      fontLigatures: true,
                      minimap: { enabled: true, scale: 1 },
                      smoothScrolling: true,
                      cursorBlinking: 'smooth',
                      cursorSmoothCaretAnimation: 'on',
                      padding: { top: 12 },
                      scrollBeyondLastLine: false,
                      renderLineHighlight: 'all',
                      bracketPairColorization: { enabled: true },
                      automaticLayout: true,
                    }}
                  />
                </div>
                {showLivePreview && previewInfo && (
                  <div className="live-preview-pane">
                    <div className="live-preview-header">
                      <div className="preview-address-bar">
                        <Globe size={13} />
                        <input
                          type="text"
                          readOnly
                          value={previewInfo.url}
                          className="preview-address-input"
                        />
                        <button
                          className="preview-refresh-btn"
                          onClick={() => {
                            const iframe = document.getElementById('spark-preview-iframe');
                            if (iframe) iframe.src = iframe.src;
                          }}
                          title="Reload preview"
                        >
                          <RotateCw size={12} />
                        </button>
                        <a
                          href={previewInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="preview-external-btn"
                          title="Open preview in new window"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      <button
                        className="preview-close-btn"
                        onClick={() => setShowLivePreview(false)}
                        title="Close preview pane"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <iframe
                      id="spark-preview-iframe"
                      title="Spark Live Preview"
                      src={previewInfo.url}
                      className="live-preview-iframe"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="editor-empty">
                <Code2 size={48} />
                <span>Select a file to begin editing</span>
                <span style={{ fontSize: 12 }}>or chat with Spark to generate code</span>
              </div>
            )}
          </div>

          {/* Terminal resize handle */}
          {terminalVisible && (
            <div className="terminal-resize-handle" onMouseDown={handleResizeMouseDown} />
          )}

          {/* Terminal */}
          <div style={{ height: terminalVisible ? terminalHeight : 0, overflow: 'hidden' }}>
            <TerminalPane
              ref={terminalRef}
              visible={terminalVisible}
              isRunning={isRunning}
              runningFile={runningFile}
              previewInfo={previewInfo}
              theme={theme}
            />
          </div>
        </div>

        {/* ---------- Right: Chat Panel ---------- */}
        <div className="sidebar-chat">
          <div className="sidebar-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Bot size={13} />
              Spark Chat
            </span>
            <span className="text-muted" style={{ fontSize: 10, fontWeight: 400 }}>
              Master Agent
            </span>
          </div>

          <div className="chat-feed">
            {messages.length === 0 && (
              <div className="chat-empty">
                <Sparkles size={24} style={{ opacity: 0.2 }} />
                <div>Chat with Spark</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  Ask questions or request code generation
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage
                key={i}
                msg={msg}
                onOpenFile={openFile}
                onApproveRoadmap={approveRoadmap}
                onFeedbackRoadmap={feedbackRoadmap}
                disabled={chatLoading}
              />
            ))}
            <div ref={chatEndRef} />
          </div>


          <div className="chat-input-area">
            <input
              type="text"
              className="chat-input"
              placeholder="Ask Spark anything…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              disabled={chatLoading}
            />
            <button
              className="chat-send-btn"
              onClick={sendChat}
              disabled={chatLoading || !chatInput.trim()}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* ======================== Status Bar ======================== */}
      <div className="ide-statusbar">
        <span>⚡ Spark Multi-Agent Sandbox</span>
        <span>
          {openFiles.length} file{openFiles.length !== 1 ? 's' : ''} open
          {activeFile?.dirty ? ' • Unsaved changes' : ''}
        </span>
      </div>

      {/* Context Menu Portal */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
