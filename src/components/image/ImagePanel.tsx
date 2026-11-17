import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import {
  ASPECTS,
  DEFAULT_IMAGE_PARAMS,
  resolveImageSize,
  type ImageAspect,
  type ImageParams,
  type ImageResolution,
} from '../../services/image.js'
import { MAX_REFS, addRefs, refLabel, removeRef, useImageRefs } from '../../services/imageRefs.js'
import { resolveRefPlan } from '../../services/image.js'
import { startImageTask } from '../../services/imageTask.js'
import { enhanceImagePrompt } from '../../services/models.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconCloseOutline16, IconImageOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './ImagePanel.module.css'

const RESOLUTIONS: ImageResolution[] = ['1K', '2K', '4K']

/** 单张参考图上限，避免 data URL 过大拖慢请求 */
const MAX_REF_BYTES = 8 * 1024 * 1024

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })

/**
 * 会话内的生图面板（不弹独立窗口）：
 * 参考图（P1/P2…）、提示词、比例与高级参数，确认后立刻在会话里插入任务消息。
 */
export const ImagePanel = ({
  sessionId,
  initialPrompt,
  onClose,
  onSent,
}: {
  sessionId: string | null
  initialPrompt: string
  onClose: () => void
  /** 任务已提交：关闭面板并清空输入框 */
  onSent: () => void
}) => {
  const t = useTranslate()
  const imageModel = useSettings((state) => state.imageModel)
  // 参考图到底会不会真的发出去，直接照实告诉用户（面板每次打开都会重新计算）
  const refPlan = resolveRefPlan()
  // 订阅参考图列表，保证增删后立即重绘
  const refs = useImageRefs((state) => state.bySession[sessionId ?? 'new'] ?? [])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [prompt, setPrompt] = useState(initialPrompt)
  const [params, setParams] = useState<ImageParams>(DEFAULT_IMAGE_PARAMS)
  const [advanced, setAdvanced] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const size = resolveImageSize(params)
  const patch = (next: Partial<ImageParams>) => setParams((current) => ({ ...current, ...next }))

  const describe = (value: unknown): string => {
    if (value instanceof ApiError && value.localMessage) {
      return t(value.localMessage.key, value.localMessage.params)
    }
    return value instanceof Error && value.message ? value.message : ''
  }

  const pickRefs = async (files: File[]) => {
    if (files.length === 0) {
      return
    }
    const room = MAX_REFS - refs.length
    if (room <= 0) {
      showToast({ key: 'imageRefLimit' })
      return
    }
    const items: { name: string; src: string }[] = []
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith('image/') || file.size > MAX_REF_BYTES) {
        continue
      }
      items.push({ name: file.name, src: await readAsDataUrl(file) })
    }
    addRefs(sessionId, items)
  }

  const enhance = async () => {
    const text = prompt.trim()
    if (!text || enhancing) {
      return
    }
    setEnhancing(true)
    setError(null)
    try {
      const next = await enhanceImagePrompt(text)
      if (next) {
        setPrompt(next)
      }
    } catch (value) {
      setError(describe(value))
    } finally {
      setEnhancing(false)
    }
  }

  const generate = () => {
    const text = prompt.trim()
    if (!text) {
      return
    }
    setError(null)
    // 任务由服务层负责写会话、更新状态，面板可以立即收起
    void startImageTask(sessionId, { prompt: text, params, refs })
    onSent()
  }

  return (
    <div className={styles.panel} role="region" aria-label={t('imagePanelTitle')}>
      <div className={styles.header}>
        <span className={styles.title}>{t('imagePanelTitle')}</span>
        {imageModel ? <span className={styles.model}>{imageModel}</span> : null}
        <IconButton
          className={styles.close}
          icon={<IconCloseOutline16 />}
          tooltip={t('close')}
          onClick={onClose}
        />
      </div>

      <div className={styles.body}>
        <div className={styles.refs}>
          {refs.map((ref, index) => (
            <div key={ref.id} className={styles.refItem}>
              <img className={styles.refThumb} src={ref.src} alt={ref.name} />
              <span className={styles.refBadge}>{refLabel(index)}</span>
              <button
                type="button"
                className={styles.refRemove}
                aria-label={t('delete')}
                onClick={() => removeRef(sessionId, ref.id)}
              >
                <IconCloseOutline16 />
              </button>
            </div>
          ))}
          {refs.length < MAX_REFS ? (
            <button
              type="button"
              className={styles.refAdd}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconImageOutline16 />
              <span>{t('imageAddRef')}</span>
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void pickRefs(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
        </div>

        {refs.length > 0 ? (
          <div
            className={
              refPlan.mode === 'off' || refPlan.maybeUnsupported ? styles.refWarn : styles.refHint
            }
          >
            {refPlan.mode === 'off'
              ? t('imageRefWarnOff')
              : refPlan.maybeUnsupported
                ? t('imageRefWarnUnsupported')
                : t('imageRefPlanHint', { count: refs.length, mode: refPlan.mode })}
          </div>
        ) : null}

        <textarea
          className={styles.prompt}
          rows={3}
          value={prompt}
          placeholder={t('imagePromptPlaceholder')}
          onChange={(event) => setPrompt(event.target.value)}
        />

        <div className={styles.aspects}>
          {ASPECTS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={
                params.aspect === item.value ? `${styles.chip} ${styles.chipActive}` : styles.chip
              }
              onClick={() => patch({ aspect: item.value as ImageAspect })}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className={
              params.aspect === 'custom' ? `${styles.chip} ${styles.chipActive}` : styles.chip
            }
            onClick={() => patch({ aspect: 'custom' })}
          >
            {t('imageCustom')}
          </button>
        </div>

        {params.aspect === 'custom' ? (
          <div className={styles.sizeRow}>
            <label className={styles.sizeInput}>
              <span>{t('imageWidth')}</span>
              <input
                type="number"
                min={256}
                max={4096}
                step={8}
                value={params.width}
                onChange={(event) => patch({ width: Number(event.target.value) || 1024 })}
              />
            </label>
            <label className={styles.sizeInput}>
              <span>{t('imageHeight')}</span>
              <input
                type="number"
                min={256}
                max={4096}
                step={8}
                value={params.height}
                onChange={(event) => patch({ height: Number(event.target.value) || 1024 })}
              />
            </label>
            <span className={styles.sizeHint}>{size.label}</span>
          </div>
        ) : null}

        <button
          type="button"
          className={styles.advancedToggle}
          onClick={() => setAdvanced((value) => !value)}
        >
          {t('imageAdvanced')}
          <span className={advanced ? styles.caretOpen : styles.caret} />
        </button>

        {advanced ? (
          <div className={styles.advanced}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageResolution')}</span>
              <div className={styles.chips}>
                {RESOLUTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      params.resolution === value
                        ? `${styles.chip} ${styles.chipActive}`
                        : styles.chip
                    }
                    onClick={() => patch({ resolution: value })}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageCount')}</span>
              <div className={styles.stepper}>
                <button
                  type="button"
                  onClick={() => patch({ count: Math.max(1, params.count - 1) })}
                  aria-label="-"
                >
                  −
                </button>
                <span>{params.count}</span>
                <button
                  type="button"
                  onClick={() => patch({ count: Math.min(4, params.count + 1) })}
                  aria-label="+"
                >
                  +
                </button>
              </div>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageSeed')}</span>
              <input
                className={styles.input}
                type="number"
                inputMode="numeric"
                value={params.seed ?? ''}
                placeholder={t('imageSeedPlaceholder')}
                onChange={(event) =>
                  patch({ seed: event.target.value === '' ? null : Number(event.target.value) })
                }
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageNegative')}</span>
              <input
                className={styles.input}
                value={params.negativePrompt}
                placeholder={t('imageNegativePlaceholder')}
                onChange={(event) => patch({ negativePrompt: event.target.value })}
              />
            </label>

            {refs.length > 0 ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t('imageRefWeight')} · {params.refWeight.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.1}
                  value={params.refWeight}
                  onChange={(event) => patch({ refWeight: Number(event.target.value) })}
                />
              </label>
            ) : null}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('imageExtraParams')}</span>
              <textarea
                className={styles.extra}
                rows={2}
                value={params.extra}
                placeholder={t('imageExtraPlaceholder')}
                onChange={(event) => patch({ extra: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        {error ? <div className={styles.error}>{error}</div> : null}
      </div>

      <div className={styles.footer}>
        <Button
          variant="outlined"
          size="s"
          disabled={enhancing || !prompt.trim()}
          onClick={() => void enhance()}
        >
          {enhancing ? t('imageEnhancing') : t('imageEnhance')}
        </Button>
        <span className={styles.sizeHint}>{size.label}</span>
        <Button
          variant="primary"
          size="s"
          className={styles.submit}
          disabled={!prompt.trim()}
          onClick={generate}
        >
          {t('imageGenerate')}
        </Button>
      </div>
    </div>
  )
}
