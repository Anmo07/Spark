import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
  Zap,
  FolderOpen,
  FolderClosed,
  FileCode2,
  FileText,
  RefreshCw,
  X,
  Code2,
  Radio,
  ChevronRight,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import './App.css';

/* =========================================================================
   Constants
   ========================================================================= */

const API_BASE = '';  // proxied by Vite in dev
const WS_URL =
  (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
  window.location.host +
  '/ws/events';

/* =========================================================================
   Utility — language detection for Monaco
   ========================================================================= */

const EXT_LANG_MAP = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  json: 'json',
  html: 'html',
  css: 'css',
  md: 'markdown',
  sh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  txt: 'plaintext',
};

function langFromPath(filepath) {
  const ext = filepath.split('.').pop()?.toLowerCase() || '';
  return EXT_LANG_MAP[ext] || 'plaintext';
}

/* =========================================================================
   FileTreeNode — recursive tree item
   ========================================================================= */

function FileTreeNode({ node, depth = 0, parentPath = '', activeFile, onFileClick }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const isDir = node.type === 'directory';
  const isActive = !isDir && fullPath === activeFile;

  if (isDir) {
    return (
      <>
        <div
          className={`tree-item directory`}
          style={{ paddingLeft: 14 + depth * 16 }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <ChevronDown className="icon" size={14} />
          ) : (
            <ChevronRight className="icon" size={14} />
          )}
          {expanded ? (
            <FolderOpen className="icon" size={15} />
          ) : (
            <FolderClosed className="icon" size={15} />
          )}
          <span>{node.name}</span>
        </div>
        {expanded &&
          node.children?.map((child) => (
            <FileTreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              parentPath={fullPath}
              activeFile={activeFile}
              onFileClick={onFileClick}
            />
          ))}
      </>
    );
  }

  const IconComponent = node.name.endsWith('.py') ||
    node.name.endsWith('.js') ||
    node.name.endsWith('.jsx') ||
    node.name.endsWith('.ts')
    ? FileCode2
    : FileText;

  return (
    <div
      className={`tree-item file ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: 14 + depth * 16 }}
      onClick={() => onFileClick(fullPath)}
    >
      <IconComponent className="icon" size={14} />
      <span>{node.name}</span>
    </div>
  );
}

/* =========================================================================
   EventCard — single blackboard event
   ========================================================================= */

function EventCard({ event }) {
  const role = event.role || event.agent_role || 'system';
  const dataStr =
    typeof event.data === 'string'
      ? event.data
      : JSON.stringify(event.data, null, 2);

  // Truncate very long data for display
  const displayData = dataStr.length > 500 ? dataStr.slice(0, 500) + '\n…' : dataStr;

  return (
    <div className="event-card">
      <div className="event-card-header">
        <span className={`event-badge ${role}`}>{role}</span>
        <span className="event-status">{event.status}</span>
      </div>
      <pre className="event-data">{displayData}</pre>
      {event.timestamp && (
        <div className="event-timestamp">
          {new Date(event.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   App — Main 3-pane IDE
   ========================================================================= */

export default function App() {
  // --- Explorer state ---
  const [tree, setTree] = useState(null);
  const [treeLoading, setTreeLoading] = useState(false);

  // --- Editor state ---
  const [openFiles, setOpenFiles] = useState([]);
  // Each entry: { path, content, dirty }
  const [activeTab, setActiveTab] = useState(null);

  // --- Blackboard stream state ---
  const [events, setEvents] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const streamEndRef = useRef(null);
  const wsRef = useRef(null);

  // ==========================
  // Fetch file tree
  // ==========================
  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch(`${API_BASE}/workspace/tree`);
      if (res.ok) {
        const data = await res.json();
        setTree(data);
      }
    } catch (err) {
      console.error('Failed to fetch tree:', err);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // ==========================
  // Open a file in the editor
  // ==========================
  const openFile = useCallback(
    async (filepath) => {
      // Already open? Just activate tab
      const existing = openFiles.find((f) => f.path === filepath);
      if (existing) {
        setActiveTab(filepath);
        return;
      }

      try {
        const res = await fetch(
          `${API_BASE}/workspace/file?path=${encodeURIComponent(filepath)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        setOpenFiles((prev) => [...prev, { path: filepath, content: data.content, dirty: false }]);
        setActiveTab(filepath);
      } catch (err) {
        console.error('Failed to open file:', err);
      }
    },
    [openFiles]
  );

  // ==========================
  // Close a tab
  // ==========================
  const closeTab = useCallback(
    (filepath, e) => {
      e?.stopPropagation();
      setOpenFiles((prev) => prev.filter((f) => f.path !== filepath));
      if (activeTab === filepath) {
        setActiveTab((prev) => {
          const remaining = openFiles.filter((f) => f.path !== filepath);
          return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
        });
      }
    },
    [activeTab, openFiles]
  );

  // ==========================
  // Handle content change in Monaco
  // ==========================
  const onEditorChange = useCallback(
    (value) => {
      if (!activeTab) return;
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === activeTab ? { ...f, content: value, dirty: true } : f))
      );
    },
    [activeTab]
  );

  // ==========================
  // Save file (Cmd+S / Ctrl+S)
  // ==========================
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

  // Global Cmd+S handler
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveFile]);

  // ==========================
  // WebSocket connection
  // ==========================
  useEffect(() => {
    let reconnectTimer;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        // Auto-reconnect after 3s
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data);
          setEvents((prev) => [...prev, event]);
        } catch {
          // ignore non-JSON
        }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  // Auto-scroll stream feed
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Derived state
  const activeFile = openFiles.find((f) => f.path === activeTab);

  // ======================================================================
  // RENDER
  // ======================================================================
  return (
    <div className="ide-shell">
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
        <div className="ws-status">
          <div className={`ws-dot ${wsConnected ? 'connected' : ''}`} />
          {wsConnected ? 'Live' : 'Disconnected'}
        </div>
      </div>

      {/* ======================== Body ======================== */}
      <div className="ide-body">
        {/* ---------- Left: File Explorer ---------- */}
        <div className="sidebar-explorer">
          <div className="sidebar-header">
            <span>Explorer</span>
            <button className="refresh-btn" onClick={fetchTree} title="Refresh file tree">
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="file-tree">
            {treeLoading && (
              <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
                Loading…
              </div>
            )}
            {tree &&
              tree.children?.map((child) => (
                <FileTreeNode
                  key={child.name}
                  node={child}
                  depth={0}
                  parentPath=""
                  activeFile={activeTab}
                  onFileClick={openFile}
                />
              ))}
            {tree && (!tree.children || tree.children.length === 0) && (
              <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                Workspace is empty.
                <br />
                Submit a task to generate code.
              </div>
            )}
          </div>
        </div>

        {/* ---------- Center: Monaco Editor ---------- */}
        <div className="editor-area">
          <div className="editor-tabs">
            {openFiles.map((f) => (
              <div
                key={f.path}
                className={`editor-tab ${f.path === activeTab ? 'active' : ''}`}
                onClick={() => setActiveTab(f.path)}
              >
                <FileCode2 size={13} style={{ opacity: 0.6 }} />
                <span>
                  {f.dirty && '● '}
                  {f.path.split('/').pop()}
                </span>
                <button className="close-btn" onClick={(e) => closeTab(f.path, e)}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {activeFile ? (
            <div className="monaco-wrapper">
              <Editor
                theme="vs-dark"
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
          ) : (
            <div className="editor-empty">
              <Code2 size={48} />
              <span>Select a file to begin editing</span>
              <span style={{ fontSize: 12 }}>
                or submit a task to generate code
              </span>
            </div>
          )}
        </div>

        {/* ---------- Right: Blackboard Stream ---------- */}
        <div className="sidebar-stream">
          <div className="sidebar-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Radio size={13} />
              Blackboard Stream
            </span>
            <span className="text-muted" style={{ fontSize: 10, fontWeight: 400 }}>
              {events.length} events
            </span>
          </div>
          <div className="stream-feed">
            {events.length === 0 && (
              <div
                style={{
                  padding: '24px 12px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                }}
              >
                <Zap size={20} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                <div>Waiting for agent events…</div>
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  POST to <code>/task</code> to start the pipeline
                </div>
              </div>
            )}
            {events.map((evt, i) => (
              <EventCard key={`${evt.id ?? i}-${i}`} event={evt} />
            ))}
            <div ref={streamEndRef} />
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
    </div>
  );
}
