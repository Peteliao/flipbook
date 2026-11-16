import { DOMParser as LinkedomDOMParser } from 'linkedom'

// Worker 环境没有原生 DOMParser/XMLSerializer，用与回归测试相同的实现补齐
const scope = globalThis as unknown as Record<string, unknown>

if (typeof scope.DOMParser === 'undefined') {
  scope.DOMParser = LinkedomDOMParser
}

if (typeof scope.XMLSerializer === 'undefined') {
  scope.XMLSerializer = class {
    serializeToString(node: Node): string {
      return String(node)
    }
  }
}
