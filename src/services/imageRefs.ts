import { create } from 'zustand'
import { createId } from '../utils/id.js'

/**
 * 参考图：按会话保存（新会话用 'new' 作为键），顺序决定编号 P1、P2……
 * 只在内存里保存（含 data URL），刷新后清空；需要长期保留的走产物库。
 */

export type RefImage = {
  id: string
  name: string
  /** data URL */
  src: string
  /** 单张权重，0.2-1，发送时取平均值作为 image_weight */
  weight: number
}

/** 每次最多 6 张，太多会让模型抓不住重点 */
export const MAX_REFS = 6

type RefsState = { bySession: Record<string, RefImage[]> }

export const useImageRefs = create<RefsState>(() => ({ bySession: {} }))

const keyOf = (sessionId: string | null) => sessionId ?? 'new'

/** 编号：按当前顺序生成 P1..Pn */
export const refLabel = (index: number) => `P${index + 1}`

export const addRefs = (sessionId: string | null, items: { name: string; src: string }[]) => {
  const key = keyOf(sessionId)
  useImageRefs.setState((state) => {
    const current = state.bySession[key] ?? []
    const added = items
      .filter((item) => item.src)
      .slice(0, Math.max(0, MAX_REFS - current.length))
      .map((item) => ({
        id: createId(),
        name: item.name,
        src: item.src,
        weight: 0.6,
      }))
    if (added.length === 0) {
      return state
    }
    return { bySession: { ...state.bySession, [key]: [...current, ...added] } }
  })
}

export const removeRef = (sessionId: string | null, id: string) => {
  const key = keyOf(sessionId)
  useImageRefs.setState((state) => ({
    bySession: {
      ...state.bySession,
      [key]: (state.bySession[key] ?? []).filter((item) => item.id !== id),
    },
  }))
}
