"""Data contracts and Pydantic validation schemas for the Multi-Agent Sandbox."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, model_validator


class TaskCreate(BaseModel):
    """User task ingestion payload for POST /task."""
    prompt: str = Field(description="The objective or request submitted by the user")


class EventCreate(BaseModel):
    """Event creation contract (role, status, data)."""
    role: str = Field(description="Agent role or emitter (e.g., user, supervisor, coder)")
    status: str = Field(description="Status trigger or stage (e.g., pending_supervisor, in_progress, completed)")
    data: Union[Dict[str, Any], List[Any], str] = Field(description="Action payload or structured data")

    @model_validator(mode="before")
    @classmethod
    def populate_role_alias(cls, values: Any) -> Any:
        if isinstance(values, dict):
            if "role" not in values and "agent_role" in values:
                values["role"] = values["agent_role"]
        return values


class EventResponse(BaseModel):
    """Event response contract for API and WebSocket streaming (id, timestamp, role, status, data)."""
    id: int
    timestamp: Union[datetime, str]
    role: str = Field(description="Agent role or emitter")
    status: str
    data: Union[Dict[str, Any], List[Any], str]

    @property
    def agent_role(self) -> str:
        """Alias property for compatibility with agent_role field access."""
        return self.role

    @model_validator(mode="before")
    @classmethod
    def populate_role_alias(cls, values: Any) -> Any:
        if isinstance(values, dict):
            if "role" not in values and "agent_role" in values:
                values["role"] = values["agent_role"]
        return values


class SearchResponse(BaseModel):
    """Search response contract for GET /search."""
    query: str
    count: int
    results: List[EventResponse]


# --- Agent Contracts (TRD Section 3) ---

class SupervisorPlanStep(BaseModel):
    step_number: int
    assigned_role: str
    instructions: str


class SupervisorResponse(BaseModel):
    """Supervisor plan decomposition schema."""
    plan_overview: str
    steps: List[SupervisorPlanStep]
    estimated_files: List[str]


class DesignerResponse(BaseModel):
    """Designer architecture & technical blueprint schema."""
    architecture_overview: str
    component_interfaces: Dict[str, str]
    file_structures: List[str]


class CoderResponse(BaseModel):
    """Coder implementation output schema."""
    file_path: str
    code: str
    explanation: Optional[str] = None


class ReviewerResponse(BaseModel):
    """Reviewer evaluation output schema."""
    passed: bool
    feedback: str
    suggested_fixes: Optional[List[str]] = None


# --- Master Agent Contracts (Phase 3) ---

class MasterSubTask(BaseModel):
    """A single sub-task decomposed by the Master Agent."""
    description: str
    priority: int = 1


class MasterRouterResponse(BaseModel):
    """Master Agent intent classification and routing output."""
    intent: str = Field(description="Either 'general_chat' or 'project_execution'")
    chat_response: Optional[str] = Field(default=None, description="Direct chat reply when intent is general_chat")
    sub_tasks: Optional[List[MasterSubTask]] = Field(default=None, description="Decomposed sub-tasks when intent is project_execution")
    context_update: Optional[str] = Field(default=None, description="Summary to append to .spark_context.md")


class ChatRequest(BaseModel):
    """User chat message payload for POST /chat."""
    prompt: str = Field(description="The user's message to the Master Agent")


class ChatResponse(BaseModel):
    """Response from the Master Agent to the frontend."""
    type: str = Field(description="'chat' for conversational, 'system_event' for pipeline dispatch")
    content: str = Field(description="The message content to display")
    sub_tasks: Optional[List[str]] = Field(default=None, description="List of dispatched sub-task descriptions")

