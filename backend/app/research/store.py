import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ResearchEvidence

from .models import ResearchEvidenceItem


async def save_research_evidence(
    session: AsyncSession,
    *,
    job_id: str,
    project_id: str | None,
    items: list[ResearchEvidenceItem],
    source_stage: str = "system_pre_research",
) -> list[ResearchEvidence]:
    rows: list[ResearchEvidence] = []
    for item in items:
        row = ResearchEvidence(
            job_id=job_id,
            project_id=project_id,
            module=item.module,
            source_stage=source_stage,
            provider=item.provider,
            query=item.query,
            title=item.title,
            url=item.url,
            snippet=item.snippet,
            source_type=item.source_type,
            credibility=item.credibility,
            raw_json=json.dumps(item.raw, ensure_ascii=False),
        )
        session.add(row)
        rows.append(row)
    await session.commit()
    return rows


async def list_job_evidence(
    session: AsyncSession,
    job_id: str,
    *,
    module: str | None = None,
    limit: int = 80,
) -> list[ResearchEvidence]:
    stmt = select(ResearchEvidence).where(ResearchEvidence.job_id == job_id)
    if module:
        stmt = stmt.where(ResearchEvidence.module == module)
    stmt = stmt.order_by(ResearchEvidence.credibility.desc(), ResearchEvidence.retrieved_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())


async def list_record_evidence(
    session: AsyncSession,
    record_id: str,
    *,
    module: str | None = None,
    limit: int = 200,
) -> list[ResearchEvidence]:
    stmt = select(ResearchEvidence).where(ResearchEvidence.record_id == record_id)
    if module:
        stmt = stmt.where(ResearchEvidence.module == module)
    stmt = stmt.order_by(ResearchEvidence.credibility.desc(), ResearchEvidence.retrieved_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())


async def list_project_evidence(
    session: AsyncSession,
    project_id: str,
    *,
    module: str | None = None,
    limit: int = 200,
) -> list[ResearchEvidence]:
    stmt = select(ResearchEvidence).where(ResearchEvidence.project_id == project_id)
    if module:
        stmt = stmt.where(ResearchEvidence.module == module)
    stmt = stmt.order_by(ResearchEvidence.retrieved_at.desc(), ResearchEvidence.credibility.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())


async def attach_evidence_to_record(
    session: AsyncSession,
    *,
    job_id: str,
    record_id: str,
) -> None:
    rows = await list_job_evidence(session, job_id, limit=500)
    for row in rows:
        row.record_id = record_id
        session.add(row)
    await session.commit()


def render_evidence_for_prompt(rows: list[ResearchEvidence], *, module: str = "") -> list[dict[str, object]]:
    relevant = [
        row for row in rows
        if not module or row.module in ("", module)
    ]
    return [
        {
            "module": row.module,
            "title": row.title,
            "url": row.url,
            "snippet": row.snippet[:900],
            "source_type": row.source_type,
            "credibility": row.credibility,
            "query": row.query,
            "retrieved_at": row.retrieved_at.isoformat(),
        }
        for row in relevant[:30]
    ]
