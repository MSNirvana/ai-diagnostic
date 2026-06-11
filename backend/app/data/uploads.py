import io
import pandas as pd


def parse_table(filename: str, content: bytes) -> dict:
    """解析上传的 CSV/Excel，返回结构化摘要（喂给 skill 当内部数据）。"""
    name = filename.lower()
    if name.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    elif name.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        raise ValueError(f"unsupported file type: {filename}")

    numeric = df.select_dtypes("number")
    stats = {
        col: {
            "sum": float(numeric[col].sum()),
            "mean": float(numeric[col].mean()),
        }
        for col in numeric.columns
    }
    return {
        "row_count": int(len(df)),
        "columns": list(df.columns),
        "numeric_stats": stats,
    }
