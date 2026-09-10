import { useState, useEffect, useCallback } from 'react';
import { GitCommit, UploadCloud, Undo, RefreshCw, GitBranch } from 'lucide-react';

export default function SourceControl({ onFileClick, activeDiffPath, onStatusUpdate }) {
    const [changes, setChanges] = useState([]);
    const [commitMessage, setCommitMessage] = useState("");
    const [remoteUrl, setRemoteUrl] = useState("");
    const [isPushing, setIsPushing] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [statusMessage, setStatusMessage] = useState("");

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch('/git/status');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const list = data.changes || [];
            setChanges(list);
            onStatusUpdate?.(list.length);
        } catch (err) {
            console.error('Failed to fetch git status:', err);
        }
    }, [onStatusUpdate]);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const handleCommit = async () => {
        if (!commitMessage.trim()) return;
        setIsCommitting(true);
        setErrorMessage("");
        setStatusMessage("");
        try {
            const res = await fetch('/git/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: commitMessage.trim() })
            });
            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                throw new Error(data.detail || data.message || 'Commit failed');
            }
            setCommitMessage("");
            setStatusMessage("Changes committed successfully.");
            await fetchStatus();
            setTimeout(() => setStatusMessage(""), 3000);
        } catch (err) {
            setErrorMessage(err.message);
        } finally {
            setIsCommitting(false);
        }
    };

    const handleKeyDown = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleCommit();
        }
    };

    const handlePush = async () => {
        if (!remoteUrl.trim()) return alert("Please enter an SSH Remote URL (e.g. git@github.com:user/repo.git)");
        setIsPushing(true);
        setErrorMessage("");
        setStatusMessage("");
        try {
            const res = await fetch('/git/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ remote_url: remoteUrl.trim() })
            });
            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                throw new Error(data.detail || data.message || 'Push failed');
            }
            alert("Successfully pushed to GitHub!");
            setStatusMessage("Successfully pushed to remote repository.");
            await fetchStatus();
            setTimeout(() => setStatusMessage(""), 4000);
        } catch (err) {
            setErrorMessage(err.message);
            alert(`Push failed: ${err.message}`);
        } finally {
            setIsPushing(false);
        }
    };

    const handleRevert = async () => {
        if (!confirm("Are you sure you want to undo the last agent action?")) return;
        setErrorMessage("");
        setStatusMessage("");
        try {
            const res = await fetch('/git/revert', { method: 'POST' });
            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                throw new Error(data.detail || data.message || 'Revert failed');
            }
            setStatusMessage("Reverted last commit.");
            await fetchStatus();
            setTimeout(() => setStatusMessage(""), 3000);
        } catch (err) {
            setErrorMessage(err.message);
            alert(`Revert failed: ${err.message}`);
        }
    };

    return (
        <div className="flex flex-col h-full bg-panel text-sm text-zinc-300 select-none">
            {/* Header & Revert */}
            <div className="flex items-center justify-between p-3 border-b border-border">
                <span className="font-semibold text-xs tracking-wider uppercase text-zinc-400 flex items-center gap-2">
                    <GitBranch size={14} /> Source Control
                    {changes.length > 0 && (
                        <span className="bg-blue-600/30 text-blue-400 text-[10px] font-mono px-1.5 py-0.5 rounded-full">
                            {changes.length}
                        </span>
                    )}
                </span>
                <div className="flex gap-2">
                    <button onClick={handleRevert} className="p-1 hover:text-red-400 transition-colors" title="Undo Last Commit (revert HEAD~1)">
                        <Undo size={14} />
                    </button>
                    <button onClick={fetchStatus} className="p-1 hover:text-white transition-colors" title="Refresh Git Status">
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {/* Status / Error feedback */}
            {errorMessage && (
                <div className="px-3 py-1.5 bg-red-950/40 border-b border-red-800/40 text-red-300 text-[11px]">
                    {errorMessage}
                </div>
            )}
            {statusMessage && (
                <div className="px-3 py-1.5 bg-emerald-950/40 border-b border-emerald-800/40 text-emerald-300 text-[11px]">
                    {statusMessage}
                </div>
            )}

            {/* Commit Box */}
            <div className="p-3 border-b border-border flex flex-col gap-2">
                <textarea 
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Message (Cmd+Enter to commit)"
                    className="w-full bg-dark border border-border rounded p-2 text-xs focus:outline-none focus:border-blue-500 resize-none text-zinc-200 placeholder-zinc-500"
                    rows="2"
                />
                <button 
                    onClick={handleCommit} 
                    disabled={isCommitting || changes.length === 0}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white py-1.5 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                    <GitCommit size={14} /> {isCommitting ? "Committing..." : "Commit Changes"}
                </button>
            </div>

            {/* Changed Files List */}
            <div className="flex-1 overflow-y-auto p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 px-2 py-1 flex items-center justify-between">
                    <span>Changes</span>
                    <span>{changes.length}</span>
                </div>
                {changes.length === 0 ? (
                    <div className="text-zinc-600 text-xs text-center mt-6">No uncommitted changes.</div>
                ) : (
                    changes.map((file, i) => {
                        const isSelected = activeDiffPath === file.file;
                        const isDeleted = file.status.includes('D');
                        const isModified = file.status.includes('M');
                        const statusColor = isDeleted
                            ? 'text-rose-400 bg-rose-400/10'
                            : isModified
                            ? 'text-blue-400 bg-blue-400/10'
                            : 'text-emerald-400 bg-emerald-400/10';

                        return (
                            <div 
                                key={i} 
                                onClick={() => onFileClick(file.file)}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
                                    isSelected ? 'bg-blue-950/40 text-blue-200' : 'hover:bg-zinc-800/70'
                                }`}
                                title={`Click to view diff for ${file.file}`}
                            >
                                <span className={`text-[10px] font-mono font-bold px-1 rounded ${statusColor}`}>
                                    {file.status.trim()}
                                </span>
                                <span className="truncate group-hover:text-white transition-colors text-xs font-mono">{file.file}</span>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Push to GitHub */}
            <div className="p-3 border-t border-border flex flex-col gap-2 bg-dark/50">
                <span className="text-[11px] text-zinc-400 font-medium">Remote Sync (SSH)</span>
                <input 
                    type="text" 
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    placeholder="git@github.com:user/repo.git"
                    className="w-full bg-dark border border-border rounded p-2 text-xs focus:outline-none focus:border-purple-500 font-mono text-zinc-200 placeholder-zinc-500"
                />
                <button 
                    onClick={handlePush} 
                    disabled={isPushing} 
                    className="w-full bg-zinc-200 hover:bg-white text-zinc-900 py-1.5 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                    <UploadCloud size={14} /> {isPushing ? "Pushing..." : "Push via SSH"}
                </button>
            </div>
        </div>
    );
}
