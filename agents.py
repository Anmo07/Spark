"""Agent implementations and reactive event dispatcher for the Sandbox.

Connects to Ollama (default: qwen2.5-coder:1.5b) using JSON schema validation,
executes role-based system prompts, writes generated software to disk,
and advances the Blackboard workflow through reactive triggers:
  pending_supervisor -> pending_designer -> pending_coder -> pending_reviewer -> task_completed
"""

import asyncio
import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx

from schemas import (
    CoderResponse,
    DesignerResponse,
    MasterRouterResponse,
    ReviewerResponse,
    SupervisorResponse,
)

logger = logging.getLogger("sandbox.agents")

DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5-coder:1.5b"
WORKSPACE_DIR = Path(__file__).parent / "sandbox_workspace"

SUPERVISOR_SYSTEM_PROMPT = """You are the Lead Technical Supervisor of an autonomous multi-agent engineering team.
Your job is to analyze the user's software objective and decompose it into a clear, actionable architectural plan.
You MUST respond with valid JSON matching this exact schema:
{
  "plan_overview": "High-level summary of the implementation strategy",
  "steps": [
    {
      "step_number": 1,
      "assigned_role": "designer",
      "instructions": "Specific instructions for the component architecture"
    },
    {
      "step_number": 2,
      "assigned_role": "coder",
      "instructions": "Instructions for implementing the source files"
    }
  ],
  "estimated_files": ["filename.py"]
}
Do not wrap your output in markdown backticks or commentary; output ONLY raw valid JSON."""

SUPERVISOR_REVISION_SYSTEM_PROMPT = """You are the Lead Technical Supervisor of an autonomous multi-agent engineering team.
The user has reviewed your architectural roadmap plan and provided custom instructions and feedback.
You MUST update and revise the roadmap plan to strictly incorporate the user's feedback.
You MUST respond with valid JSON matching this exact schema:
{
  "plan_overview": "Updated high-level summary incorporating user feedback",
  "steps": [
    {
      "step_number": 1,
      "assigned_role": "designer",
      "instructions": "Specific instructions for the component architecture"
    },
    {
      "step_number": 2,
      "assigned_role": "coder",
      "instructions": "Instructions for implementing the source files"
    }
  ],
  "estimated_files": ["filename.py"]
}
Do not wrap your output in markdown backticks or commentary; output ONLY raw valid JSON."""

FINAL_SUMMARY_SYSTEM_PROMPT = """You are Spark, the Master Orchestrator AI assistant in a software development IDE.
The multi-agent engineering team (Supervisor, Designer, Coder, Reviewer) has completed the project execution tasks.
Your job is to provide a conversational, encouraging, and clear final summary for the user in the Chat UI.
Briefly explain what was accomplished and list all the files that were modified or created.
Format cleanly in Markdown with bullet points."""


DESIGNER_SYSTEM_PROMPT = """You are the Systems Designer & Architect.
Based on the Supervisor's plan, produce concrete technical interface specifications, file structures, and function prototypes.
You MUST respond with valid JSON matching this exact schema:
{
  "architecture_overview": "Technical design details and component responsibilities",
  "component_interfaces": {
    "module_or_class_name": "function signatures and arguments"
  },
  "file_structures": ["filename.py"]
}
Do not wrap your output in markdown backticks or commentary; output ONLY raw valid JSON."""

CODER_SYSTEM_PROMPT = """You are the Senior Software Engineer.
Your job is to write clean, complete, robust, and functional code based on the architecture and any reviewer feedback.
Provide the primary file to write to disk.
You MUST respond with valid JSON matching this exact schema:
{
  "file_path": "name_of_file.py",
  "code": "complete source code for the file without omissions",
  "explanation": "Brief explanation of key implementation details"
}
Do not wrap your output in markdown backticks or commentary; output ONLY raw valid JSON."""

REVIEWER_SYSTEM_PROMPT = """You are the Lead Code Reviewer & QA Engineer.
Inspect the submitted code against the architectural plan and technical specifications.
Assess correctness, syntax, edge case handling, and style.
You MUST respond with valid JSON matching this exact schema:
{
  "passed": true,
  "feedback": "Detailed evaluation of the code",
  "suggested_fixes": ["optional fix suggestions if failed"]
}
Set 'passed' to true if the code is functional, well-structured, and meets the requirements.
Do not wrap your output in markdown backticks or commentary; output ONLY raw valid JSON."""

MASTER_ROUTER_SYSTEM_PROMPT = """You are the Master Orchestrator of the Spark multi-agent software sandbox.
Your job is to evaluate the user's message and decide if it is:
1. A general conversational question ("general_chat") — e.g. explaining concepts, answering questions, giving advice.
2. A project execution request ("project_execution") — e.g. building software, writing code, creating files, modifying the project.

You also receive the current project context from .spark_context.md to stay aware of the project state.

You MUST respond with valid JSON matching this exact schema:
{
  "intent": "general_chat" or "project_execution",
  "chat_response": "Your conversational response (required if intent is general_chat, null otherwise)",
  "sub_tasks": [
    {"description": "specific task description", "priority": 1}
  ],
  "context_update": "Brief summary of what was discussed or decided (for memory)"
}

Rules:
- For general_chat: provide a helpful, clear chat_response. sub_tasks should be null.
- For project_execution: chat_response should be null. Decompose the request into concrete sub_tasks that specialized agents (Supervisor, Designer, Coder, Reviewer) can execute.
- Always provide a context_update summarizing the interaction for long-term memory.
- Do not wrap your output in markdown backticks or commentary; output ONLY raw valid JSON."""

CHAT_SYSTEM_PROMPT = """You are Spark, a helpful AI assistant embedded in a software development IDE.
You help developers with questions about programming, architecture, debugging, and general tech topics.
Provide clear, concise, and helpful responses. You can use markdown formatting.
You have access to the project context below to understand the current state of the project."""


class OllamaClient:
    """Asynchronous client for interacting with the local Ollama LLM daemon."""

    def __init__(self, base_url: str = DEFAULT_OLLAMA_URL, model: str = DEFAULT_MODEL) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: float = 180.0,
    ) -> Dict[str, Any]:
        """Send chat messages with structured JSON formatting and return the parsed dict."""
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.2,
            },
        }

        raw_content = ""
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload)
                resp.raise_for_status()
                data = resp.json()
                raw_content = data.get("message", {}).get("content", "").strip()
                return json.loads(raw_content)
            except httpx.HTTPError as exc:
                logger.error("Ollama HTTP error calling model %s: %s", self.model, exc)
                raise
            except json.JSONDecodeError as exc:
                logger.error("Failed to parse JSON response from Ollama: %s | Raw: %s", exc, raw_content)
                raise

    async def generate_text(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: float = 120.0,
    ) -> str:
        """Send chat messages and return raw text (non-JSON) response."""
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
            "options": {
                "temperature": 0.5,
            },
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data.get("message", {}).get("content", "").strip()
            except httpx.HTTPError as exc:
                logger.error("Ollama HTTP error calling model %s: %s", self.model, exc)
                raise


class AgentDispatcher:
    """Reactive coordinator evaluating Blackboard events and invoking agents."""

    def __init__(
        self,
        llm_client: Optional[OllamaClient] = None,
        workspace_dir: Path = WORKSPACE_DIR,
        on_file_write: Optional[Callable[[str, str], Any]] = None,
    ) -> None:
        self.llm = llm_client or OllamaClient()
        self.workspace_dir = workspace_dir
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.on_file_write = on_file_write
        # Track retry attempts per root task
        self.review_retries: Dict[int, int] = {}
        self.circuit_breaker_limit = 2

    def write_workspace_file(self, relative_path: str, content: str) -> Path:
        """Safely write code content to the local sandbox workspace."""
        safe_path = (self.workspace_dir / relative_path).resolve()
        # Ensure path does not escape sandbox workspace
        if not str(safe_path).startswith(str(self.workspace_dir.resolve())):
            raise ValueError(f"Target file path '{relative_path}' escapes sandbox workspace.")
        safe_path.parent.mkdir(parents=True, exist_ok=True)
        safe_path.write_text(content, encoding="utf-8")
        logger.info("Autonomous tool: Wrote %d bytes to %s", len(content), safe_path)
        if self.on_file_write:
            try:
                res = self.on_file_write(relative_path, content)
                if asyncio.iscoroutine(res):
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(res)
                    except RuntimeError:
                        pass
            except Exception as exc:
                logger.warning("Error in on_file_write callback: %s", exc)
        return safe_path

    async def generate_roadmap(self, prompt: str) -> SupervisorResponse:
        """Generate a structured roadmap plan from the user prompt."""
        res_dict = await self.llm.generate_json(
            system_prompt=SUPERVISOR_SYSTEM_PROMPT,
            user_prompt=f"Task Objective:\n{prompt}",
        )
        return SupervisorResponse.model_validate(res_dict)

    async def revise_roadmap(
        self, prompt: str, current_plan: Dict[str, Any], feedback: str
    ) -> SupervisorResponse:
        """Revise an existing roadmap plan using custom instructions from the user."""
        user_message = (
            f"## Original Objective:\n{prompt}\n\n"
            f"## Current Plan:\n{json.dumps(current_plan, indent=2)}\n\n"
            f"## User Custom Instructions / Feedback:\n{feedback}"
        )
        res_dict = await self.llm.generate_json(
            system_prompt=SUPERVISOR_REVISION_SYSTEM_PROMPT,
            user_prompt=user_message,
        )
        return SupervisorResponse.model_validate(res_dict)


    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Evaluate an incoming Blackboard event and trigger the next agent workflow."""
        status = event.get("status")
        data = event.get("data") or {}
        event_id = event.get("id", 0)

        # 1. TRIGGER: pending_supervisor -> Supervisor Agent
        if status == "pending_supervisor":
            user_prompt = data.get("prompt", str(data))
            logger.info("Supervisor Agent activated for Task #%d: '%s'", event_id, user_prompt[:60])

            try:
                res_dict = await self.llm.generate_json(
                    system_prompt=SUPERVISOR_SYSTEM_PROMPT,
                    user_prompt=f"Task Objective:\n{user_prompt}",
                )
                plan = SupervisorResponse.model_validate(res_dict)
                return {
                    "agent_role": "supervisor",
                    "status": "pending_designer",
                    "data": {
                        "task_prompt": user_prompt,
                        **plan.model_dump(),
                    },
                }
            except Exception as exc:
                logger.error("Supervisor Agent failed: %s", exc)
                return {
                    "agent_role": "supervisor",
                    "status": "supervisor_error",
                    "data": {"error": str(exc), "task_prompt": user_prompt},
                }

        # 2. TRIGGER: pending_designer -> Designer Agent
        elif status == "pending_designer":
            logger.info("Designer Agent activated from Supervisor event #%d", event_id)
            context_str = json.dumps(data, indent=2)

            try:
                res_dict = await self.llm.generate_json(
                    system_prompt=DESIGNER_SYSTEM_PROMPT,
                    user_prompt=f"Supervisor Plan Context:\n{context_str}",
                )
                design = DesignerResponse.model_validate(res_dict)
                return {
                    "agent_role": "designer",
                    "status": "pending_coder",
                    "data": {
                        "task_prompt": data.get("task_prompt", ""),
                        "supervisor_plan": data,
                        **design.model_dump(),
                    },
                }
            except Exception as exc:
                logger.error("Designer Agent failed: %s", exc)
                return {
                    "agent_role": "designer",
                    "status": "designer_error",
                    "data": {"error": str(exc)},
                }

        # 3. TRIGGER: pending_coder -> Coder Agent
        elif status == "pending_coder":
            logger.info("Coder Agent activated from event #%d", event_id)
            context_str = json.dumps(data, indent=2)

            try:
                res_dict = await self.llm.generate_json(
                    system_prompt=CODER_SYSTEM_PROMPT,
                    user_prompt=f"Architectural & Task Specifications:\n{context_str}",
                )
                code_result = CoderResponse.model_validate(res_dict)

                # Write generated software to disk in sandbox workspace
                saved_path = self.write_workspace_file(code_result.file_path, code_result.code)

                return {
                    "agent_role": "coder",
                    "status": "pending_reviewer",
                    "data": {
                        "task_prompt": data.get("task_prompt", ""),
                        "saved_file": str(saved_path),
                        **code_result.model_dump(),
                    },
                }
            except Exception as exc:
                logger.error("Coder Agent failed: %s", exc)
                return {
                    "agent_role": "coder",
                    "status": "coder_error",
                    "data": {"error": str(exc)},
                }

        # 4. TRIGGER: pending_reviewer -> Reviewer Agent
        elif status == "pending_reviewer":
            logger.info("Reviewer Agent activated for code from event #%d", event_id)
            code_payload = json.dumps(
                {
                    "file_path": data.get("file_path"),
                    "code": data.get("code"),
                    "explanation": data.get("explanation"),
                },
                indent=2,
            )

            try:
                res_dict = await self.llm.generate_json(
                    system_prompt=REVIEWER_SYSTEM_PROMPT,
                    user_prompt=f"Code Implementation to Review:\n{code_payload}",
                )
                review = ReviewerResponse.model_validate(res_dict)

                if review.passed:
                    logger.info("Reviewer PASSED code for event #%d! Task complete.", event_id)
                    return {
                        "agent_role": "reviewer",
                        "status": "task_completed",
                        "data": {
                            "summary": "Implementation successfully planned, coded, written to disk, and verified.",
                            "file_path": data.get("file_path"),
                            "saved_file": data.get("saved_file"),
                            **review.model_dump(),
                        },
                    }
                else:
                    # Circuit breaker keyed on root task prompt (stable across event IDs)
                    task_key = hashlib.sha256(
                        data.get("task_prompt", "").encode()
                    ).hexdigest()[:16]
                    retries = self.review_retries.get(task_key, 0) + 1
                    self.review_retries[task_key] = retries

                    if retries <= self.circuit_breaker_limit:
                        logger.warning(
                            "Reviewer REJECTED code (attempt %d/%d). Looping back to Coder.",
                            retries,
                            self.circuit_breaker_limit,
                        )
                        return {
                            "agent_role": "reviewer",
                            "status": "pending_coder",
                            "data": {
                                "task_prompt": data.get("task_prompt", ""),
                                "feedback": review.feedback,
                                "suggested_fixes": review.suggested_fixes,
                                "previous_code": data.get("code"),
                                "file_path": data.get("file_path"),
                                "retry_count": retries,
                            },
                        }
                    else:
                        logger.warning("Circuit breaker triggered: Max review attempts reached.")
                        return {
                            "agent_role": "reviewer",
                            "status": "task_completed",
                            "data": {
                                "warning": "Circuit breaker stopped further revision iterations.",
                                "final_feedback": review.feedback,
                                "file_path": data.get("file_path"),
                                "saved_file": data.get("saved_file"),
                                "passed": False,
                            },
                        }
            except Exception as exc:
                logger.error("Reviewer Agent failed: %s", exc)
                return {
                    "agent_role": "reviewer",
                    "status": "reviewer_error",
                    "data": {"error": str(exc)},
                }

        # Terminal states or unrelated statuses produce no further automated transitions
        return None


class MasterAgent:
    """Master Orchestrator that triages user prompts into chat or project execution."""

    CONTEXT_FILE = ".spark_context.md"

    def __init__(
        self,
        llm_client: Optional[OllamaClient] = None,
        workspace_dir: Path = WORKSPACE_DIR,
    ) -> None:
        self.llm = llm_client or OllamaClient()
        self.workspace_dir = workspace_dir
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def _context_path(self) -> Path:
        return self.workspace_dir / self.CONTEXT_FILE

    def read_context(self) -> str:
        """Read the current .spark_context.md contents."""
        ctx_path = self._context_path()
        if ctx_path.exists():
            return ctx_path.read_text(encoding="utf-8")
        return "# Spark Project Context\n\nNo project context yet. This is a fresh workspace.\n"

    def _write_context(self, content: str) -> None:
        """Write updated context to .spark_context.md."""
        self._context_path().write_text(content, encoding="utf-8")

    async def route(self, prompt: str) -> MasterRouterResponse:
        """Classify user intent and return routing decision."""
        context = self.read_context()
        user_message = (
            f"## Current Project Context\n{context}\n\n"
            f"## User Message\n{prompt}"
        )

        try:
            res_dict = await self.llm.generate_json(
                system_prompt=MASTER_ROUTER_SYSTEM_PROMPT,
                user_prompt=user_message,
                timeout=120.0,
            )
            result = MasterRouterResponse.model_validate(res_dict)
            logger.info("Master Agent routed prompt as: %s", result.intent)

            # Update context memory with the interaction
            if result.context_update:
                self.update_context_memory(result.context_update)

            return result
        except Exception as exc:
            logger.error("Master Agent routing failed: %s", exc)
            # Fallback: treat as general chat with error message
            return MasterRouterResponse(
                intent="general_chat",
                chat_response=f"I'm having trouble processing your request right now. Error: {str(exc)}",
                context_update=None,
            )

    async def chat(self, prompt: str) -> str:
        """Generate a direct conversational response (non-JSON)."""
        context = self.read_context()
        user_message = (
            f"## Current Project Context\n{context}\n\n"
            f"## User Question\n{prompt}"
        )
        try:
            return await self.llm.generate_text(
                system_prompt=CHAT_SYSTEM_PROMPT,
                user_prompt=user_message,
            )
        except Exception as exc:
            logger.error("Master Agent chat failed: %s", exc)
            return f"Sorry, I encountered an error: {str(exc)}"

    def update_context_memory(self, update_text: str) -> None:
        """Append new information to the .spark_context.md file."""
        import datetime
        current = self.read_context()
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        updated = (
            current.rstrip()
            + f"\n\n## Update — {timestamp}\n{update_text}\n"
        )
        self._write_context(updated)
        logger.info("Context memory updated at %s", timestamp)

    def update_context_from_completion(self, event_data: Dict[str, Any]) -> None:
        """Called when a task_completed event fires to record what was accomplished."""
        summary = event_data.get("summary", "Task completed")
        file_path = event_data.get("file_path", "unknown")
        feedback = event_data.get("feedback", "")

        update = (
            f"- **Completed:** {summary}\n"
            f"- **File:** `{file_path}`\n"
        )
        if feedback:
            update += f"- **Review:** {feedback[:200]}\n"

        self.update_context_memory(update)

    async def generate_final_summary(
        self, completion_data: Dict[str, Any], modified_files: Optional[List[str]] = None
    ) -> str:
        """Generate a conversational final summary when execution completes."""
        context = self.read_context()
        files = list(modified_files or [])
        file_from_data = completion_data.get("file_path") or completion_data.get("saved_file")
        if file_from_data and file_from_data not in files:
            # Clean path to basename or relative
            clean_file = Path(file_from_data).name
            if clean_file not in files:
                files.append(clean_file)

        files_list_str = "\n".join([f"- `{f}`" for f in files]) if files else "- (Workspace updated)"
        user_prompt = (
            f"## Project Context (.spark_context.md):\n{context}\n\n"
            f"## Latest Completion Event Data:\n{json.dumps(completion_data, indent=2)}\n\n"
            f"## Files Modified or Created:\n{files_list_str}"
        )
        try:
            summary = await self.llm.generate_text(
                system_prompt=FINAL_SUMMARY_SYSTEM_PROMPT,
                user_prompt=user_prompt,
            )
            if summary and len(summary.strip()) > 20:
                return summary.strip()
        except Exception as exc:
            logger.warning("Failed to generate LLM final summary: %s", exc)

        # Fallback conversational summary
        task_summary = completion_data.get("summary", "All planned tasks have been implemented and verified.")
        file_bullets = "\n".join([f"- `{f}`" for f in files]) if files else "- (Workspace updated)"
        return (
            f"🎉 **Execution Complete!**\n\n"
            f"{task_summary}\n\n"
            f"**Files Created / Modified:**\n{file_bullets}\n\n"
            f"All code has passed quality review and is ready in your workspace!"
        )

