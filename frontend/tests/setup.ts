import { vi } from "vitest";

// jsdom 不支持 Canvas 2D Context，react-konva 在测试环境下会报错。
// 这里把 react-konva 和 konva 替换为空 stub，仅用于 vitest。
// 测试用例不应触达 Konva 画布的具体渲染逻辑（那是浏览器端验证的范畴）。

vi.mock("react-konva", () => ({
  Stage: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Layer: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Group: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Rect: () => null,
  Text: () => null,
  Image: () => null,
  Transformer: () => null,
  Line: () => null,
  Circle: () => null,
  Label: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Tag: () => null,
}));

vi.mock("konva", () => ({
  default: {},
  Util: { getRandomColor: () => "#000000" },
}));
