import { create } from 'zustand'
import { createId } from '../utils/id.js'
import * as db from './chat/db.js'
import type { StoredArtifact } from './chat/db.js'

/**
 * 产物库：所有生成过的图片，全局一份，按时间倒序。
 * 存 IndexedDB（图片可能是较大的 data URL），刷新后仍在。
 */

export type ArtifactItem = StoredArtifact

type ArtifactsState = { items: ArtifactItem[]; ready: boolean }

export const useArtifacts = create<ArtifactsState>(() => ({ items: [], ready: false }))

let loading: Promise<void> | null = null

export const initArtifacts = (): Promise<void> => {
  if (useArtifacts.getState().ready) {
    return Promise.resolve()
  }
  loading ??= db
    .loadArtifacts()
    .then((items) => useArtifacts.setState({ items, ready: true }))
    .catch(() => {
      loading = null
      useArtifacts.setState({ ready: true })
    })
  return loading
}

export const addArtifact = async (item: {
  src: string
  prompt: string
  size: string
  model: string
  sessionId: string | null
}): Promise<ArtifactItem> => {
  const record: ArtifactItem = { id: createId(), createdAt: Date.now(), ...item }
  useArtifacts.setState((state) => ({ items: [record, ...state.items], ready: true }))
  await db.saveArtifact(record).catch(() => {})
  return record
}

export const removeArtifact = async (id: string): Promise<void> => {
  useArtifacts.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }))
  await db.deleteArtifact(id).catch(() => {})
}
