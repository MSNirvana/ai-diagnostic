import { useEffect, useState } from "react";

// react-konva 的 Image 节点需要传入 HTMLImageElement。
// 这个 hook 负责加载图片并返回节点；加载失败时返回 null，让上层渲染占位。
export function useCanvasImage(url: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  return image;
}
