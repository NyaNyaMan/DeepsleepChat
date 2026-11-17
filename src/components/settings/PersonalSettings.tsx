import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { addMemory, clearMemories, removeMemory } from '../../services/memory.js'
import { setCustomInstructions, setMemoryEnabled, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/**
 * 个性化：
 * - 用户指令：自定义系统提示词，随每次请求注入
 * - 长期记忆：跨会话的用户画像，可自动学习也可手动增删
 */
export const PersonalSettings = () => {
  const t = useTranslate()
  const customInstructions = useSettings((state) => state.customInstructions)
  const memoryEnabled = useSettings((state) => state.memoryEnabled)
  const memories = useSettings((state) => state.memories)

  // 指令在保存前只改草稿，避免每敲一个字都写一次 localStorage
  const [draft, setDraft] = useState(customInstructions)
  const [newMemory, setNewMemory] = useState('')
  const dirty = draft !== customInstructions

  const commitInstructions = () => {
    setCustomInstructions(draft)
    showToast({ key: 'customInstructionsSaved' })
  }

  const submitMemory = () => {
    const text = newMemory.trim()
    if (!text) {
      return
    }
    addMemory(text)
    setNewMemory('')
  }

  return (
    <>
      <div className={styles.cell}>
        <div className={styles.label}>{t('customInstructionsLabel')}</div>
        <div className={styles.description}>{t('customInstructionsDesc')}</div>
        <div className={styles.fieldBlock}>
          <textarea
            className={styles.textarea}
            rows={4}
            value={draft}
            placeholder={t('customInstructionsPlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.actions}>
            <Button variant="primary" size="m" disabled={!dirty} onClick={commitInstructions}>
              {t('customInstructionsSave')}
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.row}>
          <div className={styles.text}>
            <div className={styles.label}>{t('memoryTitle')}</div>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={memoryEnabled}
              onChange={(event) => setMemoryEnabled(event.target.checked)}
            />
            <span className={styles.switchTrack} />
            {t('memoryEnabledLabel')}
          </label>
        </div>

        <div className={styles.memoryList}>
          {memories.length === 0 ? (
            <div className={styles.memoryEmpty}>{t('memoryEmpty')}</div>
          ) : (
            memories.map((item) => (
              <div key={item.id} className={styles.memoryItem}>
                <span className={styles.memoryText}>{item.text}</span>
                <IconButton
                  icon={<IconCloseOutline16 />}
                  tooltip={t('delete')}
                  onClick={() => removeMemory(item.id)}
                />
              </div>
            ))
          )}
        </div>

        <div className={styles.memoryAdd}>
          <input
            className={styles.input}
            value={newMemory}
            placeholder={t('memoryPlaceholder')}
            onChange={(event) => setNewMemory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submitMemory()
              }
            }}
          />
          <Button variant="outlined" size="m" disabled={!newMemory.trim()} onClick={submitMemory}>
            {t('memoryAdd')}
          </Button>
        </div>

        <div className={styles.memoryFooter}>
          <span className={styles.memoryHint}>{t('memoryHint')}</span>
          {memories.length > 0 ? (
            <button
              type="button"
              className={styles.memoryClear}
              onClick={() => {
                clearMemories()
                showToast({ key: 'memoryCleared' })
              }}
            >
              {t('memoryClear')}
            </button>
          ) : null}
        </div>
      </div>
    </>
  )
}
