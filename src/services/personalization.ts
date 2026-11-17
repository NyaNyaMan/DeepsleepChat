import { useSettings } from './settings.js'

/** 所有生成请求统一携带的助手身份说明 */
export const BASE_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/**
 * 把「身份 + 用户指令 + 长期记忆」拼成一次请求的 system。
 *
 * 用户指令是用户自己写的个性化要求（相当于 Gemini 的自定义指令），
 * 长期记忆是跨会话积累的用户画像条目，两者都只在本机保存。
 */
export const buildSystemPrompt = (): string => {
  const { customInstructions, memoryEnabled, memories } = useSettings.getState()
  const sections = [BASE_SYSTEM_PROMPT]

  const instructions = customInstructions.trim()
  if (instructions) {
    sections.push(
      `## 用户指令\n以下是用户为自己设定的长期要求，请在每次回答中都遵守（与安全策略冲突时以安全策略为准）：\n${instructions}`
    )
  }

  if (memoryEnabled && memories.length > 0) {
    sections.push(
      `## 关于用户的长期记忆\n${memories
        .map((item) => `- ${item.text}`)
        .join(
          '\n'
        )}\n可以自然地利用这些信息（例如称呼、专业深度、语言偏好），不要逐条复述，也不要在未被问及时主动罗列。`
    )
  }

  return sections.join('\n\n')
}
