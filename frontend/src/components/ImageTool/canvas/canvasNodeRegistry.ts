import type {
  CanvasDataType,
  CanvasItemKind,
  CanvasPortDefinition,
} from "../../../types";

export interface CanvasNodeDefinition {
  kind: CanvasItemKind;
  ports: CanvasPortDefinition[];
}

const definitions: Record<CanvasItemKind, CanvasNodeDefinition> = {
  requirement: {
    kind: "requirement",
    ports: [{ id: "requirement", direction: "output", dataType: "requirement" }],
  },
  asset: {
    kind: "asset",
    ports: [{ id: "image", direction: "output", dataType: "image" }],
  },
  reference: {
    kind: "reference",
    ports: [{ id: "image", direction: "output", dataType: "image" }],
  },
  reversePrompt: {
    kind: "reversePrompt",
    ports: [
      { id: "image", direction: "input", dataType: "image", multiple: true },
      { id: "prompt", direction: "output", dataType: "prompt" },
    ],
  },
  prompt: {
    kind: "prompt",
    ports: [
      { id: "requirement", direction: "input", dataType: "requirement", multiple: true },
      { id: "reference-prompt", direction: "input", dataType: "prompt", multiple: true },
      { id: "prompt", direction: "output", dataType: "prompt" },
    ],
  },
  model: {
    kind: "model",
    ports: [{ id: "config", direction: "output", dataType: "model-config" }],
  },
  generate: {
    kind: "generate",
    ports: [
      { id: "prompt", direction: "input", dataType: "prompt", required: true },
      { id: "image", direction: "input", dataType: "image", multiple: true },
      { id: "config", direction: "input", dataType: "model-config" },
      { id: "image", direction: "output", dataType: "image" },
      { id: "result", direction: "output", dataType: "result" },
    ],
  },
  result: {
    kind: "result",
    ports: [
      { id: "image", direction: "input", dataType: "image", required: true },
      { id: "image", direction: "output", dataType: "image" },
      { id: "result", direction: "output", dataType: "result" },
    ],
  },
  edit: {
    kind: "edit",
    ports: [
      { id: "image", direction: "input", dataType: "image", required: true },
      { id: "prompt", direction: "input", dataType: "prompt" },
      { id: "image", direction: "output", dataType: "image" },
    ],
  },
  upscale: {
    kind: "upscale",
    ports: [
      { id: "image", direction: "input", dataType: "image", required: true },
      { id: "image", direction: "output", dataType: "image" },
    ],
  },
  bundle: {
    kind: "bundle",
    ports: [
      { id: "image", direction: "input", dataType: "image", multiple: true },
      { id: "prompt", direction: "input", dataType: "prompt", multiple: true },
      { id: "bundle", direction: "output", dataType: "bundle" },
    ],
  },
  bundleCard: {
    kind: "bundleCard",
    ports: [
      { id: "bundle", direction: "input", dataType: "bundle" },
      { id: "image", direction: "output", dataType: "image" },
    ],
  },
  export: {
    kind: "export",
    ports: [{ id: "image", direction: "input", dataType: "image", multiple: true }],
  },
};

export function getCanvasNodeDefinition(kind: CanvasItemKind): CanvasNodeDefinition {
  return definitions[kind];
}

export function getDefaultOutputPort(kind: CanvasItemKind): CanvasPortDefinition | null {
  return definitions[kind].ports.find((port) => port.direction === "output") ?? null;
}

export function getDefaultInputPort(kind: CanvasItemKind, dataType?: CanvasDataType): CanvasPortDefinition | null {
  return definitions[kind].ports.find(
    (port) => port.direction === "input" && (!dataType || port.dataType === dataType),
  ) ?? null;
}

export function getPort(kind: CanvasItemKind, id: string, direction: CanvasPortDefinition["direction"]): CanvasPortDefinition | null {
  return definitions[kind].ports.find((port) => port.id === id && port.direction === direction) ?? null;
}

export interface CanvasConnectionCandidate {
  fromPort: CanvasPortDefinition;
  toPort: CanvasPortDefinition;
}

export function validateCanvasConnection(
  fromKind: CanvasItemKind,
  toKind: CanvasItemKind,
  existingToPortConnection: boolean,
  fromPortId?: string,
  toPortId?: string,
): CanvasConnectionCandidate | { error: string } {
  const fromPort = fromPortId
    ? getPort(fromKind, fromPortId, "output")
    : getDefaultOutputPort(fromKind);
  if (!fromPort) return { error: "来源节点没有可用的输出端口" };

  const toPort = toPortId
    ? getPort(toKind, toPortId, "input")
    : getDefaultInputPort(toKind, fromPort.dataType);
  if (!toPort) return { error: "目标节点没有匹配的数据输入端口" };
  if (fromPort.dataType !== toPort.dataType) {
    return { error: `${fromPort.dataType} 数据不能连接到 ${toPort.dataType} 输入` };
  }
  if (existingToPortConnection && !toPort.multiple) {
    return { error: "这个输入端口已经有来源，请先替换或删除原连线" };
  }
  return { fromPort, toPort };
}
