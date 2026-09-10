"""Git Version Control & Remote Sync Service for Spark Sandbox Workspace.

Executes asynchronous Git subprocess commands inside sandbox_workspace/ using
the host machine's user environment to inherit native macOS SSH keys without
requiring Personal Access Tokens (PATs).
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("sandbox.git")

DEFAULT_WORKSPACE_DIR = Path(__file__).parent / "sandbox_workspace"


class GitService:
    """Manages Git version control operations within the sandbox workspace."""

    def __init__(self, workspace_dir: Optional[Path] = None) -> None:
        self.workspace_dir = (workspace_dir or DEFAULT_WORKSPACE_DIR).resolve()

    async def _run_git(self, *args: str) -> Tuple[int, str, str]:
        """Execute a git command asynchronously in the workspace directory."""
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        env = {
            **os.environ,
            "GIT_TERMINAL_PROMPT": "0",  # Prevent hanging on interactive credential prompts
        }
        try:
            proc = await asyncio.create_subprocess_exec(
                "git",
                *args,
                cwd=str(self.workspace_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout_bytes, stderr_bytes = await proc.communicate()
            stdout = stdout_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
            stderr = stderr_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
            return proc.returncode if proc.returncode is not None else -1, stdout, stderr
        except Exception as exc:
            logger.error("Failed to run git %s: %s", " ".join(args), exc)
            return -1, "", str(exc)

    async def ensure_repo(self) -> Dict[str, Any]:
        """Ensure git repository exists in workspace_dir. Initializes and creates initial commit if missing."""
        git_dir = self.workspace_dir / ".git"
        if git_dir.is_dir():
            return {"status": "exists"}

        logger.info("Initializing Git repository in %s", self.workspace_dir)
        rc, _, err = await self._run_git("init", "-b", "main")
        if rc != 0:
            # Fallback for older git versions without -b flag
            await self._run_git("init")
            await self._run_git("branch", "-M", "main")

        # Set repository-local fallback user credentials if not set globally
        rc_name, name_out, _ = await self._run_git("config", "user.name")
        if rc_name != 0 or not name_out:
            await self._run_git("config", "user.name", "Spark Agent")
        rc_email, email_out, _ = await self._run_git("config", "user.email")
        if rc_email != 0 or not email_out:
            await self._run_git("config", "user.email", "agent@spark.local")

        # Stage and create initial commit
        await self._run_git("add", "-A")
        await self._run_git("commit", "-m", "chore: initial repository setup", "--allow-empty")
        logger.info("Git repository initialized with initial commit.")
        return {"status": "initialized"}

    async def get_status(self) -> Dict[str, Any]:
        """Return structured JSON of uncommitted/untracked changes via git status --porcelain."""
        await self.ensure_repo()
        rc, stdout, stderr = await self._run_git("status", "--porcelain=v1", "-uall")
        if rc != 0:
            logger.warning("git status returned error: %s", stderr)
            return {"changes": []}

        changes: List[Dict[str, str]] = []
        if not stdout:
            return {"changes": changes}

        for line in stdout.splitlines():
            if not line:
                continue
            if len(line) < 3:
                continue

            # Standard git porcelain v1: 2-char status code followed by space and path
            if len(line) >= 3 and line[2] == " ":
                code = line[:2]
                raw_path = line[3:].strip()
            elif line[1] == " ":
                code = line[0]
                raw_path = line[2:].strip()
            else:
                code = line[:2]
                raw_path = line[2:].strip()

            # Handle quoted paths (e.g. spaces/special chars)
            if raw_path.startswith('"') and raw_path.endswith('"'):
                raw_path = raw_path[1:-1]
            # Handle renames "old -> new"
            if " -> " in raw_path:
                raw_path = raw_path.split(" -> ")[-1].strip().strip('"')

            status_label = code.strip() or code
            changes.append({
                "status": status_label,
                "file": raw_path,
            })

        return {"changes": changes}

    async def get_original_file(self, rel_path: str) -> Dict[str, Any]:
        """Fetch committed file content from HEAD:{rel_path} for Monaco DiffEditor."""
        await self.ensure_repo()
        clean_path = rel_path.strip().lstrip("/").replace("\\", "/")
        # Guard against path traversal
        if ".." in clean_path.split("/"):
            return {"path": clean_path, "content": ""}

        rc, stdout, stderr = await self._run_git("show", f"HEAD:{clean_path}")
        if rc != 0:
            # File is newly added, untracked, or does not exist in HEAD
            return {"path": clean_path, "content": ""}

        return {"path": clean_path, "content": stdout}

    async def commit(self, message: str) -> Dict[str, Any]:
        """Stage all changes and commit with the given message."""
        await self.ensure_repo()
        msg = message.strip() if message else "feat: update workspace"

        # Stage all changes
        await self._run_git("add", "-A")

        # Check if there are staged changes
        rc_diff, stdout_diff, _ = await self._run_git("diff", "--cached", "--quiet")
        if rc_diff == 0:
            # No changes to commit
            return {"status": "nothing_to_commit", "message": "Working tree clean; no changes to commit."}

        rc, stdout, stderr = await self._run_git("commit", "-m", msg)
        if rc != 0:
            logger.error("git commit failed: %s", stderr)
            return {"status": "error", "message": stderr or stdout}

        _, commit_hash, _ = await self._run_git("rev-parse", "--short", "HEAD")
        return {
            "status": "committed",
            "message": msg,
            "commit": commit_hash,
        }

    async def revert_last(self) -> Dict[str, Any]:
        """Undo the last agent action / commit via git reset --hard HEAD~1."""
        await self.ensure_repo()

        # Check if HEAD~1 exists
        rc_check, _, _ = await self._run_git("rev-parse", "--verify", "HEAD~1")
        if rc_check != 0:
            return {"status": "error", "message": "Cannot revert: no previous commit in history (HEAD~1 not found)."}

        rc, stdout, stderr = await self._run_git("reset", "--hard", "HEAD~1")
        if rc != 0:
            return {"status": "error", "message": stderr or stdout}

        return {"status": "reverted", "message": "Successfully reverted last commit (HEAD~1)."}

    async def push_to_remote(self, remote_url: str) -> Dict[str, Any]:
        """Push local commits to an SSH remote repository (e.g. git@github.com:user/repo.git)."""
        await self.ensure_repo()
        url = remote_url.strip()
        if not url:
            return {"status": "error", "message": "Remote URL is required."}

        # Check existing remotes
        rc_remote, remotes, _ = await self._run_git("remote")
        remote_list = [r.strip() for r in remotes.splitlines() if r.strip()]

        if "origin" in remote_list:
            rc_set, _, err_set = await self._run_git("remote", "set-url", "origin", url)
            if rc_set != 0:
                return {"status": "error", "message": f"Failed to set remote URL: {err_set}"}
        else:
            rc_add, _, err_add = await self._run_git("remote", "add", "origin", url)
            if rc_add != 0:
                return {"status": "error", "message": f"Failed to add remote: {err_add}"}

        # Ensure branch is main
        await self._run_git("branch", "-M", "main")

        # Push to remote using native SSH keys
        rc_push, stdout_push, stderr_push = await self._run_git("push", "-u", "origin", "main")
        if rc_push != 0:
            logger.warning("git push failed: %s", stderr_push)
            return {
                "status": "error",
                "message": stderr_push or stdout_push or "Push failed. Please verify your SSH keys and repo permissions.",
            }

        return {"status": "pushed", "remote_url": url, "message": "Successfully pushed to remote repository."}


# Global git service instance pointing to default workspace
git_service = GitService()
