import { ApiError } from './api/client.js'
import { addArtifact } from './artifacts.js'
import { appendImageTask, finishImageTask } from './chat/store.js'
import { resolveImageSize, generateImage, type ImageParams } from './image.js'
import { refLabel, type RefImage } from './imageRefs.js'
import { useSettings } from './settings.js'
import { translate, isTranslationKey } from '../i18n/index.js'

/** 把接口错误转成界面上能看懂的一句话 */
export const describeImageError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.localMessage) {
      return translate(error.localMessage.key, error.localMessage.params)
    }
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return isTranslationKey('imageFailed') ? translate('imageFailed') : String(error)
}

export type ImageTaskInput = {
  prompt: string
  params: ImageParams
  refs: RefImage[]
}

/**
 * 发起一次生图：先写入会话里的「生成中」消息，再请求接口，最后把结果或错误写回同一条消息。
 * 同时把生成的图片存入产物库。
 */
export const startImageTask = async (
  sessionId: string | null,
  input: ImageTaskInput
): Promise<void> => {
  const { prompt, params } = input
  const size = resolveImageSize(params)
  const refs = input.refs.map((item, index) => ({ label: refLabel(index), src: item.src }))

  const hints = [params.aspect === 'custom' ? `${size.width}×${size.height}` : params.aspect]
  if (params.count > 1) {
    hints.push(`${params.count} 张`)
  }
  if (params.seed !== null) {
    hints.push(`seed ${params.seed}`)
  }
  if (params.negativePrompt.trim()) {
    hints.push('含反向提示词')
  }

  const created = appendImageTask(sessionId, {
    prompt,
    sizeLabel: size.label,
    refLabels: refs.map((ref) => ref.label),
    paramHint: hints.join(' · '),
  })
  if (!created) {
    return
  }

  try {
    const result = await generateImage({ prompt, params, refs })
    finishImageTask(created.sessionId, created.messageId, result)
    const { imageModel } = useSettings.getState()
    for (const url of result.urls) {
      void addArtifact({
        src: url,
        prompt,
        size: result.size,
        model: imageModel,
        sessionId: created.sessionId,
      })
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[image] task failed:', error)
    finishImageTask(created.sessionId, created.messageId, {
      error: describeImageError(error),
    })
  }
}
