import { useEffect, useMemo, useState } from "react";
import { listImageTasks } from "../../api/client";
import type { ImageTaskStatus } from "../../types";
import "./ImageHistoryList.css";

const STATUS_LABELS: Record<string, string> = {
  quoted: "处理中",
  reserved: "处理中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  refunded: "已退款",
};

type ResultFilter = "all" | "succeeded" | "processing" | "failed";

const FILTERS: Array<{ id: ResultFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "succeeded", label: "已完成" },
  { id: "processing", label: "处理中" },
  { id: "failed", label: "失败" },
];

function matchesFilter(task: ImageTaskStatus, filter: ResultFilter): boolean {
  if (filter === "all") return true;
  if (filter === "succeeded") return task.status === "succeeded";
  if (filter === "failed") return task.status === "failed";
  return task.status === "quoted" || task.status === "reserved" || task.status === "running";
}

function downloadUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadMaterialPack(tasks: ImageTaskStatus[]) {
  const manifest = {
    exported_at: new Date().toISOString(),
    items: tasks.map((task) => ({
      task_id: task.id,
      status: task.status,
      result_image_url: task.result_image_url,
      created_at: task.created_at,
    })),
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, "aibuild-material-pack.json");
  URL.revokeObjectURL(url);
}

export function ImageHistoryList() {
  const [tasks, setTasks] = useState<ImageTaskStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    listImageTasks()
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => matchesFilter(task, filter)),
    [filter, tasks]
  );
  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedIds.has(task.id) && task.result_image_url),
    [selectedIds, tasks]
  );

  const toggleSelected = (taskId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  if (loading) return null;
  if (tasks.length === 0) return null;

  return (
    <section className="image-history">
      <div className="image-history__header">
        <div>
          <h3>生成历史</h3>
          <p>筛选结果，选择图片后导出素材包。</p>
        </div>
        <button
          type="button"
          className="image-history-export"
          disabled={selectedTasks.length === 0}
          onClick={() => downloadMaterialPack(selectedTasks)}
        >
          {"导出素材包" + (selectedTasks.length > 0 ? "（" + selectedTasks.length + "）" : "")}
        </button>
      </div>

      <div className="image-history-filters" role="toolbar" aria-label="结果筛选">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "active" : ""}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visibleTasks.length === 0 ? (
        <p className="image-history-empty">当前筛选没有任务。</p>
      ) : (
        <div className="image-history-list">
          {visibleTasks.map((task) => {
            const selected = selectedIds.has(task.id);
            return (
              <div
                key={task.id}
                className={"image-history-item" + (selected ? " selected" : "")}
              >
                <div className="image-history-item__info">
                  <span
                    className={"image-history-status image-history-status--" + task.status}
                  >
                    {STATUS_LABELS[task.status] || task.status}
                  </span>
                  <span className="image-history-time">
                    {new Date(task.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                {task.result_image_url && (
                  <div className="image-history-item__delivery">
                    <img
                      src={task.result_image_url}
                      alt="生成结果"
                      className="image-history-thumb"
                    />
                    <div className="image-history-item__actions">
                      <button type="button" onClick={() => toggleSelected(task.id)}>
                        {selected ? "取消选择" : "选择素材"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadUrl(task.result_image_url!, "aibuild-" + task.id + ".png")
                        }
                      >
                        下载
                      </button>
                    </div>
                  </div>
                )}
                {task.error && <p className="image-history-error">{task.error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
