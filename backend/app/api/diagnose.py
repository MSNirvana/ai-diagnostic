from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.orchestrator.dispatcher import diagnose_all

router = APIRouter()


class DiagnoseResponse(BaseModel):
    results: list[ModuleResult]


@router.post("/diagnose", response_model=DiagnoseResponse)
async def diagnose(
    questionnaire: Questionnaire,
    llm: LLMClient = Depends(get_llm_client),
) -> DiagnoseResponse:
    results = await diagnose_all(questionnaire, llm)
    return DiagnoseResponse(results=results)
