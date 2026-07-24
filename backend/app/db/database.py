import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text
from sqlmodel import SQLModel

# 数据库文件路径可用环境变量覆盖（测试用内存库）
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "sqlite+aiosqlite:///./data/app.db"
)

async_engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)


async def init_db() -> None:
    """建表。导入 models 确保表已注册到 metadata。"""
    from app.db import models  # noqa: F401

    # 文件型 SQLite 需要确保目录存在
    if DATABASE_URL.startswith("sqlite+aiosqlite:///./"):
        os.makedirs("data", exist_ok=True)
    async with async_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        if DATABASE_URL.startswith("sqlite+aiosqlite:///"):
            await _ensure_sqlite_columns(conn)


async def _ensure_sqlite_columns(conn) -> None:
    user_result = await conn.execute(text("PRAGMA table_info(user)"))
    user_columns = {row[1] for row in user_result.fetchall()}
    if user_columns and "ggoo_user_id" not in user_columns:
        await conn.execute(text("ALTER TABLE user ADD COLUMN ggoo_user_id INTEGER"))
    if user_columns and "ggoo_uuid" not in user_columns:
        await conn.execute(text("ALTER TABLE user ADD COLUMN ggoo_uuid VARCHAR"))
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_ggoo_user_id ON user (ggoo_user_id)"))
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_user_ggoo_uuid ON user (ggoo_uuid)"))

    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS warroomfeedbackevent (
            id VARCHAR NOT NULL,
            project_id VARCHAR NOT NULL,
            user_id VARCHAR,
            created_at TIMESTAMP NOT NULL,
            war_room_plan_id VARCHAR NOT NULL,
            record_id VARCHAR,
            card_type VARCHAR NOT NULL,
            card_id VARCHAR NOT NULL,
            card_title VARCHAR NOT NULL,
            adoption_status VARCHAR NOT NULL,
            feedback_result VARCHAR NOT NULL,
            note VARCHAR NOT NULL,
            owner VARCHAR NOT NULL,
            attachments_json VARCHAR NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES project (id)
        )
    """))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_project_id ON warroomfeedbackevent (project_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_user_id ON warroomfeedbackevent (user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_war_room_plan_id ON warroomfeedbackevent (war_room_plan_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_record_id ON warroomfeedbackevent (record_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_card_type ON warroomfeedbackevent (card_type)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_card_id ON warroomfeedbackevent (card_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_adoption_status ON warroomfeedbackevent (adoption_status)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_warroomfeedbackevent_feedback_result ON warroomfeedbackevent (feedback_result)"))

    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS datasupplementrequest (
            id VARCHAR NOT NULL,
            token VARCHAR NOT NULL,
            project_id VARCHAR NOT NULL,
            user_id VARCHAR,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            war_room_plan_id VARCHAR NOT NULL,
            data_key VARCHAR NOT NULL,
            label VARCHAR NOT NULL,
            reason VARCHAR NOT NULL,
            source_hint VARCHAR NOT NULL,
            typical_owner VARCHAR NOT NULL,
            status VARCHAR NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES project (id),
            UNIQUE (token)
        )
    """))
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_datasupplementrequest_token ON datasupplementrequest (token)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasupplementrequest_project_id ON datasupplementrequest (project_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasupplementrequest_user_id ON datasupplementrequest (user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasupplementrequest_war_room_plan_id ON datasupplementrequest (war_room_plan_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasupplementrequest_data_key ON datasupplementrequest (data_key)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasupplementrequest_status ON datasupplementrequest (status)"))

    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS datasupplementsubmission (
            id VARCHAR NOT NULL,
            request_id VARCHAR NOT NULL,
            project_id VARCHAR NOT NULL,
            created_at TIMESTAMP NOT NULL,
            submitter_name VARCHAR NOT NULL,
            note VARCHAR NOT NULL,
            file_ids_json VARCHAR NOT NULL,
            deleted_file_ids_json VARCHAR NOT NULL DEFAULT '[]',
            PRIMARY KEY (id),
            FOREIGN KEY(request_id) REFERENCES datasupplementrequest (id),
            FOREIGN KEY(project_id) REFERENCES project (id)
        )
    """))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasupplementsubmission_request_id ON datasupplementsubmission (request_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_datasupplementsubmission_project_id ON datasupplementsubmission (project_id)"))
    supplement_submission_result = await conn.execute(text("PRAGMA table_info(datasupplementsubmission)"))
    supplement_submission_columns = {row[1] for row in supplement_submission_result.fetchall()}
    if supplement_submission_columns and "deleted_file_ids_json" not in supplement_submission_columns:
        await conn.execute(text("ALTER TABLE datasupplementsubmission ADD COLUMN deleted_file_ids_json TEXT DEFAULT '[]'"))

    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS systemconfig (
            key VARCHAR NOT NULL,
            value VARCHAR NOT NULL,
            is_secret BOOLEAN NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            PRIMARY KEY (key)
        )
    """))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_systemconfig_is_secret ON systemconfig (is_secret)"))

    diagnosis_result = await conn.execute(text("PRAGMA table_info(diagnosisrecord)"))
    diagnosis_columns = {row[1] for row in diagnosis_result.fetchall()}
    if "war_room_plan_json" not in diagnosis_columns:
        await conn.execute(text("ALTER TABLE diagnosisrecord ADD COLUMN war_room_plan_json TEXT"))

    # 顾问审核流新增列（诊断流水线 v2）。已有库 create_all 不会 ALTER 旧表，需手动补列。
    review_columns = {
        "review_status": "TEXT DEFAULT 'approved'",  # 旧记录视为已通过，不卡住历史
        "assigned_to": "TEXT",
        "reviewed_by": "TEXT",
        "reviewed_at": "TIMESTAMP",
        "consultant_notes_json": "TEXT",
        "primary_module": "TEXT DEFAULT ''",
    }
    for col, col_type in review_columns.items():
        if col not in diagnosis_columns:
            await conn.execute(text(f"ALTER TABLE diagnosisrecord ADD COLUMN {col} {col_type}"))

    session_result = await conn.execute(text("PRAGMA table_info(diagnosissession)"))
    session_columns = {row[1] for row in session_result.fetchall()}
    session_extra_columns = {
        "is_pinned": "BOOLEAN DEFAULT 0",
        "memory_enabled": "BOOLEAN DEFAULT 1",
        "title_is_custom": "BOOLEAN DEFAULT 0",
        "deleted_at": "TIMESTAMP",
    }
    for col, col_type in session_extra_columns.items():
        if session_columns and col not in session_columns:
            await conn.execute(text(f"ALTER TABLE diagnosissession ADD COLUMN {col} {col_type}"))

    project_result = await conn.execute(text("PRAGMA table_info(project)"))
    project_columns = {row[1] for row in project_result.fetchall()}
    if "war_room_plan_json" not in project_columns:
        await conn.execute(text("ALTER TABLE project ADD COLUMN war_room_plan_json TEXT"))
    if "transformation_plan_json" not in project_columns:
        await conn.execute(text("ALTER TABLE project ADD COLUMN transformation_plan_json TEXT"))

    job_result = await conn.execute(text("PRAGMA table_info(diagnosisjob)"))
    job_columns = {row[1] for row in job_result.fetchall()}
    job_extra_columns = {
        "result_summary_json": "TEXT",
    }
    for col, col_type in job_extra_columns.items():
        if job_columns and col not in job_columns:
            await conn.execute(text(f"ALTER TABLE diagnosisjob ADD COLUMN {col} {col_type}"))

    idea_result = await conn.execute(text("PRAGMA table_info(ideacard)"))
    idea_columns = {row[1] for row in idea_result.fetchall()}
    idea_extra_columns = {
        "project_id": "TEXT",
        "updated_at": "TIMESTAMP",
        "source_context": "TEXT DEFAULT ''",
        "confidence": "TEXT DEFAULT '待验证'",
        "raw_card_json": "TEXT DEFAULT '{}'",
        "messages_json": "TEXT DEFAULT '[]'",
        "status": "TEXT DEFAULT 'saved'",
    }
    for col, col_type in idea_extra_columns.items():
        if idea_columns and col not in idea_columns:
            await conn.execute(text(f"ALTER TABLE ideacard ADD COLUMN {col} {col_type}"))

    brainstorm_result = await conn.execute(text("PRAGMA table_info(brainstormsession)"))
    brainstorm_columns = {row[1] for row in brainstorm_result.fetchall()}
    brainstorm_extra_columns = {
        "title_is_custom": "BOOLEAN DEFAULT 0",
        "use_project_context": "BOOLEAN DEFAULT 1",
        "is_pinned": "BOOLEAN DEFAULT 0",
        "deleted_at": "TIMESTAMP",
    }
    for col, col_type in brainstorm_extra_columns.items():
        if brainstorm_columns and col not in brainstorm_columns:
            await conn.execute(text(f"ALTER TABLE brainstormsession ADD COLUMN {col} {col_type}"))

    upload_result = await conn.execute(text("PRAGMA table_info(uploadedfile)"))
    upload_columns = {row[1] for row in upload_result.fetchall()}
    upload_extra_columns = {
        "archive_extraction_json": "TEXT DEFAULT '{}'",
        "archive_extraction_status": "TEXT DEFAULT 'none'",
        "archive_extracted_at": "TIMESTAMP",
    }
    for col, col_type in upload_extra_columns.items():
        if upload_columns and col not in upload_columns:
            await conn.execute(text(f"ALTER TABLE uploadedfile ADD COLUMN {col} {col_type}"))

    image_asset_result = await conn.execute(text("PRAGMA table_info(imageasset)"))
    image_asset_columns = {row[1] for row in image_asset_result.fetchall()}
    image_asset_extra_columns = {
        "asset_kind": "TEXT DEFAULT 'reference'",
        "last_used_at": "TIMESTAMP",
        "deleted_at": "TIMESTAMP",
    }
    for col, col_type in image_asset_extra_columns.items():
        if image_asset_columns and col not in image_asset_columns:
            await conn.execute(text(f"ALTER TABLE imageasset ADD COLUMN {col} {col_type}"))

    # 运营后台权限位。"user" 是 SQLite 保留字，必须加引号。
    user_result = await conn.execute(text('PRAGMA table_info("user")'))
    user_columns = {row[1] for row in user_result.fetchall()}
    if user_columns and "is_admin" not in user_columns:
        await conn.execute(text('ALTER TABLE "user" ADD COLUMN is_admin BOOLEAN DEFAULT 0'))
    # 存量用户里命中 ADMIN_EMAILS 的，登录前就提权（解决"无 UI 设标志"的鸡生蛋）。
    await _sync_admin_emails(conn)


def _admin_email_set() -> set[str]:
    """解析 ADMIN_EMAILS 环境变量（逗号分隔，小写）。'*' 表示所有人都是管理员。"""
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


async def _sync_admin_emails(conn) -> None:
    emails = _admin_email_set()
    if not emails:
        return
    if "*" in emails:
        await conn.execute(text('UPDATE "user" SET is_admin = 1'))
        return
    # 参数化逐个置位，避免 IN 子句的方言差异
    for email in emails:
        await conn.execute(
            text('UPDATE "user" SET is_admin = 1 WHERE lower(email) = :email'),
            {"email": email},
        )


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
