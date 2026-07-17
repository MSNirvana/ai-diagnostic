import { useEffect, useState } from "react";
import { listImageTasks } from "../../api/client";
import type { ImageTaskStatus } from "../../types";
import "./ImageHistoryList.css";

const STATUS_LABELS: Record<string, string> = {
  quoted: "待确认",
  reserved: "已确认",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  refunded: "已退款",
};

export function ImageHistoryList() {
  const [tasks, setTasks] = useState<ImageTaskStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listImageTasks()
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (tasks.length === 0) return null;

  return (
    <section className="image-history">
      <h3>生成历史</h3>
      <div className="image-history-list">
        {tasks.map((task) => (
          <div key={task.id} className="image-history-item">
            <div className="image-history-item__info">
              <span className={`image-history-status image-history-status--${task.status}`}>
                {STATUS_LABELS[task.status] || task.status}
              </span>
              <span className="image-history-time">
                {new Date(task.created_at).toLocaleString("zh-CN")}
              </span>
            </div>
            {task.result_image_url && (
              <img
                src={task.result_image_url}
                alt="生成结果"
                className="image-history-thumb"
              />
            )}
            {task.error && <p className="image-history-error">{task.error}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
