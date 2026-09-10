import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
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
} from 'lucide-react';
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
  onFileClick, onContextMenu,
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
          <span className="tree-item-name">{node.name}</span>
          <button
            className="tree-more-btn"
            onClick={(e) => { e.stopPropagation(); onContextMenu(e, fullPath, true); }}
          >
            <MoreHorizontal size={13} />
          </button>
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
      <span className="tree-item-name">{node.name}</span>
      <button
        className="tree-more-btn"
        onClick={(e) => { e.stopPropagation(); onContextMenu(e, fullPath, false); }}
      >
        <MoreHorizontal size={13} />
      </button>
    </div>
  );
}

/* =========================================================================
   ChatMessage — single chat bubble or system event
   ========================================================================= */

function ChatMessage({ msg }) {
  if (msg.type === 'system_event') {
    return (
      <div className="chat-system-event">
        <Activity size={12} />
        <span>{msg.content}</span>
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

function TerminalPane({ visible }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!visible || !containerRef.current) return;

    // Create terminal only once
    if (!termRef.current) {
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Menlo', monospace",
        theme: {
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
        },
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
        // Send initial size
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
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
    } else {
      // Just re-fit when toggling visible
      fitAddonRef.current?.fit();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        <TerminalSquare size={13} />
        <span>Terminal</span>
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}

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
  // File operations
  // ==========================
  const openFile = useCallback(async (filepath) => {
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
    const name = window.prompt('New file name:');
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
    const name = window.prompt('New folder name:');
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
      await fetch(`${API_BASE}/workspace/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath }),
      });
      setOpenFiles((prev) => prev.filter((f) => f.path !== itemPath));
      if (activeTab === itemPath) setActiveTab(null);
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
    const rect = e.currentTarget?.getBoundingClientRect?.() || { left: e.clientX, top: e.clientY };
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

      if (data.type === 'chat') {
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
  // WebSocket connection (events → system events in chat)
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
          const role = event.role || event.agent_role || 'system';
          const status = event.status || '';

          // Show agent transitions as compact system events in chat
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

          // Refresh file tree when coder finishes (new files may exist)
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
          <div className="sidebar-header">
            <span>Explorer</span>
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="refresh-btn" onClick={() => createNewFile('')} title="New File">
                <FilePlus size={13} />
              </button>
              <button className="refresh-btn" onClick={() => createNewFolder('')} title="New Folder">
                <FolderPlus size={13} />
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
              />
            ))}
            {tree && (!tree.children || tree.children.length === 0) && (
              <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                Workspace is empty.<br />Use the chat to generate code.
              </div>
            )}
          </div>
        </div>

        {/* ---------- Center: Editor + Terminal ---------- */}
        <div className="editor-terminal-area">
          <div className="editor-area">
            <div className="editor-tabs">
              {openFiles.map((f) => (
                <div
                  key={f.path}
                  className={`editor-tab ${f.path === activeTab ? 'active' : ''}`}
                  onClick={() => setActiveTab(f.path)}
                >
                  <FileCode2 size={13} style={{ opacity: 0.6 }} />
                  <span>{f.dirty && '● '}{f.path.split('/').pop()}</span>
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
            <TerminalPane visible={terminalVisible} />
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
              <ChatMessage key={i} msg={msg} />
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
