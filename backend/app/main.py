from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.diagnose import router as diagnose_router
from app.api.diagnosis_jobs import router as diagnosis_jobs_router
from app.api.auth import router as auth_router
from app.api.history import router as history_router
from app.api.questionnaire import router as questionnaire_router
from app.api.admin import router as admin_router
from app.api.admin_llm import router as admin_llm_router
from app.api.admin_loops import router as admin_loops_router
from app.api.admin_cases import router as admin_cases_router
from app.api.review import router as review_router
from app.api.conversation import router as conversation_router
from app.api.session import router as session_router
from app.api.project import router as project_router
from app.api.files import router as files_router
from app.api.data_supplement import router as data_supplement_router
from app.db.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="AI Diagnostic", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(diagnose_router)
app.include_router(diagnosis_jobs_router)
app.include_router(auth_router)
app.include_router(history_router)
app.include_router(questionnaire_router)
app.include_router(admin_router)
app.include_router(admin_llm_router)
app.include_router(admin_loops_router)
app.include_router(admin_cases_router)
app.include_router(review_router)
app.include_router(conversation_router)
app.include_router(session_router)
app.include_router(project_router)
app.include_router(files_router)
app.include_router(data_supplement_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
