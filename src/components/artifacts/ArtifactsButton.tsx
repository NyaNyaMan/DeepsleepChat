import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { addRefs } from '../../services/imageRefs.js'
import { initArtifacts, removeArtifact, useArtifacts } from '../../services/artifacts.js'
import { useChatStore } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { IconCloseOutline16, IconGalleryOutline20 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './Artifacts.module.css'

/** 右上角的产物库入口：收集生成过的图片，可删除或再次用作参考图 */
export const ArtifactsButton = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const items = useArtifacts((state) => state.items)
  const ready = useArtifacts((state) => state.ready)

  useEffect(() => {
    void initArtifacts()
  }, [])

  const useAsRef = (src: string, prompt: string) => {
    addRefs(useChatStore.getState().activeId, [{ name: prompt.slice(0, 20) || 'artifact', src }])
    showToast({ key: 'artifactsAdded' })
    setOpen(false)
  }

  return (
    <>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconGalleryOutline20 />}
        aria-label={t('artifactsOpen')}
        onClick={() => setOpen(true)}
      />
      {open ? (
        <Modal
          title={t('artifactsTitle')}
          closable
          className={styles.dialog}
          mainClassName={styles.main}
          onClose={() => setOpen(false)}
        >
          {ready && items.length === 0 ? (
            <div className={styles.empty}>{t('artifactsEmpty')}</div>
          ) : (
            <div className={styles.grid}>
              {items.map((item) => (
                <div key={item.id} className={styles.cell}>
                  <button
                    type="button"
                    className={styles.thumbButton}
                    onClick={() => useAsRef(item.src, item.prompt)}
                  >
                    <img className={styles.thumb} src={item.src} alt={item.prompt} loading="lazy" />
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={t('artifactsDelete')}
                    onClick={() => void removeArtifact(item.id)}
                  >
                    <IconCloseOutline16 />
                  </button>
                  <span className={styles.meta} title={item.prompt}>
                    {item.size}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  )
}
