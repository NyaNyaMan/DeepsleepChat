import { createId } from '../utils/id.js'
import { completeText } from './api/client.js'
import { setMemories, useSettings, type MemoryItem } from './settings.js'

/**
 * 长期记忆（用户画像）：
 * - 每次生成请求都会把记忆条目拼进系统提示词，实现跨会话的个性化
 * - 一轮对话结束后，用一次轻量的非流式请求抽取值得长期记住的信息
 * - 全部存在 localStorage，可手动增删
 */

/** 保存上限，超出后淘汰最早的条目 */
const MAX_MEMORIES = 60
/** 两次自动学习之间的最小间隔，避免每条消息都额外花一次请求 */
const LEARN_COOLDOWN_MS = 20_000
/** 用户这句话太短时基本没有可提取的信息 */
const MIN_TURN_LENGTH = 6
/** 送给模型的对话片段截断长度 */
const TURN_CLIP = 800

let lastLearnAt = 0

/** 归一化后比较，避免「用户喜欢喝咖啡」与「用户喜欢喝咖啡。」重复入库 */
const normalize = (text: string) =>
  text.toLowerCase().replace(/[\s。，、,.!！?？:：;；"'“”‘’()（）\-—]/g, '')

/** 合并新条目：去重 + 长度上限，返回新的列表 */
export const mergeMemories = (existing: MemoryItem[], texts: string[]): MemoryItem[] => {
  const seen = new Set(existing.map((item) => normalize(item.text)))
  const added: MemoryItem[] = []
  for (const raw of texts) {
    const text = raw.trim().slice(0, 120)
    const key = normalize(text)
    if (!text || !key || seen.has(key)) {
      continue
    }
    seen.add(key)
    added.push({ id: createId(), text, createdAt: Date.now() })
  }
  if (added.length === 0) {
    return existing
  }
  const next = [...existing, ...added]
  return next.length > MAX_MEMORIES ? next.slice(next.length - MAX_MEMORIES) : next
}

export const addMemory = (text: string) => {
  const next = mergeMemories(useSettings.getState().memories, [text])
  if (next !== useSettings.getState().memories) {
    setMemories(next)
  }
}

export const removeMemory = (id: string) => {
  setMemories(useSettings.getState().memories.filter((item) => item.id !== id))
}

export const clearMemories = () => setMemories([])

const EXTRACT_SYSTEM_ZH =
  '你负责维护一份关于用户的长期画像。只输出 JSON 字符串数组，不要输出解释，也不要使用代码块标记。'

const EXTRACT_SYSTEM_EN =
  'You maintain a long-term profile of the user. Reply with a JSON array of strings only, no prose and no code fences.'

const buildPrompt = (question: string, answer: string, known: string[], english: boolean) => {
  const clip = (text: string) => text.slice(0, TURN_CLIP)
  if (english) {
    return [
      'Known profile (do not repeat these):',
      known.length ? known.map((item) => `- ${item}`).join('\n') : '(none)',
      '',
      'Turn:',
      `User: ${clip(question)}`,
      `Assistant: ${clip(answer)}`,
      '',
      'Return a JSON array of at most 3 short facts worth remembering long-term about the user (identity, job, preferences, habits, long-term goals, important facts).',
      'Rules: keep only stable traits, ignore one-off task details and anything said by the assistant, write each item within 20 words starting with "The user", and return [] when there is nothing new.',
    ].join('\n')
  }
  return [
    '已知画像（不要重复录入）：',
    known.length ? known.map((item) => `- ${item}`).join('\n') : '（暂无）',
    '',
    '本轮对话：',
    `用户：${clip(question)}`,
    `助手：${clip(answer)}`,
    '',
    '请输出 JSON 字符串数组，最多 3 条值得长期记住的用户信息（身份、职业、偏好、习惯、长期目标、重要事实）。',
    '规则：只保留稳定信息，忽略一次性任务细节和助手说过的话；每条 30 字以内，以「用户」开头；没有新信息就输出 []。',
  ].join('\n')
}

/** 解析模型返回的数组，容忍代码块与「- 」列表这类不规范输出 */
const parseList = (raw: string): string[] => {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const parsed: unknown = JSON.parse(cleaned)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // 落到按行解析
  }
  return cleaned
    .split('\n')
    .map((line) => line.replace(/^[\s\-*\d.、]+/, '').trim())
    .filter((line) => line && !line.startsWith('[') && !line.startsWith(']'))
}

/**
 * 一轮对话结束后更新用户画像：仅在开关打开、Key 存在、且与上次间隔足够时执行。
 * 抽取失败不影响对话本身。
 */
export const learnFromTurn = async (question: string, answer: string): Promise<void> => {
  const { memoryEnabled, apiKey, memories, locale } = useSettings.getState()
  if (!memoryEnabled || !apiKey || !answer.trim()) {
    return
  }
  if (question.trim().length < MIN_TURN_LENGTH) {
    return
  }
  const now = Date.now()
  if (now - lastLearnAt < LEARN_COOLDOWN_MS) {
    return
  }
  lastLearnAt = now

  const english = locale === 'en-US'
  try {
    const raw = await completeText(apiKey, {
      system: english ? EXTRACT_SYSTEM_EN : EXTRACT_SYSTEM_ZH,
      prompt: buildPrompt(
        question,
        answer,
        memories.map((item) => item.text),
        english
      ),
      maxTokens: 400,
    })
    const texts = parseList(raw)
    if (texts.length > 0) {
      // 用最新快照合并，避免覆盖这期间用户手动增删的结果
      setMemories(mergeMemories(useSettings.getState().memories, texts))
    }
  } catch {
    // 忽略：下次对话再试
  }
}
