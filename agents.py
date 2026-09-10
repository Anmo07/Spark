"""Agent implementations and reactive event dispatcher for the Sandbox.

Connects to Ollama (default: qwen2.5-coder:1.5b) using JSON schema validation,
executes role-based system prompts, writes generated software to disk,
and advances the Blackboard workflow through reactive triggers:
  pending_supervisor -> pending_designer -> pending_coder -> pending_reviewer -> task_completed
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from schemas import (
    CoderResponse,
    DesignerResponse,
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


class OllamaClient:
    """Asynchronous client for interacting with the local Ollama LLM daemon."""

    def __init__(self, base_url: str = DEFAULT_OLLAMA_URL, model: str = DEFAULT_MODEL) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        timeout: float = 60.0,
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


class AgentDispatcher:
    """Reactive coordinator evaluating Blackboard events and invoking agents."""

    def __init__(
        self,
        llm_client: Optional[OllamaClient] = None,
        workspace_dir: Path = WORKSPACE_DIR,
    ) -> None:
        self.llm = llm_client or OllamaClient()
        self.workspace_dir = workspace_dir
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
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
        return safe_path

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
                    # Circuit breaker check
                    retries = self.review_retries.get(event_id, 0) + 1
                    self.review_retries[event_id] = retries

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
