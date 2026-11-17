import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { addRefs } from '../../services/imageRefs.js'
import type { ImagePart } from '../../services/chat/types.js'
import { showToast } from '../base/toastState.js'
import styles from './GeneratedImage.module.css'

/** 生成中：显示已用时长，让用户知道任务还在跑 */
const Elapsed = ({ startedAt }: { startedAt?: number }) => {
  const t = useTranslate()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.round((now - (startedAt ?? now)) / 1000))
  return <span className={styles.elapsed}>{t('imageElapsed', { seconds })}</span>
}

/**
 * 会话里的生图任务/结果：
 * pending 显示进度，error 显示原因，done 显示图片 + 提示词 + 操作（保存、用作参考图）。
 */
export const GeneratedImage = ({ block, sessionId }: { block: ImagePart; sessionId: string }) => {
  const t = useTranslate()
  const status = block.status ?? 'done'

  const save = () => {
    const link = document.createElement('a')
    link.href = block.url
    link.download = `deepsleepchat-${Date.now()}.png`
    link.click()
  }

  const useAsRef = () => {
    addRefs(sessionId, [{ name: block.prompt.slice(0, 20) || 'reference', src: block.url }])
    showToast({ key: 'artifactsAdded' })
  }

  if (status === 'pending') {
    return (
      <div className={styles.task}>
        <span className={styles.spinner} />
        <div className={styles.taskText}>
          <span className={styles.taskTitle}>{t('imagePending')}</span>
          <span className={styles.prompt} title={block.prompt}>
            {block.prompt}
          </span>
        </div>
        <Elapsed startedAt={block.startedAt} />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className={`${styles.task} ${styles.taskError}`}>
        <div className={styles.taskText}>
          <span className={styles.taskTitle}>{t('imageFailedShort')}</span>
          <span className={styles.errorText}>{block.error}</span>
        </div>
      </div>
    )
  }

  return (
    <figure className={styles.figure}>
      <img className={styles.image} src={block.url} alt={block.prompt} loading="lazy" />
      <figcaption className={styles.caption}>
        <span className={styles.prompt} title={block.prompt}>
          {block.prompt}
        </span>
        {block.size ? <span className={styles.meta}>{block.size}</span> : null}
        {block.refLabels?.length ? (
          <span className={styles.meta}>{block.refLabels.join(' ')}</span>
        ) : null}
        <button type="button" className={styles.action} onClick={useAsRef}>
          {t('imageUseAsRef')}
        </button>
        <button type="button" className={styles.action} onClick={save}>
          {t('imageSave')}
        </button>
      </figcaption>
      {block.paramHint ? <div className={styles.hint}>{block.paramHint}</div> : null}
    </figure>
  )
}
